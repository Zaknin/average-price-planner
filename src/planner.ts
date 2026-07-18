import {
  applyTransaction,
  applyTransactions,
  feeAmountFor,
  positionMarketSnapshot,
  roundToShareStep,
  salePriceForTarget,
  type FeeSettings,
  type Position,
  type Transaction,
  type TransactionResult,
} from './calculator';
import type {
  DcaLadder,
  DcaLevel,
  ExecutionApplicationPreview,
  ReverseSellRequest,
  ReverseSellResult,
  Scenario,
  ScenarioSummary,
  ScenarioTransaction,
  StressPrice,
} from './domain';
import type { PlannerMessageCode } from './domain';

const EPSILON = 1e-12;

export interface GenerateLadderRequest extends Omit<DcaLadder, 'levels'> {
  makeId: () => string;
}

export interface LadderProjection {
  level: DcaLevel;
  grossAmount: number;
  feeAmount: number;
  totalAmount: number;
  cumulativePosition: Position;
  marketProfitLoss: number;
}

function validPositive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function decimals(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(8, Math.floor(precision)));
  return Math.round(value * factor) / factor;
}

export function activeLadderFee(ladder: Pick<DcaLadder, 'feeMode' | 'percentFeeValue' | 'fixedFeeValue'>): FeeSettings {
  return ladder.feeMode === 'fixed'
    ? { mode: 'fixed', value: ladder.fixedFeeValue }
    : { mode: 'percent', value: ladder.percentFeeValue };
}

export function generateDcaLadder(input: GenerateLadderRequest): { ladder: DcaLadder; error: string | null; errorCode: PlannerMessageCode | null; unallocatedCash: number } {
  const count = Math.floor(input.levelCount);
  const step = input.sharePrecision > 0 ? input.sharePrecision : 1;
  if (count < 2 || count > 20 || !validPositive(input.startPrice) || !validPositive(input.endPrice)) {
    return { ladder: { ...input, levels: [] }, error: 'Use 2–20 levels and positive start/end prices.', errorCode: 'invalidLadderLevels', unallocatedCash: 0 };
  }
  const fee = activeLadderFee(input);
  if (!Number.isFinite(fee.value) || fee.value < 0) return { ladder: { ...input, levels: [] }, error: 'Fee values must be finite and zero or greater.', errorCode: 'invalidLadderFee', unallocatedCash: 0 };
  if (input.distribution === 'equalCash' && !validPositive(input.totalInvestment)) return { ladder: { ...input, levels: [] }, error: 'Enter a positive all-in investment amount.', errorCode: 'invalidLadderInvestment', unallocatedCash: 0 };
  if (input.distribution === 'equalShares' && !validPositive(input.totalShares)) return { ladder: { ...input, levels: [] }, error: 'Enter a positive total share quantity.', errorCode: 'invalidLadderShares', unallocatedCash: 0 };

  const prices = Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const price = input.spacing === 'percent'
      ? input.startPrice * ((input.endPrice / input.startPrice) ** progress)
      : input.startPrice + (input.endPrice - input.startPrice) * progress;
    return decimals(price, input.pricePrecision);
  });
  const levels: DcaLevel[] = [];
  const totalShares = roundToShareStep(input.totalShares, step, 'round');
  let assignedShares = 0;
  for (let index = 0; index < count; index += 1) {
    const price = prices[index]!;
    let shares = 0;
    if (input.distribution === 'equalCash') {
      const allocation = input.totalInvestment / count;
      const grossBudget = fee.mode === 'percent' ? allocation / (1 + fee.value / 100) : allocation - fee.value;
      shares = grossBudget > 0 ? roundToShareStep(grossBudget / price, step, 'floor') : 0;
    } else if (input.distribution === 'equalShares') {
      shares = index === count - 1
        ? Math.max(0, totalShares - assignedShares)
        : roundToShareStep(totalShares / count, step, 'floor');
      assignedShares += shares;
    }
    levels.push({ id: input.makeId(), price, shares, feeMode: fee.mode, feeValue: fee.value });
  }
  const ladder: DcaLadder = { ...input, levelCount: count, levels };
  const used = projectLadder(ladder, { shares: 0, averagePrice: 0 }, 0).reduce((sum, row) => sum + row.totalAmount, 0);
  const feeUncovered = input.distribution === 'equalCash' && levels.some((level) => level.shares <= 0);
  return { ladder, error: feeUncovered ? 'One or more level allocations cannot cover the configured fixed fee.' : null, errorCode: feeUncovered ? 'ladderFeeUncovered' : null, unallocatedCash: input.distribution === 'equalCash' ? Math.max(0, input.totalInvestment - used) : 0 };
}

