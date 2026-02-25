import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { Filter, PortfolioPosition } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import { AssetClass } from '@prisma/client';

import {
  AssetAllocationEntry,
  ConcentrationRisk,
  DiversificationScore,
  PortfolioAnalyticsResponse
} from './interfaces/portfolio-analytics.interface';

@Injectable()
export class AnalyticsService {
  public constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * Compute portfolio analytics — concentration risk, diversification score,
   * asset allocation breakdown, and AI-ready insight strings.
   */
  public async getAnalytics({
    filters,
    impersonationId,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    userId: string;
  }): Promise<PortfolioAnalyticsResponse> {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const positions = Object.values(holdings);

    const concentrationRisk = this.computeConcentrationRisk(positions);
    const assetAllocation = this.computeAssetAllocation(positions);
    const diversification = this.computeDiversification(
      positions,
      assetAllocation
    );
    const insights = this.generateInsights(
      concentrationRisk,
      diversification,
      assetAllocation
    );

    return {
      assetAllocation,
      concentrationRisk,
      diversification,
      insights,
      computedAt: new Date().toISOString()
    };
  }

  // ─── Concentration Risk ──────────────────────────────────────────────

  private computeConcentrationRisk(
    positions: PortfolioPosition[]
  ): ConcentrationRisk {
    if (positions.length === 0) {
      return {
        topHoldingSymbol: '',
        topHoldingName: '',
        topHoldingWeight: 0,
        herfindahlIndex: 0,
        isHighlyConcentrated: false
      };
    }

    // Find top holding
    const sorted = [...positions].sort(
      (a, b) =>
        (b.allocationInPercentage ?? 0) - (a.allocationInPercentage ?? 0)
    );
    const top = sorted[0];

    // HHI = sum of squared weights (weights as fractions 0-1)
    const hhi = positions.reduce((sum, p) => {
      const w = p.allocationInPercentage ?? 0;
      return sum + w * w;
    }, 0);

    return {
      topHoldingSymbol: top.symbol ?? '',
      topHoldingName: top.name ?? top.symbol ?? '',
      topHoldingWeight: top.allocationInPercentage ?? 0,
      herfindahlIndex: Math.round(hhi * 10000) / 10000,
      isHighlyConcentrated: hhi > 0.25
    };
  }

  // ─── Asset Allocation ────────────────────────────────────────────────

  private computeAssetAllocation(
    positions: PortfolioPosition[]
  ): AssetAllocationEntry[] {
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
        weight: Math.round(weight * 10000) / 10000,
        valueInBaseCurrency: Math.round(value * 100) / 100
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  // ─── Diversification Score ───────────────────────────────────────────

  private computeDiversification(
    positions: PortfolioPosition[],
    allocation: AssetAllocationEntry[]
  ): DiversificationScore {
    const holdingsCount = positions.filter(
      (p) => p.assetClass !== AssetClass.LIQUIDITY
    ).length;

    // Unique asset classes (excluding liquidity / unknown)
    const assetClassCount = allocation.filter(
      (a) => a.assetClass !== 'LIQUIDITY' && a.assetClass !== 'UNKNOWN'
    ).length;

    const topAssetClass = allocation[0]?.assetClass ?? 'UNKNOWN';
    const topAssetClassWeight = allocation[0]?.weight ?? 0;

    // Composite score (0-100):
    //   40% from number of holdings (capped at 20 for max points)
    //   30% from number of asset classes (capped at 5)
    //   30% from evenness (1 - HHI of asset class weights)
    const holdingsScore = Math.min(holdingsCount / 20, 1) * 40;
    const classScore = Math.min(assetClassCount / 5, 1) * 30;

    const classHhi = allocation
      .filter(
        (a) => a.assetClass !== 'LIQUIDITY' && a.assetClass !== 'UNKNOWN'
      )
      .reduce((sum, a) => sum + a.weight * a.weight, 0);
    const evennessScore = (1 - classHhi) * 30;

    const score = Math.round(
      Math.min(holdingsScore + classScore + evennessScore, 100)
    );

    return {
      score,
      assetClassCount,
      holdingsCount,
      topAssetClass,
      topAssetClassWeight:
        Math.round(topAssetClassWeight * 10000) / 10000
    };
  }

  // ─── Insight Generation ──────────────────────────────────────────────

  private generateInsights(
    concentration: ConcentrationRisk,
    diversification: DiversificationScore,
    allocation: AssetAllocationEntry[]
  ): string[] {
    const insights: string[] = [];

    // Concentration warnings
    if (concentration.isHighlyConcentrated) {
      insights.push(
        `High concentration risk: ${concentration.topHoldingName} ` +
          `(${concentration.topHoldingSymbol}) represents ` +
          `${(concentration.topHoldingWeight * 100).toFixed(1)}% of the portfolio. ` +
          `HHI is ${concentration.herfindahlIndex.toFixed(4)}, which exceeds 0.25 threshold.`
      );
    } else if (concentration.topHoldingWeight > 0.15) {
      insights.push(
        `Moderate concentration: ${concentration.topHoldingName} ` +
          `is the largest position at ${(concentration.topHoldingWeight * 100).toFixed(1)}%.`
      );
    }

    // Diversification
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
          `(${(diversification.topAssetClassWeight * 100).toFixed(1)}%).`
      );
    }

    // Asset class insights
    const equityAlloc = allocation.find(
      (a) => a.assetClass === AssetClass.EQUITY
    );
    const fixedIncomeAlloc = allocation.find(
      (a) => a.assetClass === AssetClass.FIXED_INCOME
    );

    if (equityAlloc && equityAlloc.weight > 0.8) {
      insights.push(
        `Portfolio is ${(equityAlloc.weight * 100).toFixed(1)}% equities — ` +
          `consider adding bonds or fixed income for stability.`
      );
    }

    if (!fixedIncomeAlloc || fixedIncomeAlloc.weight < 0.05) {
      insights.push(
        'No significant fixed income allocation detected.'
      );
    }

    return insights;
  }
}
