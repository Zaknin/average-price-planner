import { describe, expect, it } from 'vitest';
import {
  plannedPositionMarketSnapshot,
  positionMarketSnapshot,
  salePriceForTarget,
  sharesForTargetAverage,
} from '../src/calculator';
import { createBackup, csvSafeCell, mergeBackupPositions, parseBackupJson, planCsv } from '../src/data';

const position = { shares: 100, averagePrice: 50 };
const backupPosition = (id = 'one') => ({
  id, ticker: 'TEST', currency: 'USD', baseShares: 100, baseAverage: 50, budget: 4000, shareStep: 1,
  buyFee: { mode: 'percent', value: 0 }, sellFee: { mode: 'percent', value: 0 }, transactions: [],
});

describe('target-average reverse calculator', () => {
  it('solves a zero-fee target and recalculates the result', () => {
    const result = sharesForTargetAverage(position, { targetAverage: 45, purchasePrice: 40, shareStep: 1 });
    expect(result.achievable).toBe(true);
    expect(result.requiredShares).toBe(100);
    expect(result.resultingPosition.averagePrice).toBe(45);
  });

  it('includes a percentage fee and rounds shares upward', () => {
    const result = sharesForTargetAverage(position, { targetAverage: 45, purchasePrice: 40, shareStep: 1, fee: { mode: 'percent', value: 0.2 } });
    expect(result.requiredShares).toBe(102);
    expect(result.feeAmount).toBeCloseTo(8.16);
    expect(result.resultingPosition.averagePrice).toBeLessThan(45);
  });

  it('includes a fixed fee in the required share equation', () => {
    const result = sharesForTargetAverage(position, { targetAverage: 45, purchasePrice: 40, shareStep: 1, fee: { mode: 'fixed', value: 10 } });
    expect(result.requiredShares).toBe(102);
    expect(result.totalAmount).toBe(4090);
  });

  it('rounds a fractional requirement upward to the configured increment', () => {
    const result = sharesForTargetAverage(position, { targetAverage: 46.7, purchasePrice: 40, shareStep: 0.25 });
    expect(result.requiredShares / 0.25).toBe(Math.ceil(result.requiredShares / 0.25));
    expect(result.resultingPosition.averagePrice).toBeLessThanOrEqual(46.7);
  });

  it('rejects impossible or non-lowering targets', () => {
    expect(sharesForTargetAverage(position, { targetAverage: 50, purchasePrice: 40, shareStep: 1 }).achievable).toBe(false);
    expect(sharesForTargetAverage(position, { targetAverage: 40.08, purchasePrice: 40, shareStep: 1, fee: { mode: 'percent', value: 0.2 } }).reason).toContain('fee-adjusted');
    expect(sharesForTargetAverage({ shares: 0, averagePrice: 0 }, { targetAverage: 45, purchasePrice: 40, shareStep: 1 }).achievable).toBe(false);
  });

  it('marks an over-budget target as unachievable when the budget is respected', () => {
    const result = sharesForTargetAverage(position, { targetAverage: 45, purchasePrice: 40, shareStep: 1, budget: 100, respectBudget: true });
    expect(result.exceedsBudget).toBe(true);
    expect(result.achievable).toBe(false);
  });
});

describe('break-even and profit targets', () => {
  it('calculates zero, percentage, and fixed-fee break-even prices', () => {
    expect(salePriceForTarget(position, { shares: 10, mode: 'breakEven' }).requiredPrice).toBe(50);
    expect(salePriceForTarget(position, { shares: 10, mode: 'breakEven', fee: { mode: 'percent', value: 0.2 } }).requiredPrice).toBeCloseTo(50.1002004);
    expect(salePriceForTarget(position, { shares: 10, mode: 'breakEven', fee: { mode: 'fixed', value: 10 } }).requiredPrice).toBe(51);
  });

  it('calculates currency profit and percentage return targets after fees', () => {
    const profit = salePriceForTarget(position, { shares: 40, mode: 'profit', targetValue: 500, fee: { mode: 'percent', value: 0.2 } });
    expect(profit.requiredPrice).toBeCloseTo(62.6252505);
    expect(profit.realizedProfitLoss).toBeCloseTo(500);
    const targetReturn = salePriceForTarget(position, { shares: 10, mode: 'return', targetValue: 10, fee: { mode: 'fixed', value: 10 } });
    expect(targetReturn.realizedProfitLoss).toBeCloseTo(50);
  });

  it('preserves the remaining average on partial sale and closes a full sale', () => {
    expect(salePriceForTarget(position, { shares: 25, mode: 'breakEven' }).remainingPosition).toEqual({ shares: 75, averagePrice: 50 });
    expect(salePriceForTarget(position, { shares: 100, mode: 'breakEven' }).remainingPosition).toEqual({ shares: 0, averagePrice: 0 });
  });

  it('rejects invalid quantity and a percentage sell fee at or above 100%', () => {
    expect(salePriceForTarget(position, { shares: 101, mode: 'breakEven' }).valid).toBe(false);
    expect(salePriceForTarget(position, { shares: 0, mode: 'breakEven' }).valid).toBe(false);
    expect(salePriceForTarget(position, { shares: 1, mode: 'breakEven', fee: { mode: 'percent', value: 100 } }).valid).toBe(false);
  });
});

