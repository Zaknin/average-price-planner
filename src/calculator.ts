export interface Position {
  shares: number;
  averagePrice: number;
}

export type TransactionType = 'buy' | 'sell';
export type FeeMode = 'percent' | 'fixed';

export interface FeeSettings {
  mode: FeeMode;
  value: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  shares: number;
  price: number;
  feeMode?: FeeMode;
  feeValue?: number;
}

export interface TransactionResult extends Transaction {
  valid: boolean;
  error: string | null;
  warning: string | null;
  sharesBefore: number;
  sharesAfter: number;
  averageBefore: number;
  averageAfter: number;
  grossAmount: number;
  feeAmount: number;
  totalAmount: number;
  netAmount: number;
  averageChange: number;
  reduction: number;
  reductionPercent: number;
  realizedProfitLoss: number;
}

export interface OptimizerResult {
  quantity: number;
  cost: number;
  grossAmount: number;
  feeAmount: number;
  totalCost: number;
  newAverage: number;
  reduction: number;
  reductionPercent: number;
  maximumPossibleReduction: number;
  theoreticalReductionCaptured: number;
  marginalEfficiencyRemaining: number;
  reductionPer100Cost: number;
}

export interface TargetAverageRequest {
  targetAverage: number;
  purchasePrice: number;
  fee?: Partial<FeeSettings>;
  shareStep: number;
  budget?: number;
  respectBudget?: boolean;
}

export interface TargetAverageResult {
  achievable: boolean;
  reason: string | null;
  requiredShares: number;
  grossAmount: number;
  feeAmount: number;
  totalAmount: number;
  resultingPosition: Position;
  averageLowered: number;
  targetReached: boolean;
  exceedsBudget: boolean;
  effectivePurchasePrice: number;
}

export type SaleTargetMode = 'breakEven' | 'profit' | 'return';

export interface SaleTargetRequest {
  shares: number;
  mode: SaleTargetMode;
  targetValue?: number;
  fee?: Partial<FeeSettings>;
}

export interface SaleTargetResult {
  valid: boolean;
  reason: string | null;
  shares: number;
  costBasisSold: number;
  requiredPrice: number;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  realizedProfitLoss: number;
  returnPercent: number;
  remainingPosition: Position;
}

export interface MarketSnapshot {
  available: boolean;
  empty: boolean;
  reason: string | null;
  basis: number;
  marketValue: number;
  grossUnrealizedProfitLoss: number;
  grossReturnPercent: number;
  estimatedSellFee: number;
  netLiquidationValue: number;
  netUnrealizedProfitLoss: number;
  breakEvenPrice: number;
  movementToBreakEvenPercent: number;
  aboveBreakEvenPercent: number;
}

export interface PlannedPositionSnapshot {
  available: boolean;
  reason: string | null;
  finalPosition: Position;
  resultingBasis: number;
  marketValue: number;
  unrealizedProfitLoss: number;
  realizedProfitLoss: number;
  netPlannedCashFlow: number;
  totalFees: number;
  results: TransactionResult[];
}

const EPSILON = 1e-12;
const ZERO_FEE: FeeSettings = { mode: 'percent', value: 0 };

export function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function normalizeFee(fee: Partial<FeeSettings> | undefined): FeeSettings {
  const mode = fee?.mode === 'fixed' ? 'fixed' : 'percent';
  const value = Number(fee?.value ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Fee must be a finite value of zero or greater.');
  }
  return { mode, value };
}

export function feeAmountFor(grossAmount: number, fee: Partial<FeeSettings> | undefined = ZERO_FEE): number {
  if (!Number.isFinite(grossAmount) || grossAmount < 0) {
    throw new Error('Gross transaction value must be zero or greater.');
  }
  const normalized = normalizeFee(fee);
  return normalized.mode === 'percent' ? grossAmount * normalized.value / 100 : normalized.value;
}

function transactionFee(transaction: Transaction): FeeSettings {
  return normalizeFee({ mode: transaction.feeMode, value: transaction.feeValue });
}

export function calculateNewAverage(
  position: Position,
  purchaseShares: number,
  purchasePrice: number,
  fee: Partial<FeeSettings> | undefined = ZERO_FEE,
): number {
  if (!isFinitePositive(purchaseShares) || !isFinitePositive(purchasePrice)) {
    throw new Error('Purchase shares and price must be greater than zero.');
  }

  const grossAmount = purchaseShares * purchasePrice;
  const totalAmount = grossAmount + feeAmountFor(grossAmount, fee);

  if (position.shares <= EPSILON) {
    return totalAmount / purchaseShares;
  }

  if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
    throw new Error('Current shares and average price must be greater than zero.');
  }

  return (position.shares * position.averagePrice + totalAmount) / (position.shares + purchaseShares);
}

