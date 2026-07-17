import { describe, expect, it } from 'vitest';
import {
  analyzePurchase,
  applyTransaction,
  applyTransactions,
  budgetEfficientQuantity,
  budgetMaximumQuantity,
  calculateNewAverage,
  marginalEfficiencyRatio,
  normalizedReductionCaptured,
  quantityForMarginalEfficiencyFloor,
  quantityForTheoreticalCapture,
} from '../src/calculator';

describe('weighted average calculations', () => {
  it('calculates a weighted average for a buy', () => {
    expect(calculateNewAverage({ shares: 100, averagePrice: 50 }, 50, 40)).toBeCloseTo(46.6666667);
  });

  it('applies planned buys and sales sequentially', () => {
    const result = applyTransactions(
      { shares: 100, averagePrice: 50 },
      [
        { id: 'buy', type: 'buy', shares: 50, price: 40 },
        { id: 'sell', type: 'sell', shares: 25, price: 60 },
      ],
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.averageAfter).toBeCloseTo(46.6666667);
    expect(result.results[1]?.averageAfter).toBeCloseTo(46.6666667);
    expect(result.results[1]?.realizedProfitLoss).toBeCloseTo(333.3333333);
    expect(result.finalPosition.shares).toBe(125);
    expect(result.finalPosition.averagePrice).toBeCloseTo(46.6666667);
  });

  it('keeps average cost unchanged when selling', () => {
    const sale = applyTransaction(
      { shares: 100, averagePrice: 50 },
      { id: 'sale', type: 'sell', shares: 20, price: 60 },
    );

    expect(sale.sharesAfter).toBe(80);
    expect(sale.averageAfter).toBe(50);
    expect(sale.realizedProfitLoss).toBe(200);
  });

  it('marks an oversized planned sale invalid without breaking later rows', () => {
    const result = applyTransactions(
      { shares: 10, averagePrice: 20 },
      [
        { id: 'bad-sale', type: 'sell', shares: 11, price: 25 },
        { id: 'buy', type: 'buy', shares: 5, price: 10 },
      ],
    );

    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[1]?.valid).toBe(true);
    expect(result.finalPosition.shares).toBe(15);
    expect(result.finalPosition.averagePrice).toBeCloseTo(16.6666667);
  });
});

describe('diminishing return metrics', () => {
  it('captures 50% of theoretical reduction when purchase quantity equals current shares', () => {
    expect(normalizedReductionCaptured(100, 100)).toBeCloseTo(0.5);
    expect(quantityForTheoreticalCapture(100, 0.5)).toBeCloseTo(100);
  });

  it('leaves 25% marginal efficiency when purchase quantity equals current shares', () => {
    expect(marginalEfficiencyRatio(100, 100)).toBeCloseTo(0.25);
    expect(quantityForMarginalEfficiencyFloor(100, 0.25)).toBeCloseTo(100);
  });

  it('reports expected analysis for the reference example', () => {
    const result = analyzePurchase({ shares: 100, averagePrice: 50 }, 100, 40);
    expect(result.newAverage).toBeCloseTo(45);
    expect(result.reduction).toBeCloseTo(5);
    expect(result.theoreticalReductionCaptured).toBeCloseTo(0.5);
    expect(result.marginalEfficiencyRemaining).toBeCloseTo(0.25);
  });
});

describe('budget optimizer', () => {
  it('rounds the maximum quantity down to the configured share step', () => {
    expect(budgetMaximumQuantity(1000, 40, 1)).toBe(25);
    expect(budgetMaximumQuantity(1000, 40, 0.1)).toBe(25);
    expect(budgetMaximumQuantity(1010, 40, 1)).toBe(25);
  });

  it('finds the smallest quantity capturing 80% of full-budget lowering', () => {
    const maximum = budgetMaximumQuantity(4000, 40, 1);
    const efficient = budgetEfficientQuantity(100, maximum, 0.8, 1);

    expect(maximum).toBe(100);
    expect(efficient).toBe(67);
    expect(normalizedReductionCaptured(100, efficient)).toBeGreaterThanOrEqual(
      normalizedReductionCaptured(100, maximum) * 0.8,
    );
  });
});