describe('current and planned market snapshots', () => {
  it('separates gross and net liquidation P/L with percentage and fixed fees', () => {
    const percent = positionMarketSnapshot(position, 60, { mode: 'percent', value: 0.2 });
    expect(percent.marketValue).toBe(6000);
    expect(percent.grossUnrealizedProfitLoss).toBe(1000);
    expect(percent.estimatedSellFee).toBe(12);
    expect(percent.netUnrealizedProfitLoss).toBe(988);
    const fixed = positionMarketSnapshot(position, 60, { mode: 'fixed', value: 10 });
    expect(fixed.netUnrealizedProfitLoss).toBe(990);
  });

  it('handles empty positions and missing market prices without meaningless P/L', () => {
    expect(positionMarketSnapshot({ shares: 0, averagePrice: 0 }, 60).empty).toBe(true);
    expect(positionMarketSnapshot(position, 0).available).toBe(false);
  });

  it('keeps planned realized and unrealized values separate', () => {
    const snapshot = plannedPositionMarketSnapshot(position, [
      { id: 'buy', type: 'buy', shares: 20, price: 40, feeMode: 'fixed', feeValue: 10 },
      { id: 'sell', type: 'sell', shares: 30, price: 60, feeMode: 'percent', feeValue: 1 },
    ], 55, { mode: 'fixed', value: 5 });
    expect(snapshot.finalPosition.shares).toBe(90);
    expect(snapshot.realizedProfitLoss).not.toBe(snapshot.unrealizedProfitLoss);
    expect(snapshot.totalFees).toBeCloseTo(28);
  });
});

describe('backup and CSV data utilities', () => {
  it('exports all or active positions with safe metadata', () => {
    const all = createBackup([backupPosition('one'), backupPosition('two')], 'two', 'all', '2026-07-17T00:00:00.000Z');
    expect(all.positions).toHaveLength(2);
    expect(all.activeHoldingId).toBe('two');
    expect(createBackup([backupPosition()], undefined, 'active').activeHoldingId).toBeUndefined();
  });

  it('parses valid current and legacy-schema backups', () => {
    const current = createBackup([backupPosition()], 'one', 'all');
    expect(parseBackupJson(JSON.stringify(current)).positions).toHaveLength(1);
    const legacy = { ...current, backupSchemaVersion: 0, version: '1.5.0' };
    delete (legacy as Record<string, unknown>).applicationVersion;
    expect(parseBackupJson(JSON.stringify(legacy)).backupSchemaVersion).toBe(2);
  });

  it('rejects malformed, unsafe, and invalid backup data before mutation', () => {
    expect(() => parseBackupJson('not json')).toThrow('backup.invalidJson');
    expect(() => parseBackupJson(JSON.stringify({ application: 'Average Price Planner', backupSchemaVersion: 1, applicationVersion: '1.6.0', exportedAt: 'now', scope: 'all', positions: [{ ...backupPosition(), baseShares: -1 }] }))).toThrow('backup.invalidNumericValue');
    expect(() => parseBackupJson('{"application":"Average Price Planner","backupSchemaVersion":1,"applicationVersion":"1.6.0","exportedAt":"now","scope":"all","__proto__":{},"positions":[]}')).toThrow('backup.unsafeObjectKey');
  });

  it('merges colliding identifiers without overwriting current positions', () => {
    const merged = mergeBackupPositions([backupPosition('same')], [backupPosition('same')], () => 'new-id');
    expect(merged.map((item) => item.id)).toEqual(['same', 'new-id']);
  });

  it('creates quoted, formula-safe CSV rows and supports an empty plan', () => {
    expect(csvSafeCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvSafeCell('A,B')).toBe('"A,B"');
    expect(planCsv([])).toContain('Sequence,Type');
    const csv = planCsv([{ sequence: 1, type: 'buy', price: 40, shares: 1, grossAmount: 40, feeMode: 'fixed', feeValue: 0, feeAmount: 0, totalPaid: 40, netReceived: 0, sharesAfter: 101, averageAfter: 49.9, averageChange: -0.1, realizedProfitLoss: 0, currency: '=USD' }]);
    expect(csv).toContain("'=USD");
  });
});
