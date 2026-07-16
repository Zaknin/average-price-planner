export interface Position {
  shares: number;
  averagePrice: number;
}

export type TransactionType = 'buy' | 'sell';

export interface Transaction {
  id: string;
  type: TransactionType;
  shares: number;
  price: number;
}

export interface TransactionResult extends Transaction {
  valid: boolean;
  error: string | null;
  sharesBefore: number;
  sharesAfter: number;
  averageBefore: number;
  averageAfter: number;
  grossAmount: number;
  averageChange: number;
  reduction: number;
  reductionPercent: number;
  realizedProfitLoss: number;
}

export interface OptimizerResult {
  quantity: number;
  cost: number;
  newAverage: number;
  reduction: number;
  reductionPercent: number;
  maximumPossibleReduction: number;
  theoreticalReductionCaptured: number;
  marginalEfficiencyRemaining: number;
  reductionPer100Cost: number;
}

const EPSILON = 1e-12;

export function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateNewAverage(position: Position, purchaseShares: number, purchasePrice: number): number {
  if (!isFinitePositive(purchaseShares) || !isFinitePositive(purchasePrice)) {
    throw new Error('Purchase shares and price must be greater than zero.');
  }

  if (position.shares <= EPSILON) {
    return purchasePrice;
  }

  if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
    throw new Error('Current shares and average price must be greater than zero.');
  }

  return (
    position.shares * position.averagePrice + purchaseShares * purchasePrice
  ) / (position.shares + purchaseShares);
}

export function applyTransaction(position: Position, transaction: Transaction): TransactionResult {
  if (!isFinitePositive(transaction.shares) || !isFinitePositive(transaction.price)) {
    throw new Error('Shares and price must be greater than zero.');
  }

  if (transaction.type === 'sell') {
    if (!isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
      throw new Error('There are no shares available to sell.');
    }
    if (transaction.shares > position.shares + EPSILON) {
      throw new Error(`Cannot sell ${transaction.shares} shares; only ${position.shares} are available.`);
    }

    const sharesAfter = Math.max(0, position.shares - transaction.shares);
    const averageAfter = sharesAfter > EPSILON ? position.averagePrice : 0;

    return {
      ...transaction,
      valid: true,
      error: null,
      sharesBefore: position.shares,
      sharesAfter,
      averageBefore: position.averagePrice,
      averageAfter,
      grossAmount: transaction.shares * transaction.price,
      averageChange: 0,
      reduction: 0,
      reductionPercent: 0,
      realizedProfitLoss: (transaction.price - position.averagePrice) * transaction.shares,
    };
  }

  const averageAfter = calculateNewAverage(position, transaction.shares, transaction.price);
  const averageBefore = position.shares > EPSILON ? position.averagePrice : averageAfter;
  const averageChange = position.shares > EPSILON ? averageAfter - averageBefore : 0;
  const reduction = Math.max(0, -averageChange);

  return {
    ...transaction,
    valid: true,
    error: null,
    sharesBefore: position.shares,
    sharesAfter: position.shares + transaction.shares,
    averageBefore,
    averageAfter,
    grossAmount: transaction.shares * transaction.price,
    averageChange,
    reduction,
    reductionPercent: averageBefore > 0 ? (reduction / averageBefore) * 100 : 0,
    realizedProfitLoss: 0,
  };
}

function invalidTransactionResult(position: Position, transaction: Transaction, error: unknown): TransactionResult {
  return {
    ...transaction,
    valid: false,
    error: error instanceof Error ? error.message : 'This transaction is not valid.',
    sharesBefore: position.shares,
    sharesAfter: position.shares,
    averageBefore: position.averagePrice,
    averageAfter: position.averagePrice,
    grossAmount: transaction.shares * transaction.price,
    averageChange: 0,
    reduction: 0,
    reductionPercent: 0,
    realizedProfitLoss: 0,
  };
}

export function applyTransactions(initial: Position, transactions: Transaction[]): {
  finalPosition: Position;
  results: TransactionResult[];
} {
  let position = { ...initial };
  const results: TransactionResult[] = [];

  for (const transaction of transactions) {
    try {
      const result = applyTransaction(position, transaction);
      results.push(result);
      position = {
        shares: result.sharesAfter,
        averagePrice: result.averageAfter,
      };
    } catch (error) {
      results.push(invalidTransactionResult(position, transaction, error));
    }
  }

  return { finalPosition: position, results };
}

export function normalizedReductionCaptured(currentShares: number, purchaseShares: number): number {
  if (!isFinitePositive(currentShares) || purchaseShares < 0 || !Number.isFinite(purchaseShares)) {
    return 0;
  }
  return purchaseShares / (currentShares + purchaseShares);
}

