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