export function applyTransaction(position: Position, transaction: Transaction): TransactionResult {
  if (!isFinitePositive(transaction.shares) || !isFinitePositive(transaction.price)) {
    throw new Error('Shares and price must be greater than zero.');
  }

  const fee = transactionFee(transaction);
  const grossAmount = transaction.shares * transaction.price;
  const feeAmount = feeAmountFor(grossAmount, fee);
  const base = { ...transaction, feeMode: fee.mode, feeValue: fee.value, grossAmount, feeAmount };

  if (transaction.type === 'sell') {
    if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
      throw new Error('There are no shares available to sell.');
    }
    if (transaction.shares > position.shares + EPSILON) {
      throw new Error(`Cannot sell ${transaction.shares} shares; only ${position.shares} are available.`);
    }

    const sharesAfter = Math.max(0, position.shares - transaction.shares);
    const averageAfter = sharesAfter > EPSILON ? position.averagePrice : 0;
    const netAmount = grossAmount - feeAmount;
    const warning = feeAmount > grossAmount
      ? 'Fee exceeds gross proceeds; net proceeds are negative.'
      : netAmount < 0
        ? 'Net sale proceeds are negative.'
        : null;

    return {
      ...base,
      valid: true,
      error: null,
      warning,
      sharesBefore: position.shares,
      sharesAfter,
      averageBefore: position.averagePrice,
      averageAfter,
      totalAmount: grossAmount,
      netAmount,
      averageChange: 0,
      reduction: 0,
      reductionPercent: 0,
      realizedProfitLoss: netAmount - transaction.shares * position.averagePrice,
    };
  }

  const totalAmount = grossAmount + feeAmount;
  const averageAfter = calculateNewAverage(position, transaction.shares, transaction.price, fee);
  const averageBefore = position.shares > EPSILON ? position.averagePrice : averageAfter;
  const averageChange = position.shares > EPSILON ? averageAfter - averageBefore : 0;
  const reduction = Math.max(0, -averageChange);

  return {
    ...base,
    valid: true,
    error: null,
    warning: null,
    sharesBefore: position.shares,
    sharesAfter: position.shares + transaction.shares,
    averageBefore,
    averageAfter,
    totalAmount,
    netAmount: grossAmount,
    averageChange,
    reduction,
    reductionPercent: averageBefore > 0 ? (reduction / averageBefore) * 100 : 0,
    realizedProfitLoss: 0,
  };
}

function invalidTransactionResult(position: Position, transaction: Transaction, error: unknown): TransactionResult {
  const grossAmount = Number(transaction.shares) * Number(transaction.price);
  const safeGross = Number.isFinite(grossAmount) ? grossAmount : 0;
  const feeMode = transaction.feeMode === 'fixed' ? 'fixed' : 'percent';
  const feeValue = Number.isFinite(Number(transaction.feeValue)) ? Number(transaction.feeValue) : 0;
  return {
    ...transaction,
    feeMode,
    feeValue,
    valid: false,
    error: error instanceof Error ? error.message : 'This transaction is not valid.',
    warning: null,
    sharesBefore: position.shares,
    sharesAfter: position.shares,
    averageBefore: position.averagePrice,
    averageAfter: position.averagePrice,
    grossAmount: safeGross,
    feeAmount: 0,
    totalAmount: safeGross,
    netAmount: safeGross,
    averageChange: 0,
    reduction: 0,
    reductionPercent: 0,
    realizedProfitLoss: 0,
  };
}

export function applyTransactions(initial: Position, transactions: Transaction[]): { finalPosition: Position; results: TransactionResult[] } {
  let position = { ...initial };
  const results: TransactionResult[] = [];
  for (const transaction of transactions) {
    try {
      const result = applyTransaction(position, transaction);
      results.push(result);
      position = { shares: result.sharesAfter, averagePrice: result.averageAfter };
    } catch (error) {
      results.push(invalidTransactionResult(position, transaction, error));
    }
  }
  return { finalPosition: position, results };
}

export function normalizedReductionCaptured(currentShares: number, purchaseShares: number): number {
  if (!isFinitePositive(currentShares) || purchaseShares < 0 || !Number.isFinite(purchaseShares)) return 0;
  return purchaseShares / (currentShares + purchaseShares);
}

