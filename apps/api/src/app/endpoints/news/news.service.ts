import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  NewsAlert,
  NewsArticle,
  NewsResponse,
  PortfolioNewsResponse
} from './interfaces/news.interface';

@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger(NewsService.name);
  private readonly finnhubApiKey: string;

  public constructor(private readonly prisma: PrismaService) {
    this.finnhubApiKey = process.env.FINNHUB_API_KEY || '';
  }

  // -----------------------------------------------------------------
  // Table initialization
  // -----------------------------------------------------------------

  public async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS news_articles (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          symbol TEXT NOT NULL,
          headline TEXT NOT NULL,
          summary TEXT,
          sentiment TEXT,
          source TEXT NOT NULL,
          url TEXT NOT NULL,
          published_at TIMESTAMPTZ NOT NULL,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(symbol, url)
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_news_articles_symbol_pub
        ON news_articles(symbol, published_at DESC)
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS news_alerts (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          keywords TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_news_alerts_user
        ON news_alerts(user_id)
      `);

      this.logger.log('News tables initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize news tables: ${error}`);
    }
  }

  // -----------------------------------------------------------------
  // News retrieval
  // -----------------------------------------------------------------

  public async getNewsForSymbol(symbol: string): Promise<NewsResponse> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache — articles fetched within the last hour
    const cached: NewsArticle[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM news_articles
       WHERE symbol = $1
         AND fetched_at > NOW() - INTERVAL '1 hour'
       ORDER BY published_at DESC
       LIMIT 20`,
      upperSymbol
    );

    if (cached.length > 0) {
      return {
        articles: cached,
        symbol: upperSymbol,
        fetchedAt: new Date().toISOString()
      };
    }

    // Fetch fresh data from Finnhub
    const articles = await this.fetchFromFinnhub(upperSymbol);

    // Persist to cache
    for (const a of articles) {
      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO news_articles (symbol, headline, summary, sentiment, source, url, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
           ON CONFLICT (symbol, url) DO NOTHING`,
          a.symbol,
          a.headline,
          a.summary,
          a.sentiment,
          a.source,
          a.url,
          a.published_at
        );
      } catch {
        // ignore duplicate inserts
      }
    }

    return {
      articles,
      symbol: upperSymbol,
      fetchedAt: new Date().toISOString()
    };
  }

  public async getNewsForPortfolio(
    userId: string,
    impersonationId?: string
  ): Promise<PortfolioNewsResponse> {
    const targetUserId = impersonationId || userId;

    // Get distinct symbols from user's orders
    const orders = await this.prisma.order.findMany({
      where: { userId: targetUserId },
      include: { SymbolProfile: true },
      distinct: ['symbolProfileId']
    });

    const symbols = [
      ...new Set(
        orders
          .map((o) => o.SymbolProfile?.symbol)
          .filter((s): s is string => Boolean(s))
      )
    ];

    const allArticles: NewsArticle[] = [];

    // Limit to 10 symbols to stay within Finnhub rate limits
    for (const sym of symbols.slice(0, 10)) {
      try {
        const result = await this.getNewsForSymbol(sym);
        allArticles.push(...result.articles.slice(0, 5));
      } catch (e) {
        this.logger.warn(`Failed to fetch news for ${sym}: ${e}`);
      }
    }

    // Sort by published_at descending
    allArticles.sort(
      (a, b) =>
        new Date(b.published_at).getTime() -
        new Date(a.published_at).getTime()
    );

    return {
      articles: allArticles.slice(0, 30),
      symbols,
      fetchedAt: new Date().toISOString()
    };
  }

  // -----------------------------------------------------------------
  // Alerts CRUD
  // -----------------------------------------------------------------

  public async createAlert(
    userId: string,
    symbol: string,
    keywords?: string
  ): Promise<NewsAlert> {
    const rows: NewsAlert[] = await this.prisma.$queryRawUnsafe(
      `INSERT INTO news_alerts (user_id, symbol, keywords)
       VALUES ($1, $2, $3)
       RETURNING *`,
      userId,
      symbol.toUpperCase(),
      keywords || null
    );
    return rows[0];
  }

  public async listAlerts(userId: string): Promise<NewsAlert[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM news_alerts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      userId
    );
  }

  public async updateAlert(
    alertId: string,
    userId: string,
    data: { keywords?: string; isActive?: boolean }
  ): Promise<NewsAlert | null> {
    // Read current state
    const existing: NewsAlert[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM news_alerts WHERE id = $1 AND user_id = $2`,
      alertId,
      userId
    );

    if (existing.length === 0) {
      return null;
    }

    const current = existing[0];
    const newKeywords =
      data.keywords !== undefined ? data.keywords : current.keywords;
    const newIsActive =
      data.isActive !== undefined ? data.isActive : current.is_active;

    const updated: NewsAlert[] = await this.prisma.$queryRawUnsafe(
      `UPDATE news_alerts
       SET keywords = $1, is_active = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      newKeywords,
      newIsActive,
      alertId,
      userId
    );

    return updated[0] || null;
  }

  public async deleteAlert(
    alertId: string,
    userId: string
  ): Promise<boolean> {
    const count: number = await this.prisma.$executeRawUnsafe(
      `DELETE FROM news_alerts WHERE id = $1 AND user_id = $2`,
      alertId,
      userId
    );
    return count > 0;
  }

  // -----------------------------------------------------------------
  // Finnhub integration
  // -----------------------------------------------------------------

  private async fetchFromFinnhub(symbol: string): Promise<NewsArticle[]> {
    if (!this.finnhubApiKey) {
      this.logger.warn('FINNHUB_API_KEY not set — returning empty news');
      return [];
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = weekAgo.toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];

    try {
      const url =
        `https://finnhub.io/api/v1/company-news` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&from=${from}&to=${to}` +
        `&token=${this.finnhubApiKey}`;

      const response = await fetch(url);

      if (!response.ok) {
        this.logger.error(`Finnhub API error: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as Array<{
        headline?: string;
        summary?: string;
        source?: string;
        url?: string;
        datetime?: number;
      }>;

      return data.slice(0, 20).map((item) => ({
        id: '',
        symbol,
        headline: item.headline || '',
        summary: item.summary || null,
        sentiment: this.classifySentiment(
          item.headline || '',
          item.summary
        ),
        source: item.source || 'Unknown',
        url: item.url || '',
        published_at: new Date(
          (item.datetime || 0) * 1000
        ).toISOString(),
        fetched_at: new Date().toISOString()
      }));
    } catch (e) {
      this.logger.error(`Finnhub fetch failed for ${symbol}: ${e}`);
      return [];
    }
  }

  private classifySentiment(headline: string, summary?: string): string {
    const text = `${headline} ${summary || ''}`.toLowerCase();

    const positive = [
      'surge', 'gain', 'rise', 'up', 'high', 'growth',
      'profit', 'beat', 'upgrade', 'rally', 'bullish', 'record'
    ];
    const negative = [
      'drop', 'fall', 'decline', 'down', 'low', 'loss',
      'miss', 'downgrade', 'crash', 'bearish', 'cut', 'warning'
    ];

    const posCount = positive.filter((w) => text.includes(w)).length;
    const negCount = negative.filter((w) => text.includes(w)).length;

    if (posCount > negCount) return 'positive';
    if (negCount > posCount) return 'negative';
    return 'neutral';
  }
}