describe('transaction fees', () => {
  it('keeps zero-fee buy calculations compatible', () => {
    const buy = applyTransaction({ shares: 100, averagePrice: 50 }, { id: 'zero', type: 'buy', shares: 10, price: 40 });
    expect(buy.feeAmount).toBe(0);
    expect(buy.totalAmount).toBe(400);
    expect(buy.averageAfter).toBeCloseTo(49.0909091);
  });

  it('includes a 0.2% buy fee in total cash and cost basis', () => {
    const buy = applyTransaction({ shares: 100, averagePrice: 50 }, { id: 'percent', type: 'buy', shares: 10, price: 40, feeMode: 'percent', feeValue: 0.2 });
    expect(buy.feeAmount).toBeCloseTo(0.8);
    expect(buy.totalAmount).toBeCloseTo(400.8);
    expect(buy.averageAfter).toBeCloseTo(49.0981818);
  });

  it('includes a fixed buy fee in the new average', () => {
    const buy = applyTransaction({ shares: 100, averagePrice: 50 }, { id: 'fixed', type: 'buy', shares: 10, price: 40, feeMode: 'fixed', feeValue: 10 });
    expect(buy.feeAmount).toBe(10);
    expect(buy.totalAmount).toBe(410);
    expect(buy.averageAfter).toBeCloseTo(49.1818182);
  });

  it('deducts percentage and fixed fees from sell proceeds and profit', () => {
    const percentSale = applyTransaction({ shares: 100, averagePrice: 80 }, { id: 'percent-sale', type: 'sell', shares: 10, price: 100, feeMode: 'percent', feeValue: 0.2 });
    expect(percentSale.grossAmount).toBe(1000);
    expect(percentSale.feeAmount).toBe(2);
    expect(percentSale.netAmount).toBe(998);
    expect(percentSale.realizedProfitLoss).toBe(198);

    const fixedSale = applyTransaction({ shares: 100, averagePrice: 80 }, { id: 'fixed-sale', type: 'sell', shares: 10, price: 100, feeMode: 'fixed', feeValue: 10 });
    expect(fixedSale.netAmount).toBe(990);
    expect(fixedSale.realizedProfitLoss).toBe(190);
  });

  it('keeps the remaining average on a partial sale and clears it on a full sale', () => {
    const partial = applyTransaction({ shares: 10, averagePrice: 20 }, { id: 'partial', type: 'sell', shares: 2, price: 25, feeMode: 'fixed', feeValue: 1 });
    expect(partial.averageAfter).toBe(20);
    const full = applyTransaction({ shares: 10, averagePrice: 20 }, { id: 'full', type: 'sell', shares: 10, price: 25, feeMode: 'percent', feeValue: 1 });
    expect(full.sharesAfter).toBe(0);
    expect(full.averageAfter).toBe(0);
  });

  it('warns when a fixed sell fee makes proceeds negative', () => {
    const sale = applyTransaction({ shares: 10, averagePrice: 20 }, { id: 'negative-net', type: 'sell', shares: 1, price: 5, feeMode: 'fixed', feeValue: 10 });
    expect(sale.netAmount).toBe(-5);
    expect(sale.warning).toContain('Fee exceeds gross proceeds');
  });

  it('accounts for percentage and fixed buy fees in the maximum budget quantity', () => {
    expect(budgetMaximumQuantity(1000, 40, 1, { mode: 'percent', value: 0.2 })).toBe(24);
    expect(budgetMaximumQuantity(1000, 40, 1, { mode: 'fixed', value: 10 })).toBe(24);
    expect(budgetMaximumQuantity(10, 40, 1, { mode: 'fixed', value: 10 })).toBe(0);
  });

  it('calculates mixed sequential fees from each previous position', () => {
    const result = applyTransactions(
      { shares: 100, averagePrice: 50 },
      [
        { id: 'buy-one', type: 'buy', shares: 10, price: 40, feeMode: 'fixed', feeValue: 10 },
        { id: 'buy-two', type: 'buy', shares: 10, price: 45, feeMode: 'percent', feeValue: 1 },
        { id: 'sell', type: 'sell', shares: 20, price: 55, feeMode: 'fixed', feeValue: 5 },
      ],
    );
    expect(result.results.map((item) => item.valid)).toEqual([true, true, true]);
    expect(result.results[0]?.averageAfter).toBeCloseTo(49.1818182);
    expect(result.results[1]?.averageAfter).toBeCloseTo(48.8708333);
    expect(result.results[2]?.realizedProfitLoss).toBeCloseTo(117.5833333);
    expect(result.finalPosition).toEqual(expect.objectContaining({ shares: 100 }));
  });
});