export function marginalEfficiencyRatio(currentShares: number, purchaseShares: number): number {
  if (!isFinitePositive(currentShares) || purchaseShares < 0 || !Number.isFinite(purchaseShares)) return 0;
  const ratio = currentShares / (currentShares + purchaseShares);
  return ratio * ratio;
}

export function quantityForMarginalEfficiencyFloor(currentShares: number, floorRatio: number): number {
  if (!isFinitePositive(currentShares)) return 0;
  if (!Number.isFinite(floorRatio) || floorRatio <= 0 || floorRatio >= 1) throw new Error('Efficiency floor must be greater than 0 and less than 1.');
  return currentShares * (1 / Math.sqrt(floorRatio) - 1);
}

export function quantityForTheoreticalCapture(currentShares: number, captureRatio: number): number {
  if (!isFinitePositive(currentShares)) return 0;
  if (!Number.isFinite(captureRatio) || captureRatio <= 0 || captureRatio >= 1) throw new Error('Capture ratio must be greater than 0 and less than 1.');
  return currentShares * (captureRatio / (1 - captureRatio));
}

export function roundToShareStep(value: number, step: number, mode: 'floor' | 'ceil' | 'round' = 'round'): number {
  if (!Number.isFinite(value) || value <= 0 || !isFinitePositive(step)) return 0;
  const scaled = value / step;
  const rounded = mode === 'floor' ? Math.floor(scaled + EPSILON) : mode === 'ceil' ? Math.ceil(scaled - EPSILON) : Math.round(scaled);
  return Math.max(0, rounded * step);
}

/** Solves the fee-aware weighted-average equation and rounds the purchase up to the share increment. */
export function sharesForTargetAverage(position: Position, request: TargetAverageRequest): TargetAverageResult {
  const fee = normalizeFee(request.fee);
  const base: TargetAverageResult = {
    achievable: false,
    reason: null,
    requiredShares: 0,
    grossAmount: 0,
    feeAmount: 0,
    totalAmount: 0,
    resultingPosition: { ...position },
    averageLowered: 0,
    targetReached: false,
    exceedsBudget: false,
    effectivePurchasePrice: request.purchasePrice * (1 + (fee.mode === 'percent' ? fee.value / 100 : 0)),
  };
  if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
    return { ...base, reason: 'Enter a current share count and average price first.' };
  }
  if (!isFinitePositive(request.targetAverage) || !isFinitePositive(request.purchasePrice) || !isFinitePositive(request.shareStep)) {
    return { ...base, reason: 'Enter a target average, buy price, and share increment greater than zero.' };
  }
  if (request.targetAverage >= position.averagePrice - EPSILON) {
    return { ...base, reason: 'The target average must be below your current average.' };
  }

  const denominator = request.targetAverage - base.effectivePurchasePrice;
  if (denominator <= EPSILON) {
    const acquisition = fee.mode === 'percent' ? base.effectivePurchasePrice : request.purchasePrice;
    return { ...base, reason: `The target average must remain above the fee-adjusted purchase cost of ${acquisition.toFixed(4)} per share.` };
  }
  const numerator = position.shares * (position.averagePrice - request.targetAverage) + (fee.mode === 'fixed' ? fee.value : 0);
  const rawShares = numerator / denominator;
  if (!Number.isFinite(rawShares) || rawShares <= EPSILON) {
    return { ...base, reason: 'This target cannot be solved with the entered values.' };
  }
  const requiredShares = roundToShareStep(rawShares, request.shareStep, 'ceil');
  const grossAmount = requiredShares * request.purchasePrice;
  const feeAmount = feeAmountFor(grossAmount, fee);
  const totalAmount = grossAmount + feeAmount;
  const resultingPosition = {
    shares: position.shares + requiredShares,
    averagePrice: calculateNewAverage(position, requiredShares, request.purchasePrice, fee),
  };
  const exceedsBudget = Number.isFinite(request.budget) && Number(request.budget) >= 0 && totalAmount > Number(request.budget) + EPSILON;
  return {
    ...base,
    achievable: !request.respectBudget || !exceedsBudget,
    reason: request.respectBudget && exceedsBudget ? 'The required purchase exceeds the configured budget.' : null,
    requiredShares,
    grossAmount,
    feeAmount,
    totalAmount,
    resultingPosition,
    averageLowered: Math.max(0, position.averagePrice - resultingPosition.averagePrice),
    targetReached: resultingPosition.averagePrice <= request.targetAverage + EPSILON,
    exceedsBudget,
  };
}