export function projectLadder(ladder: DcaLadder, current: Position, marketPrice: number): LadderProjection[] {
  let cumulative: Position = ladder.includeCurrentPosition ? { ...current } : { shares: 0, averagePrice: 0 };
  return ladder.levels.map((level) => {
    if (!validPositive(level.shares) || !validPositive(level.price)) {
      return {
        level,
        grossAmount: 0,
        feeAmount: 0,
        totalAmount: 0,
        cumulativePosition: cumulative,
        marketProfitLoss: validPositive(marketPrice) ? cumulative.shares * marketPrice - cumulative.shares * cumulative.averagePrice : 0,
      };
    }
    const result = applyTransaction(cumulative, { id: level.id, type: 'buy', shares: level.shares, price: level.price, feeMode: level.feeMode, feeValue: level.feeValue });
    cumulative = { shares: result.sharesAfter, averagePrice: result.averageAfter };
    return {
      level,
      grossAmount: result.grossAmount,
      feeAmount: result.feeAmount,
      totalAmount: result.totalAmount,
      cumulativePosition: cumulative,
      marketProfitLoss: validPositive(marketPrice) ? cumulative.shares * marketPrice - cumulative.shares * cumulative.averagePrice : 0,
    };
  });
}

export function effectiveScenarioTransaction(transaction: ScenarioTransaction): Transaction | null {
  if (transaction.status === 'cancelled') return null;
  const shares = transaction.status === 'executed' && validPositive(Number(transaction.executionShares)) ? Number(transaction.executionShares) : transaction.shares;
  const price = transaction.status === 'executed' && validPositive(Number(transaction.executionPrice)) ? Number(transaction.executionPrice) : transaction.price;
  const actualFee = transaction.status === 'executed' && Number.isFinite(Number(transaction.actualFee)) && Number(transaction.actualFee) >= 0
    ? Number(transaction.actualFee)
    : null;
  return {
    id: transaction.id,
    type: transaction.type,
    shares,
    price,
    feeMode: actualFee === null ? transaction.feeMode : 'fixed',
    feeValue: actualFee === null ? transaction.feeValue : actualFee,
  };
}

export function projectScenario(scenario: Scenario): { results: TransactionResult[]; finalPosition: Position } {
  const transactions = scenario.transactions
    .map(effectiveScenarioTransaction)
    .filter((transaction): transaction is Transaction => transaction !== null);
  return applyTransactions(scenario.basePosition, transactions);
}

