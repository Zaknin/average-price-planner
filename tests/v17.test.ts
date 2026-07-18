import { describe, expect, it } from 'vitest';
import { ladderCsv, mergeBackupScenarios, parseBackupJson, scenarioCsv } from '../src/data';
import type { DcaLadder, Scenario, ScenarioTransaction } from '../src/domain';
import { generateDcaLadder, previewExecutionApplication, projectLadder, reverseSell, stressPrices, summarizeScenario } from '../src/planner';

const base = { shares: 100, averagePrice: 50 };
const ladder = (overrides: Partial<DcaLadder> = {}): DcaLadder => ({
  levelCount: 3, startPrice: 40, endPrice: 20, distribution: 'equalCash', spacing: 'linear', totalInvestment: 300,
  totalShares: 9, feeMode: 'percent', percentFeeValue: 1, fixedFeeValue: 2, sharePrecision: 1, pricePrecision: 2,
  includeCurrentPosition: false, levels: [], ...overrides,
});
const transaction = (id: string, extra: Partial<ScenarioTransaction> = {}): ScenarioTransaction => ({
  id, type: 'buy', shares: 10, price: 40, feeMode: 'percent', feeValue: 0, status: 'planned', createdAt: '2026-07-18T00:00:00Z', updatedAt: '2026-07-18T00:00:00Z', createdOrder: 0, ...extra,
});
const scenario = (transactions: ScenarioTransaction[] = []): Scenario => ({
  id: 's1', holdingId: 'h1', name: 'Scenario', note: '', status: 'draft', createdAt: '2026-07-18T00:00:00Z', updatedAt: '2026-07-18T00:00:00Z', basePosition: base, marketPrice: 55, transactions, ladder: null,
  stressPrices: [{ id: 'drop', kind: 'percent', value: -30 }, { id: 'spot', kind: 'absolute', value: 55 }],
});

describe('v1.7 DCA ladder', () => {
  it('keeps equal-cash percentage-fee allocation within the all-in budget', () => {
    const generated = generateDcaLadder({ ...ladder(), makeId: () => Math.random().toString() });
    expect(generated.error).toBeNull();
    const spent = projectLadder(generated.ladder, { shares: 0, averagePrice: 0 }, 0).reduce((sum, row) => sum + row.totalAmount, 0);
    expect(spent).toBeLessThanOrEqual(300);
    expect(generated.unallocatedCash).toBeCloseTo(300 - spent);
  });

  it('uses equal-percent prices and assigns equal-share residual to the final row', () => {
    const generated = generateDcaLadder({ ...ladder({ distribution: 'equalShares', spacing: 'percent', totalShares: 10, sharePrecision: 1 }), makeId: () => crypto.randomUUID() });
    expect(generated.ladder.levels.map((level) => level.shares)).toEqual([3, 3, 4]);
    expect(generated.ladder.levels[1]!.price / generated.ladder.levels[0]!.price).toBeCloseTo(generated.ladder.levels[2]!.price / generated.ladder.levels[1]!.price, 2);
  });

  it('rejects a fixed-fee equal-cash level that cannot cover its fee', () => {
    const generated = generateDcaLadder({ ...ladder({ totalInvestment: 3, feeMode: 'fixed', fixedFeeValue: 2 }), makeId: () => 'id' });
    expect(generated.error).toContain('cannot cover');
    expect(generated.errorCode).toBe('ladderFeeUncovered');
  });

  it('includes the current position only when requested', () => {
    const generated = generateDcaLadder({ ...ladder({ levelCount: 2, totalInvestment: 200, includeCurrentPosition: true }), makeId: () => crypto.randomUUID() });
    expect(projectLadder(generated.ladder, base, 55)[0]!.cumulativePosition.shares).toBeGreaterThan(100);
  });
});

