/**
 * AI summary response — a comprehensive portfolio snapshot designed
 * for consumption by AI agents and external services.
 */

export interface AiSummaryHolding {
  symbol: string;
  name: string;
  assetClass: string;
  assetSubClass: string;
  currency: string;
  allocationPercentage: number;
  valueInBaseCurrency: number;
  marketPrice: number;
}

export interface AiSummaryConcentration {
  topHoldingSymbol: string;
  topHoldingName: string;
  topHoldingWeight: number;
  herfindahlIndex: number;
  isHighlyConcentrated: boolean;
}

export interface AiSummaryDiversification {
  score: number;
  assetClassCount: number;
  holdingsCount: number;
  topAssetClass: string;
  topAssetClassWeight: number;
}

export interface AiSummaryAssetAllocation {
  assetClass: string;
  weight: number;
  valueInBaseCurrency: number;
}

export interface AiSummaryResponse {
  baseCurrency: string;
  holdings: AiSummaryHolding[];
  concentration: AiSummaryConcentration;
  diversification: AiSummaryDiversification;
  assetAllocation: AiSummaryAssetAllocation[];
  insights: string[];
  computedAt: string;
}
