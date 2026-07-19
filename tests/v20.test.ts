// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

const STORE_KEY = 'average-down-optimizer:v2';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 4,
    activeHoldingId: 'holding-1',
    comparisonScenarioIds: [],
    holdings: [{
      id: 'holding-1', ticker: 'TEST', currency: 'USD', baseShares: 2, baseAverage: 50,
      currentMarketPrice: 55, action: 'buy', transactionPrice: 45, transactionShares: 2,
      budget: 4000, shareStep: 0.01, efficiencyFloor: 0.25, budgetBenefitTarget: 0.8,
      buyFee: { mode: 'percent', value: 0 }, sellFee: { mode: 'percent', value: 0 }, transactions: [],
    }],
    scenarios: [{
      id: 'scenario-1', holdingId: 'holding-1', name: 'Price contexts', note: '', status: 'draft',
      createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
      basePosition: { shares: 2, averagePrice: 50 }, marketPrice: 55, ladder: null, stressPrices: [],
      transactions: [
        { id: 'executed-buy', type: 'buy', shares: 2, price: 40, feeMode: 'percent', feeValue: 0, status: 'executed', executionPrice: 45, executionShares: 2, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z', createdOrder: 0 },
        { id: 'planned-sell', type: 'sell', shares: 0.5, price: 55, feeMode: 'percent', feeValue: 0, status: 'planned', createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z', createdOrder: 1 },
      ],
    }],
  }));
  await import('../src/main');
});

describe('v2.0 Russian quantity and price summaries', () => {
  it('uses average, transaction, and market price phrases in their rendered contexts', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();

    const currentPosition = document.querySelector('.position-pill')?.textContent ?? '';
    expect(currentPosition).toContain('2 акции · средняя цена — 50,00');
    expect(currentPosition).not.toContain(' @ ');
    expect(currentPosition).not.toContain('по цене');

    document.querySelector<HTMLButtonElement>('#toggleMarketSnapshot')?.click();
    const marketSnapshot = document.querySelector('#market-snapshot')?.textContent ?? '';
    expect(marketSnapshot).toContain('2 акции по текущей цене 55,00');
    expect(marketSnapshot).not.toContain('2 акции @');
    expect(marketSnapshot).not.toContain('2 акции · средняя цена');

    const savedScenario = document.querySelector('.saved-scenario-cards .scenario-card')?.textContent ?? '';
    expect(savedScenario).toContain('3,5 акции · средняя цена — 47,50');
    expect(savedScenario).not.toContain(' @ ');
    expect(savedScenario).not.toContain('по цене');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('[data-load-scenario]')?.click();
    confirm.mockRestore();
    const scenarioTransactions = document.querySelector('.scenario-transaction-cards')?.textContent ?? '';
    expect(scenarioTransactions).toContain('2 акции по цене 45,00');
    expect(scenarioTransactions).toContain('0,5 акции по цене 55,00');
    expect(scenarioTransactions).toContain('Исполнено');
    expect(scenarioTransactions).not.toContain(' @ ');
    expect(scenarioTransactions).not.toContain('средняя цена');

    const comparison = document.querySelector<HTMLInputElement>('[data-compare-scenario]');
    if (!comparison) throw new Error('Missing scenario comparison control');
    comparison.checked = true;
    comparison.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#toggleComparison')?.click();
    const comparisonText = document.querySelector('#scenario-comparison')?.textContent ?? '';
    expect(comparisonText).toContain('2 акции · средняя цена — 50,00');
    expect(comparisonText).toContain('Итоговая средняя цена');
    expect(comparisonText).toContain('47,50');
    expect(comparisonText).not.toContain(' @ ');
    expect(comparisonText).not.toContain('2 акции по цене');

    const setField = (id: string, value: string): void => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) throw new Error(`Missing ${id}`);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setField('baseShares', '1');
    const singularMarketSnapshot = document.querySelector('#market-snapshot')?.textContent ?? '';
    expect(singularMarketSnapshot).toContain('1 акция по текущей цене 55,00');
    expect(singularMarketSnapshot).not.toContain('1 акция @');
  });

  it('retains English @ notation for the same rendered summaries', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click();
    expect(document.querySelector('.position-pill')?.textContent).toContain('1 share @ $50.00');
    expect(document.querySelector('#market-snapshot')?.textContent).toContain('1 share @ $55.00');
    expect(document.querySelector('.scenario-transaction-cards')?.textContent).toContain('2 shares @ $45.00');
  });
});