export function summarizeScenario(scenario: Scenario, sellFee: FeeSettings): ScenarioSummary {
  const projected = projectScenario(scenario);
  const valid = projected.results.filter((item) => item.valid);
  const marketPrice = scenario.marketPrice;
  const snapshot = positionMarketSnapshot(projected.finalPosition, marketPrice, sellFee);
  const totals = (status: 'planned' | 'executed', type: 'buy' | 'sell', field: 'shares' | 'cash') => scenario.transactions.reduce((sum, transaction) => {
    if (transaction.status !== status || transaction.type !== type) return sum;
    const effective = effectiveScenarioTransaction(transaction);
    if (!effective) return sum;
    const result = valid.find((item) => item.id === effective.id);
    return sum + (field === 'shares' ? effective.shares : type === 'buy' ? result?.totalAmount ?? 0 : result?.netAmount ?? 0);
  }, 0);
  let maximumCapitalRequirement = 0;
  valid.reduce((value, result) => {
    const next = value + (result.type === 'buy' ? result.totalAmount : -result.netAmount);
    maximumCapitalRequirement = Math.max(maximumCapitalRequirement, next);
    return next;
  }, 0);
  const breakEven = projected.finalPosition.shares > EPSILON
    ? salePriceForTarget(projected.finalPosition, { shares: projected.finalPosition.shares, mode: 'breakEven', fee: sellFee }).requiredPrice
    : 0;
  const realized = valid.reduce((sum, result) => sum + result.realizedProfitLoss, 0);
  return {
    startingShares: scenario.basePosition.shares,
    startingAverage: scenario.basePosition.averagePrice,
    plannedBuyShares: totals('planned', 'buy', 'shares'),
    plannedBuyCash: totals('planned', 'buy', 'cash'),
    plannedSellShares: totals('planned', 'sell', 'shares'),
    expectedSellProceeds: totals('planned', 'sell', 'cash'),
    executedBuyShares: totals('executed', 'buy', 'shares'),
    executedSellShares: totals('executed', 'sell', 'shares'),
    totalFees: valid.reduce((sum, item) => sum + item.feeAmount, 0),
    finalPosition: projected.finalPosition,
    finalCostBasis: projected.finalPosition.shares * projected.finalPosition.averagePrice,
    marketValue: snapshot.available ? snapshot.marketValue : 0,
    unrealizedProfitLoss: snapshot.available ? snapshot.netUnrealizedProfitLoss : 0,
    realizedProfitLoss: realized,
    totalProjectedProfitLoss: realized + (snapshot.available ? snapshot.netUnrealizedProfitLoss : 0),
    breakEvenPrice: breakEven,
    capitalStillInvested: projected.finalPosition.shares * projected.finalPosition.averagePrice,
    cashReleased: valid.filter((item) => item.type === 'sell').reduce((sum, item) => sum + item.netAmount, 0),
    maximumCapitalRequirement,
  };
}