export function salePriceForTarget(position: Position, request: SaleTargetRequest): SaleTargetResult {
  const fee = normalizeFee(request.fee);
  const base: SaleTargetResult = {
    valid: false,
    reason: null,
    shares: request.shares,
    costBasisSold: 0,
    requiredPrice: 0,
    grossAmount: 0,
    feeAmount: 0,
    netAmount: 0,
    realizedProfitLoss: 0,
    returnPercent: 0,
    remainingPosition: { ...position },
  };
  if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) return { ...base, reason: 'Enter a current share count and average price first.' };
  if (!isFinitePositive(request.shares)) return { ...base, reason: 'Enter a number of shares to sell greater than zero.' };
  if (request.shares > position.shares + EPSILON) return { ...base, reason: `Cannot sell ${request.shares} shares; only ${position.shares} are available.` };
  if (fee.mode === 'percent' && fee.value >= 100) return { ...base, reason: 'Sell percentage fees must be less than 100%.' };
  const targetValue = Number(request.targetValue ?? 0);
  if (!Number.isFinite(targetValue) || (request.mode !== 'breakEven' && targetValue < 0)) return { ...base, reason: 'Enter a finite target of zero or greater.' };
  const costBasisSold = request.shares * position.averagePrice;
  const targetProfit = request.mode === 'return' ? costBasisSold * targetValue / 100 : request.mode === 'profit' ? targetValue : 0;
  const requiredPrice = fee.mode === 'percent'
    ? (costBasisSold + targetProfit) / (request.shares * (1 - fee.value / 100))
    : position.averagePrice + (targetProfit + fee.value) / request.shares;
  const grossAmount = request.shares * requiredPrice;
  const feeAmount = feeAmountFor(grossAmount, fee);
  const netAmount = grossAmount - feeAmount;
  const realizedProfitLoss = netAmount - costBasisSold;
  const sharesAfter = Math.max(0, position.shares - request.shares);
  return {
    ...base,
    valid: true,
    shares: request.shares,
    costBasisSold,
    requiredPrice,
    grossAmount,
    feeAmount,
    netAmount,
    realizedProfitLoss,
    returnPercent: costBasisSold > EPSILON ? realizedProfitLoss / costBasisSold * 100 : 0,
    remainingPosition: { shares: sharesAfter, averagePrice: sharesAfter > EPSILON ? position.averagePrice : 0 },
  };
}

export function positionMarketSnapshot(position: Position, marketPrice: number, sellFee: Partial<FeeSettings> | undefined = ZERO_FEE): MarketSnapshot {
  const base: MarketSnapshot = { available: false, empty: false, reason: null, basis: 0, marketValue: 0, grossUnrealizedProfitLoss: 0, grossReturnPercent: 0, estimatedSellFee: 0, netLiquidationValue: 0, netUnrealizedProfitLoss: 0, breakEvenPrice: 0, movementToBreakEvenPercent: 0, aboveBreakEvenPercent: 0 };
  if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) return { ...base, empty: true, reason: 'Add shares and an average price to see this snapshot.' };
  if (!isFinitePositive(marketPrice)) return { ...base, reason: 'Enter the current market price to see this snapshot.' };
  const sale = salePriceForTarget(position, { shares: position.shares, mode: 'breakEven', fee: sellFee });
  if (!sale.valid) return { ...base, reason: sale.reason };
  const basis = position.shares * position.averagePrice;
  const marketValue = position.shares * marketPrice;
  const estimatedSellFee = feeAmountFor(marketValue, sellFee);
  const netLiquidationValue = marketValue - estimatedSellFee;
  const breakEvenPrice = sale.requiredPrice;
  return {
    ...base,
    available: true,
    basis,
    marketValue,
    grossUnrealizedProfitLoss: marketValue - basis,
    grossReturnPercent: (marketValue - basis) / basis * 100,
    estimatedSellFee,
    netLiquidationValue,
    netUnrealizedProfitLoss: netLiquidationValue - basis,
    breakEvenPrice,
    movementToBreakEvenPercent: marketPrice < breakEvenPrice ? (breakEvenPrice - marketPrice) / marketPrice * 100 : 0,
    aboveBreakEvenPercent: marketPrice > breakEvenPrice ? (marketPrice - breakEvenPrice) / breakEvenPrice * 100 : 0,
  };
}