describe('v1.7 reverse sales and scenarios', () => {
  it('solves a fee-aware price and rounded-up share quantity', () => {
    const price = reverseSell({ position: base, fee: { mode: 'percent', value: 1 }, shareStep: 1, mode: 'profit', direction: 'price', shares: 10, targetValue: 100 });
    expect(price.valid).toBe(true);
    expect(price.requiredPrice).toBeCloseTo(60.606, 2);
    const shares = reverseSell({ position: base, fee: { mode: 'fixed', value: 10 }, shareStep: 1, mode: 'netProceeds', direction: 'shares', price: 60, targetValue: 500 });
    expect(shares.valid).toBe(true);
    expect(shares.requiredShares).toBe(9);
  });

  it('rejects oversells, 100% percentage fees, and return-at-price share solving', () => {
    const oversell = reverseSell({ position: base, fee: { mode: 'percent', value: 0 }, shareStep: 1, mode: 'profit', direction: 'price', shares: 101, targetValue: 1 });
    expect(oversell.valid).toBe(false);
    expect(oversell.errorCode).toBe('invalidSaleQuantity');
    const excessiveFee = reverseSell({ position: base, fee: { mode: 'percent', value: 100 }, shareStep: 1, mode: 'profit', direction: 'price', shares: 1, targetValue: 1 });
    expect(excessiveFee.valid).toBe(false);
    expect(excessiveFee.errorCode).toBe('invalidSellFee');
    const atPrice = reverseSell({ position: base, fee: { mode: 'percent', value: 0 }, shareStep: 1, mode: 'return', direction: 'shares', shares: 10, price: 60, targetValue: 10 });
    expect(atPrice.valid).toBe(true);
    expect(atPrice.returnPercent).toBe(20);
  });

  it('uses execution overrides, excludes cancelled rows, and blocks an invalid sequence atomically', () => {
    const working = scenario([
      transaction('executed', { status: 'executed', executionPrice: 30, executionShares: 5, actualFee: 2, createdOrder: 1 }),
      transaction('cancelled', { status: 'cancelled', createdOrder: 2 }),
    ]);
    const summary = summarizeScenario(working, { mode: 'percent', value: 0 });
    expect(summary.finalPosition.shares).toBe(105);
    expect(summary.finalPosition.averagePrice).toBeCloseTo((5000 + 152) / 105);
    expect(previewExecutionApplication(base, working).candidates).toHaveLength(1);
    const invalid = scenario([transaction('sell', { type: 'sell', status: 'executed', shares: 101, executionDate: '2026-07-18T00:00:00Z' })]);
    expect(previewExecutionApplication(base, invalid).valid).toBe(false);
    expect(previewExecutionApplication(base, invalid).errorCode).toBe('executionApplyFailed');
  });

  it('does not apply an already-applied execution twice and expands/sorts stress entries', () => {
    const applied = scenario([transaction('done', { status: 'executed', appliedAt: '2026-07-18T01:00:00Z' })]);
    expect(previewExecutionApplication(base, applied).candidates).toHaveLength(0);
    expect(stressPrices(applied.stressPrices, 50).map((item) => item.price)).toEqual([35, 55]);
  });
});

describe('v1.7 data migration and exports', () => {
  it('normalizes v1 backup documents with empty scenario data and avoids scenario ID collisions', () => {
    const legacy = { application: 'Average Price Planner', backupSchemaVersion: 1, applicationVersion: '1.6.0', exportedAt: '2026-07-18T00:00:00Z', scope: 'all', positions: [{ id: 'h1', baseShares: 1, baseAverage: 1, transactions: [] }] };
    expect(parseBackupJson(JSON.stringify(legacy)).scenarios).toEqual([]);
    const existing = [{ ...scenario([transaction('same-transaction')]), id: 'same' }] as unknown as Record<string, unknown>[];
    const merged = mergeBackupScenarios(existing, existing, () => 'new');
    expect(merged.map((item) => item.id)).toEqual(['same', 'new']);
    expect(((merged[1]!.transactions as Array<{ id: string }>)[0]!.id)).not.toBe('same-transaction');
  });

  it('creates UTF-8, formula-safe scenario and ladder CSV', () => {
    const scenarios = scenarioCsv([{ sequence: 1, scenarioName: '=Bad, name', scenarioStatus: 'draft', transactionStatus: 'planned', type: 'buy', date: '2026-07-18', shares: 1, price: 20, feeMode: 'fixed', feeValue: 0, grossAmount: 20, feeAmount: 0, totalPaid: 20, netReceived: 0, sharesAfter: 1, averageAfter: 20, averageChange: 0, realizedProfitLoss: 0, note: 'Привет', brokerLabel: '=Broker', applied: 'Not applied', currency: 'USD' }]);
    expect(scenarios.startsWith('\uFEFF')).toBe(true);
    expect(scenarios).toContain("'=Bad, name");
    expect(scenarios).toContain("'=Broker");
    expect(ladderCsv([{ level: 1, price: 20, shares: 1, grossAmount: 20, feeMode: 'fixed', feeValue: 0, feeAmount: 0, totalAmount: 20, cumulativeShares: 1, cumulativeBasis: 20, cumulativeAverage: 20, currency: '=USD' }])).toContain("'=USD");
  });
});