export function reverseSell(request: ReverseSellRequest): ReverseSellResult {
  const base: ReverseSellResult = { valid: false, error: null, errorCode: null, requiredPrice: 0, requiredShares: 0, grossAmount: 0, feeAmount: 0, netAmount: 0, costBasis: 0, realizedProfitLoss: 0, returnPercent: 0, remainingPosition: { ...request.position } };
  const r = request.fee.mode === 'percent' ? request.fee.value / 100 : 0;
  if (!validPositive(request.position.shares) || !validPositive(request.position.averagePrice)) return { ...base, error: 'Enter a valid current position first.', errorCode: 'invalidPosition' };
  if (!Number.isFinite(request.fee.value) || request.fee.value < 0 || r >= 1) return { ...base, error: 'Use a sell fee below 100%.', errorCode: 'invalidSellFee' };
  const target = Number(request.targetValue ?? 0);
  if (!Number.isFinite(target) || target < 0) return { ...base, error: 'Enter a finite target of zero or greater.', errorCode: 'invalidTarget' };
  let shares = Number(request.shares ?? 0);
  let price = Number(request.price ?? 0);
  if (request.direction === 'price') {
    if (!validPositive(shares) || shares > request.position.shares + EPSILON) return { ...base, error: 'Enter a sale quantity within the available shares.', errorCode: 'invalidSaleQuantity' };
    const basis = shares * request.position.averagePrice;
    const profit = request.mode === 'return' ? basis * target / 100 : request.mode === 'profit' ? target : 0;
    price = request.mode === 'netProceeds'
      ? request.fee.mode === 'percent' ? target / (shares * (1 - r)) : (target + request.fee.value) / shares
      : request.fee.mode === 'percent' ? (basis + profit) / (shares * (1 - r)) : (basis + profit + request.fee.value) / shares;
  } else {
    if (!validPositive(price)) return { ...base, error: 'Enter a sale price to solve for shares.', errorCode: 'invalidSalePrice' };
    if (request.mode === 'return') {
      if (!validPositive(shares) || shares > request.position.shares + EPSILON) return { ...base, error: 'Enter a sale quantity within the available shares to inspect its achieved return.', errorCode: 'invalidSaleQuantity' };
      const feeAmount = feeAmountFor(shares * price, request.fee);
      const netAmount = shares * price - feeAmount;
      const costBasis = shares * request.position.averagePrice;
      const remainingShares = Math.max(0, request.position.shares - shares);
      return { valid: true, error: null, requiredPrice: price, requiredShares: shares, grossAmount: shares * price, feeAmount, netAmount, costBasis, realizedProfitLoss: netAmount - costBasis, returnPercent: costBasis > 0 ? (netAmount - costBasis) / costBasis * 100 : 0, remainingPosition: { shares: remainingShares, averagePrice: remainingShares > 0 ? request.position.averagePrice : 0 } };
    }
    const denominator = request.mode === 'netProceeds' ? price * (1 - r) : price * (1 - r) - request.position.averagePrice;
    const numerator = request.mode === 'netProceeds' ? target + (request.fee.mode === 'fixed' ? request.fee.value : 0) : target + (request.fee.mode === 'fixed' ? request.fee.value : 0);
    if (denominator <= EPSILON) return { ...base, error: 'This target cannot be reached at the entered sale price after fees.', errorCode: 'unattainableTarget' };
    shares = roundToShareStep(numerator / denominator, request.shareStep, 'ceil');
    if (!validPositive(shares) || shares > request.position.shares + EPSILON) return { ...base, error: 'The required sale quantity exceeds the available position.', errorCode: 'requiredQuantityExceedsPosition' };
  }
  const feeAmount = feeAmountFor(shares * price, request.fee);
  const netAmount = shares * price - feeAmount;
  const costBasis = shares * request.position.averagePrice;
  const remainingShares = Math.max(0, request.position.shares - shares);
  return { valid: true, error: null, requiredPrice: price, requiredShares: shares, grossAmount: shares * price, feeAmount, netAmount, costBasis, realizedProfitLoss: netAmount - costBasis, returnPercent: costBasis > 0 ? (netAmount - costBasis) / costBasis * 100 : 0, remainingPosition: { shares: remainingShares, averagePrice: remainingShares > 0 ? request.position.averagePrice : 0 } };
}

export function stressPrices(entries: StressPrice[], marketPrice: number): Array<{ entry: StressPrice; price: number }> {
  return entries.map((entry) => ({ entry, price: entry.kind === 'percent' ? marketPrice * (1 + entry.value / 100) : entry.value }));
}

export function previewExecutionApplication(position: Position, scenario: Scenario): ExecutionApplicationPreview {
  const candidates = scenario.transactions.filter((transaction) => transaction.status === 'executed' && !transaction.appliedAt)
    .sort((a, b) => (a.executionDate ?? '').localeCompare(b.executionDate ?? '') || a.createdOrder - b.createdOrder);
  const skipped = scenario.transactions.filter((transaction) => !candidates.includes(transaction));
  let current = { ...position };
  let realizedProfitLoss = 0;
  let totalFees = 0;
  let netProceeds = 0;
  try {
    for (const candidate of candidates) {
      const effective = effectiveScenarioTransaction(candidate);
      if (!effective) continue;
      const result = applyTransaction(current, effective);
      current = { shares: result.sharesAfter, averagePrice: result.averageAfter };
      realizedProfitLoss += result.realizedProfitLoss;
      totalFees += result.feeAmount;
      netProceeds += result.type === 'sell' ? result.netAmount : -result.totalAmount;
    }
    return { valid: true, error: null, errorCode: null, candidates, skipped, finalPosition: current, realizedProfitLoss, totalFees, netProceeds };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Executed transactions could not be applied.', errorCode: 'executionApplyFailed', candidates, skipped, finalPosition: position, realizedProfitLoss: 0, totalFees: 0, netProceeds: 0 };
  }
}