export function plannedPositionMarketSnapshot(initial: Position, transactions: Transaction[], marketPrice: number, sellFee: Partial<FeeSettings> | undefined = ZERO_FEE): PlannedPositionSnapshot {
  const applied = applyTransactions(initial, transactions);
  const validResults = applied.results.filter((result) => result.valid);
  const finalPosition = applied.finalPosition;
  const resultingBasis = finalPosition.shares * finalPosition.averagePrice;
  const marketValue = isFinitePositive(marketPrice) ? finalPosition.shares * marketPrice : 0;
  return {
    available: isFinitePositive(marketPrice),
    reason: isFinitePositive(marketPrice) ? null : 'Enter the current market price to see the after-plan snapshot.',
    finalPosition,
    resultingBasis,
    marketValue,
    unrealizedProfitLoss: marketValue - resultingBasis - (finalPosition.shares > EPSILON && isFinitePositive(marketPrice) ? feeAmountFor(marketValue, sellFee) : 0),
    realizedProfitLoss: validResults.reduce((total, result) => total + result.realizedProfitLoss, 0),
    netPlannedCashFlow: validResults.reduce((total, result) => total + (result.type === 'buy' ? -result.totalAmount : result.netAmount), 0),
    totalFees: validResults.reduce((total, result) => total + result.feeAmount, 0),
    results: applied.results,
  };
}

export function budgetMaximumQuantity(budget: number, purchasePrice: number, shareStep: number, fee: Partial<FeeSettings> | undefined = ZERO_FEE): number {
  if (!isFinitePositive(budget) || !isFinitePositive(purchasePrice) || !isFinitePositive(shareStep)) return 0;
  const normalized = normalizeFee(fee);
  const remainingBudget = normalized.mode === 'fixed' ? budget - normalized.value : budget;
  if (remainingBudget <= EPSILON) return 0;
  const perShareCost = normalized.mode === 'percent' ? purchasePrice * (1 + normalized.value / 100) : purchasePrice;
  return roundToShareStep(remainingBudget / perShareCost, shareStep, 'floor');
}

export function budgetEfficientQuantity(currentShares: number, maximumQuantity: number, captureOfBudgetBenefit: number, shareStep: number): number {
  if (!isFinitePositive(currentShares) || !isFinitePositive(maximumQuantity)) return 0;
  if (!Number.isFinite(captureOfBudgetBenefit) || captureOfBudgetBenefit <= 0 || captureOfBudgetBenefit > 1) throw new Error('Budget benefit target must be greater than 0 and at most 1.');
  const targetNormalizedReduction = normalizedReductionCaptured(currentShares, maximumQuantity) * captureOfBudgetBenefit;
  if (targetNormalizedReduction >= 1) return maximumQuantity;
  return Math.min(maximumQuantity, roundToShareStep(currentShares * targetNormalizedReduction / (1 - targetNormalizedReduction), shareStep, 'ceil'));
}

export function analyzePurchase(position: Position, purchaseShares: number, purchasePrice: number, fee: Partial<FeeSettings> | undefined = ZERO_FEE): OptimizerResult {
  if (!isFinitePositive(purchaseShares)) {
    return { quantity: 0, cost: 0, grossAmount: 0, feeAmount: 0, totalCost: 0, newAverage: position.averagePrice, reduction: 0, reductionPercent: 0, maximumPossibleReduction: Math.max(0, position.averagePrice - purchasePrice), theoreticalReductionCaptured: 0, marginalEfficiencyRemaining: 1, reductionPer100Cost: 0 };
  }
  const grossAmount = purchaseShares * purchasePrice;
  const feeAmount = feeAmountFor(grossAmount, fee);
  const totalCost = grossAmount + feeAmount;
  const newAverage = calculateNewAverage(position, purchaseShares, purchasePrice, fee);
  const reduction = Math.max(0, position.averagePrice - newAverage);
  const maximumPossibleReduction = Math.max(0, position.averagePrice - purchasePrice);
  return {
    quantity: purchaseShares,
    cost: totalCost,
    grossAmount,
    feeAmount,
    totalCost,
    newAverage,
    reduction,
    reductionPercent: position.averagePrice > 0 ? (reduction / position.averagePrice) * 100 : 0,
    maximumPossibleReduction,
    theoreticalReductionCaptured: maximumPossibleReduction > 0 ? reduction / maximumPossibleReduction : 0,
    marginalEfficiencyRemaining: marginalEfficiencyRatio(position.shares, purchaseShares),
    reductionPer100Cost: totalCost > 0 ? (reduction / totalCost) * 100 : 0,
  };
}
