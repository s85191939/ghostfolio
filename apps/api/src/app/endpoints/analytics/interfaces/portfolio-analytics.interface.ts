/**
 * Portfolio analytics response — computed risk metrics and insights.
 *
 * These are higher-level derived metrics that Ghostfolio does not
 * natively expose.  They power the AgentForge AI summary endpoint
 * and can be consumed by any downstream client.
 */

export interface ConcentrationRisk {
  /** Symbol of the largest holding */
  topHoldingSymbol: string;
  /** Display name of the largest holding */
  topHoldingName: string;
  /** Weight of the largest holding (0-1) */
  topHoldingWeight: number;
  /** Herfindahl-Hirschman Index (0-1). Higher = more concentrated */
  herfindahlIndex: number;
  /** True when HHI > 0.25 (highly concentrated) */
  isHighlyConcentrated: boolean;
}

export interface DiversificationScore {
  /** 0-100 composite score — higher is better */
  score: number;
  /** Number of distinct asset classes held */
  assetClassCount: number;
  /** Total number of individual holdings */
  holdingsCount: number;
  /** Name of the dominant asset class */
  topAssetClass: string;
  /** Weight of the dominant asset class (0-1) */
  topAssetClassWeight: number;
}

export interface AssetAllocationEntry {
  assetClass: string;
  /** Weight (0-1) */
  weight: number;
  valueInBaseCurrency: number;
}

export interface PortfolioAnalyticsResponse {
  concentrationRisk: ConcentrationRisk;
  diversification: DiversificationScore;
  assetAllocation: AssetAllocationEntry[];
  /** Human-readable insight strings */
  insights: string[];
  /** ISO timestamp of when analytics were computed */
  computedAt: string;
}
