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
