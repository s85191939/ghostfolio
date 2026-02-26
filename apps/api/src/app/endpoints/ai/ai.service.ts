import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import { Filter, PortfolioPosition } from '@ghostfolio/common/interfaces';
import type { AiPromptMode } from '@ghostfolio/common/types';

import { Injectable } from '@nestjs/common';
import { AssetClass } from '@prisma/client';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import type { ColumnDescriptor } from 'tablemark';

import {
  AiSummaryAssetAllocation,
  AiSummaryConcentration,
  AiSummaryDiversification,
  AiSummaryHolding,
  AiSummaryResponse
} from './interfaces/ai-summary.interface';

@Injectable()
export class AiService {
  private static readonly HOLDINGS_TABLE_COLUMN_DEFINITIONS: ({
    key:
      | 'ALLOCATION_PERCENTAGE'
      | 'ASSET_CLASS'
      | 'ASSET_SUB_CLASS'
      | 'CURRENCY'
      | 'NAME'
      | 'SYMBOL';
  } & ColumnDescriptor)[] = [
    { key: 'NAME', name: 'Name' },
    { key: 'SYMBOL', name: 'Symbol' },
    { key: 'CURRENCY', name: 'Currency' },
    { key: 'ASSET_CLASS', name: 'Asset Class' },
    { key: 'ASSET_SUB_CLASS', name: 'Asset Sub Class' },
    {
      align: 'right',
      key: 'ALLOCATION_PERCENTAGE',
      name: 'Allocation in Percentage'
    }
  ];

  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService
  ) {}

  public async generateText({ prompt }: { prompt: string }) {
    const openRouterApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );

    const openRouterModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    const openRouterService = createOpenRouter({
      apiKey: openRouterApiKey
    });

    return generateText({
      prompt,
      model: openRouterService.chat(openRouterModel)
    });
  }

  public async getPrompt({
    filters,
    impersonationId,
    languageCode,
    mode,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    languageCode: string;
    mode: AiPromptMode;
    userCurrency: string;
    userId: string;
  }) {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const holdingsTableColumns: ColumnDescriptor[] =
      AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.map(({ align, name }) => {
        return { name, align: align ?? 'left' };
      });

    const holdingsTableRows = Object.values(holdings)
      .sort((a, b) => {
        return b.allocationInPercentage - a.allocationInPercentage;
      })
      .map(
        ({
          allocationInPercentage,
          assetClass,
          assetSubClass,
          currency,
          name: label,
          symbol
        }) => {
          return AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.reduce(
            (row, { key, name }) => {
              switch (key) {
                case 'ALLOCATION_PERCENTAGE':
                  row[name] = `${(allocationInPercentage * 100).toFixed(3)}%`;
                  break;

                case 'ASSET_CLASS':
                  row[name] = assetClass ?? '';
                  break;

                case 'ASSET_SUB_CLASS':
                  row[name] = assetSubClass ?? '';
                  break;

                case 'CURRENCY':
                  row[name] = currency;
                  break;

                case 'NAME':
                  row[name] = label;
                  break;

                case 'SYMBOL':
                  row[name] = symbol;
                  break;

                default:
                  row[name] = '';
                  break;
              }

              return row;
            },
            {} as Record<string, string>
          );
        }
      );

    // Dynamic import to load ESM module from CommonJS context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<typeof import('tablemark')>;
    const { tablemark } = await dynamicImport('tablemark');

    const holdingsTableString = tablemark(holdingsTableRows, {
      columns: holdingsTableColumns
    });

    if (mode === 'portfolio') {
      return holdingsTableString;
    }

    return [
      `You are a neutral financial assistant. Please analyze the following investment portfolio (base currency being ${userCurrency}) in simple words.`,
      holdingsTableString,
      'Structure your answer with these sections:',
      "Overview: Briefly summarize the portfolio's composition and allocation rationale.",
      'Risk Assessment: Identify potential risks, including market volatility, concentration, and sectoral imbalances.',
      'Advantages: Highlight strengths, focusing on growth potential, diversification, or other benefits.',
      'Disadvantages: Point out weaknesses, such as overexposure or lack of defensive assets.',
      'Target Group: Discuss who this portfolio might suit (e.g., risk tolerance, investment goals, life stages, and experience levels).',
      'Optimization Ideas: Offer ideas to complement the portfolio, ensuring they are constructive and neutral in tone.',
      'Conclusion: Provide a concise summary highlighting key insights.',
      `Provide your answer in the following language: ${languageCode}.`
    ].join('\n');
  }

  /**
   * getSummary — returns a structured AI-ready portfolio summary with
   * computed risk metrics, diversification score, and insights.
   *
   * Unlike getPrompt() which returns a text prompt for an LLM, this
   * returns structured JSON that external agents can consume directly.
   */
  public async getSummary({
    filters,
    impersonationId,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    userCurrency: string;
    userId: string;
  }): Promise<AiSummaryResponse> {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const positions = Object.values(holdings);

    // Build structured holdings list
    const holdingsList: AiSummaryHolding[] = positions
      .sort((a, b) => (b.allocationInPercentage ?? 0) - (a.allocationInPercentage ?? 0))
      .map((p) => ({
        symbol: p.symbol ?? '',
        name: p.name ?? p.symbol ?? '',
        assetClass: p.assetClass ?? 'UNKNOWN',
        assetSubClass: p.assetSubClass ?? 'UNKNOWN',
        currency: p.currency ?? userCurrency,
        allocationPercentage: Math.round((p.allocationInPercentage ?? 0) * 10000) / 100,
        valueInBaseCurrency: Math.round((p.valueInBaseCurrency ?? 0) * 100) / 100,
        marketPrice: p.marketPrice ?? 0
      }));

    // Compute concentration risk
    const concentration = this.computeConcentration(positions);

    // Compute asset allocation
    const assetAllocation = this.computeAssetAllocation(positions);

    // Compute diversification score
    const diversification = this.computeDiversification(positions, assetAllocation);

    // Generate insights
    const insights = this.generateInsights(concentration, diversification, assetAllocation);

    return {
      baseCurrency: userCurrency,
      holdings: holdingsList,
      concentration,
      diversification,
      assetAllocation,
      insights,
      computedAt: new Date().toISOString()
    };
  }

  // ─── Analytics helpers ──────────────────────────────────────────────

  private computeConcentration(
    positions: PortfolioPosition[]
  ): AiSummaryConcentration {
    if (positions.length === 0) {
      return {
        topHoldingSymbol: '',
        topHoldingName: '',
        topHoldingWeight: 0,
        herfindahlIndex: 0,
        isHighlyConcentrated: false
      };
    }

    const sorted = [...positions].sort(
      (a, b) => (b.allocationInPercentage ?? 0) - (a.allocationInPercentage ?? 0)
    );
    const top = sorted[0];

    // HHI = sum of squared weights
    const hhi = positions.reduce((sum, p) => {
      const w = p.allocationInPercentage ?? 0;
      return sum + w * w;
    }, 0);

    return {
      topHoldingSymbol: top.symbol ?? '',
      topHoldingName: top.name ?? top.symbol ?? '',
      topHoldingWeight: Math.round((top.allocationInPercentage ?? 0) * 10000) / 100,
      herfindahlIndex: Math.round(hhi * 10000) / 10000,
      isHighlyConcentrated: hhi > 0.25
    };
  }

  private computeAssetAllocation(
    positions: PortfolioPosition[]
  ): AiSummaryAssetAllocation[] {
    const classMap = new Map<string, { weight: number; value: number }>();

    for (const p of positions) {
      const cls = p.assetClass ?? 'UNKNOWN';
      const existing = classMap.get(cls) ?? { weight: 0, value: 0 };
      existing.weight += p.allocationInPercentage ?? 0;
      existing.value += p.valueInBaseCurrency ?? 0;
      classMap.set(cls, existing);
    }

    return Array.from(classMap.entries())
      .map(([assetClass, { weight, value }]) => ({
        assetClass,
        weight: Math.round(weight * 10000) / 100,
        valueInBaseCurrency: Math.round(value * 100) / 100
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  private computeDiversification(
    positions: PortfolioPosition[],
    allocation: AiSummaryAssetAllocation[]
  ): AiSummaryDiversification {
    const holdingsCount = positions.filter(
      (p) => p.assetClass !== AssetClass.LIQUIDITY
    ).length;

    const assetClassCount = allocation.filter(
      (a) => a.assetClass !== 'LIQUIDITY' && a.assetClass !== 'UNKNOWN'
    ).length;

    const topAssetClass = allocation[0]?.assetClass ?? 'UNKNOWN';
    const topAssetClassWeight = allocation[0]?.weight ?? 0;

    // Composite score (0-100):
    //   40% holdings breadth (capped at 20 holdings)
    //   30% asset class variety (capped at 5 classes)
    //   30% evenness (1 - HHI of asset class weights)
    const holdingsScore = Math.min(holdingsCount / 20, 1) * 40;
    const classScore = Math.min(assetClassCount / 5, 1) * 30;

    const classWeightsAsFraction = allocation
      .filter((a) => a.assetClass !== 'LIQUIDITY' && a.assetClass !== 'UNKNOWN')
      .map((a) => a.weight / 100);
    const classHhi = classWeightsAsFraction.reduce(
      (sum, w) => sum + w * w,
      0
    );
    const evennessScore = (1 - classHhi) * 30;

    const score = Math.round(
      Math.min(holdingsScore + classScore + evennessScore, 100)
    );

    return {
      score,
      assetClassCount,
      holdingsCount,
      topAssetClass,
      topAssetClassWeight
    };
  }

  private generateInsights(
    concentration: AiSummaryConcentration,
    diversification: AiSummaryDiversification,
    allocation: AiSummaryAssetAllocation[]
  ): string[] {
    const insights: string[] = [];

    if (concentration.isHighlyConcentrated) {
      insights.push(
        `High concentration risk: ${concentration.topHoldingName} ` +
          `represents ${concentration.topHoldingWeight.toFixed(1)}% of the portfolio. ` +
          `HHI of ${concentration.herfindahlIndex.toFixed(4)} exceeds the 0.25 threshold.`
      );
    } else if (concentration.topHoldingWeight > 15) {
      insights.push(
        `Moderate concentration: ${concentration.topHoldingName} ` +
          `is the largest position at ${concentration.topHoldingWeight.toFixed(1)}%.`
      );
    }

    if (diversification.score >= 70) {
      insights.push(
        `Good diversification (score: ${diversification.score}/100) across ` +
          `${diversification.holdingsCount} holdings and ` +
          `${diversification.assetClassCount} asset classes.`
      );
    } else if (diversification.score >= 40) {
      insights.push(
        `Moderate diversification (score: ${diversification.score}/100). ` +
          `Consider adding more asset classes or holdings.`
      );
    } else {
      insights.push(
        `Low diversification (score: ${diversification.score}/100). ` +
          `Portfolio is heavily weighted in ${diversification.topAssetClass} ` +
          `(${diversification.topAssetClassWeight.toFixed(1)}%).`
      );
    }

    const equityAlloc = allocation.find((a) => a.assetClass === 'EQUITY');
    if (equityAlloc && equityAlloc.weight > 80) {
      insights.push(
        `Portfolio is ${equityAlloc.weight.toFixed(1)}% equities — ` +
          `consider adding bonds or fixed income for stability.`
      );
    }

    const fixedIncome = allocation.find((a) => a.assetClass === 'FIXED_INCOME');
    if (!fixedIncome || fixedIncome.weight < 5) {
      insights.push('No significant fixed income allocation detected.');
    }

    return insights;
  }
}