export function marginalEfficiencyRatio(currentShares: number, purchaseShares: number): number {
  if (!isFinitePositive(currentShares) || purchaseShares < 0 || !Number.isFinite(purchaseShares)) {
    return 0;
  }
  const ratio = currentShares / (currentShares + purchaseShares);
  return ratio * ratio;
}

export function quantityForMarginalEfficiencyFloor(currentShares: number, floorRatio: number): number {
  if (!isFinitePositive(currentShares)) {
    return 0;
  }
  if (!Number.isFinite(floorRatio) || floorRatio <= 0 || floorRatio >= 1) {
    throw new Error('Efficiency floor must be greater than 0 and less than 1.');
  }
  return currentShares * (1 / Math.sqrt(floorRatio) - 1);
}

export function quantityForTheoreticalCapture(currentShares: number, captureRatio: number): number {
  if (!isFinitePositive(currentShares)) {
    return 0;
  }
  if (!Number.isFinite(captureRatio) || captureRatio <= 0 || captureRatio >= 1) {
    throw new Error('Capture ratio must be greater than 0 and less than 1.');
  }
  return currentShares * (captureRatio / (1 - captureRatio));
}

export function roundToShareStep(value: number, step: number, mode: 'floor' | 'ceil' | 'round' = 'round'): number {
  if (!Number.isFinite(value) || value <= 0 || !isFinitePositive(step)) {
    return 0;
  }
  const scaled = value / step;
  const rounded = mode === 'floor'
    ? Math.floor(scaled + EPSILON)
    : mode === 'ceil'
      ? Math.ceil(scaled - EPSILON)
      : Math.round(scaled);
  return Math.max(0, rounded * step);
}

export function budgetMaximumQuantity(budget: number, purchasePrice: number, shareStep: number): number {
  if (!isFinitePositive(budget) || !isFinitePositive(purchasePrice) || !isFinitePositive(shareStep)) {
    return 0;
  }
  return roundToShareStep(budget / purchasePrice, shareStep, 'floor');
}

export function budgetEfficientQuantity(
  currentShares: number,
  maximumQuantity: number,
  captureOfBudgetBenefit: number,
  shareStep: number,
): number {
  if (!isFinitePositive(currentShares) || !isFinitePositive(maximumQuantity)) {
    return 0;
  }
  if (!Number.isFinite(captureOfBudgetBenefit) || captureOfBudgetBenefit <= 0 || captureOfBudgetBenefit > 1) {
    throw new Error('Budget benefit target must be greater than 0 and at most 1.');
  }

  const maximumNormalizedReduction = normalizedReductionCaptured(currentShares, maximumQuantity);
  const targetNormalizedReduction = maximumNormalizedReduction * captureOfBudgetBenefit;

  if (targetNormalizedReduction >= 1) {
    return maximumQuantity;
  }

  const rawQuantity = currentShares * targetNormalizedReduction / (1 - targetNormalizedReduction);
  return Math.min(maximumQuantity, roundToShareStep(rawQuantity, shareStep, 'ceil'));
}

export function analyzePurchase(position: Position, purchaseShares: number, purchasePrice: number): OptimizerResult {
  if (!isFinitePositive(purchaseShares)) {
    return {
      quantity: 0,
      cost: 0,
      newAverage: position.averagePrice,
      reduction: 0,
      reductionPercent: 0,
      maximumPossibleReduction: Math.max(0, position.averagePrice - purchasePrice),
      theoreticalReductionCaptured: 0,
      marginalEfficiencyRemaining: 1,
      reductionPer100Cost: 0,
    };
  }

  const newAverage = calculateNewAverage(position, purchaseShares, purchasePrice);
  const reduction = Math.max(0, position.averagePrice - newAverage);
  const cost = purchaseShares * purchasePrice;
  const maximumPossibleReduction = Math.max(0, position.averagePrice - purchasePrice);

  return {
    quantity: purchaseShares,
    cost,
    newAverage,
    reduction,
    reductionPercent: position.averagePrice > 0 ? (reduction / position.averagePrice) * 100 : 0,
    maximumPossibleReduction,
    theoreticalReductionCaptured:
      maximumPossibleReduction > 0 ? reduction / maximumPossibleReduction : 0,
    marginalEfficiencyRemaining: marginalEfficiencyRatio(position.shares, purchaseShares),
    reductionPer100Cost: cost > 0 ? (reduction / cost) * 100 : 0,
  };
}
