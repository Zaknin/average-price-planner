import type { FeeMode, FeeSettings, Position, Transaction, TransactionType } from './calculator';

export type TransactionStatus = 'planned' | 'executed' | 'cancelled';
export type ScenarioStatus = 'draft' | 'active' | 'completed' | 'archived';
export type DcaDistribution = 'equalCash' | 'equalShares' | 'custom';
export type DcaSpacing = 'linear' | 'percent';
export type StressPriceKind = 'absolute' | 'percent';

export interface ScenarioTransaction extends Transaction {
  status: TransactionStatus;
  createdAt: string;
  updatedAt: string;
  createdOrder: number;
  executionDate?: string;
  executionPrice?: number;
  executionShares?: number;
  actualFee?: number;
  note?: string;
  brokerLabel?: string;
  appliedAt?: string;
  ladderLevelId?: string;
}

export interface DcaLevel {
  id: string;
  price: number;
  shares: number;
  feeMode: FeeMode;
  feeValue: number;
}

export interface DcaLadder {
  levelCount: number;
  startPrice: number;
  endPrice: number;
  distribution: DcaDistribution;
  spacing: DcaSpacing;
  totalInvestment: number;
  totalShares: number;
  feeMode: FeeMode;
  percentFeeValue: number;
  fixedFeeValue: number;
  sharePrecision: number;
  pricePrecision: number;
  includeCurrentPosition: boolean;
  levels: DcaLevel[];
}

export interface StressPrice {
  id: string;
  kind: StressPriceKind;
  value: number;
}

export interface Scenario {
  id: string;
  holdingId: string;
  name: string;
  note: string;
  status: ScenarioStatus;
  createdAt: string;
  updatedAt: string;
  basePosition: Position;
  marketPrice: number;
  transactions: ScenarioTransaction[];
  ladder: DcaLadder | null;
  stressPrices: StressPrice[];
}

export interface ScenarioSummary {
  startingShares: number;
  startingAverage: number;
  plannedBuyShares: number;
  plannedBuyCash: number;
  plannedSellShares: number;
  expectedSellProceeds: number;
  executedBuyShares: number;
  executedSellShares: number;
  totalFees: number;
  finalPosition: Position;
  finalCostBasis: number;
  marketValue: number;
  unrealizedProfitLoss: number;
  realizedProfitLoss: number;
  totalProjectedProfitLoss: number;
  breakEvenPrice: number;
  capitalStillInvested: number;
  cashReleased: number;
  maximumCapitalRequirement: number;
}

export interface ExecutionApplicationPreview {
  valid: boolean;
  error: string | null;
  /** Stable diagnostic code for localized UI; legacy text remains for compatibility. */
  errorCode?: PlannerMessageCode | null;
  candidates: ScenarioTransaction[];
  skipped: ScenarioTransaction[];
  finalPosition: Position;
  realizedProfitLoss: number;
  totalFees: number;
  netProceeds: number;
}

export interface ReverseSellRequest {
  position: Position;
  fee: FeeSettings;
  shareStep: number;
  mode: 'breakEven' | 'profit' | 'return' | 'netProceeds';
  direction: 'price' | 'shares';
  shares?: number;
  price?: number;
  targetValue?: number;
}

export interface ReverseSellResult {
  valid: boolean;
  error: string | null;
  /** Stable diagnostic code for localized UI; legacy text remains for compatibility. */
  errorCode?: PlannerMessageCode | null;
  requiredPrice: number;
  requiredShares: number;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  costBasis: number;
  realizedProfitLoss: number;
  returnPercent: number;
  remainingPosition: Position;
}

export type PlannerMessageCode =
  | 'invalidPosition' | 'invalidSellFee' | 'invalidTarget' | 'invalidSaleQuantity'
  | 'invalidSalePrice' | 'unattainableTarget' | 'requiredQuantityExceedsPosition'
  | 'executionApplyFailed' | 'invalidLadderLevels' | 'invalidLadderFee'
  | 'invalidLadderInvestment' | 'invalidLadderShares' | 'ladderFeeUncovered';

export interface HoldingLike {
  id: string;
  ticker: string;
  currency: string;
  baseShares: number;
  baseAverage: number;
  currentMarketPrice: number;
  buyFee: FeeSettings;
  sellFee: FeeSettings;
  transactions: Transaction[];
}

export type { Position, Transaction, TransactionType, FeeSettings, FeeMode };
