export interface NewsArticle {
  id: string;
  symbol: string;
  headline: string;
  summary: string | null;
  sentiment: string | null;
  source: string;
  url: string;
  published_at: string;
  fetched_at: string;
}

export interface NewsAlert {
  id: string;
  user_id: string;
  symbol: string;
  keywords: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewsResponse {
  articles: NewsArticle[];
  symbol?: string;
  fetchedAt: string;
}

export interface PortfolioNewsResponse {
  articles: NewsArticle[];
  symbols: string[];
  fetchedAt: string;
}

export interface CreateAlertDto {
  symbol: string;
  keywords?: string;
}

export interface UpdateAlertDto {
  keywords?: string;
  isActive?: boolean;
}
