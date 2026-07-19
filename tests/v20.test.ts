// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createBackup } from '../src/data';
import { t } from '../src/i18n';

const STORE_KEY = 'average-down-optimizer:v2';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:notice-test'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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

  it('renders ordinary Russian UI labels without English parenthetical aliases', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();
    const ordinaryUi = document.querySelector('main')?.textContent ?? '';
    for (const label of [
      'Рыночная стоимость', 'Средняя цена', 'Себестоимость позиции', 'Цена безубыточности',
      'Нереализованный P/L', 'Итоговый P/L', 'Лестница DCA',
      'Стресс-тест', 'Целевая средняя цена', 'Планировщик сценариев', 'Обратный расчёт продажи',
    ]) expect(ordinaryUi).toContain(label);
    expect(t('realizedProfitLoss')).toBe('Реализованный P/L');
    for (const hybrid of [
      'Market value (', 'Average price (', 'Cost basis (', 'Break-even (', 'Realized P/L (',
      'Unrealized P/L (', 'Total P/L (', 'DCA Ladder (', 'Stress test (',
    ]) expect(ordinaryUi).not.toContain(hybrid);
  });

  it('keeps representative English UI labels unchanged', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click();
    expect(t('marketValue')).toBe('Market value');
    expect(t('averageBuyPrice')).toBe('Average buy price');
    expect(t('costBasis')).toBe('Cost basis');
    expect(t('breakEvenPrice')).toBe('Break-even price');
    expect(t('realizedProfitLoss')).toBe('Realized P/L');
    expect(t('dcaLadder')).toBe('DCA Ladder');
    expect(t('stressTests')).toBe('Stress tests');
  });

  it('renders Russian backup and plan CSV notices after successful exports', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();

    document.querySelector<HTMLButtonElement>('#exportAll')?.click();
    expect(document.querySelector('.notice')?.textContent).toBe('Резервная копия сохранена в JSON-файл. Содержимое: 1 позиция; 1 сценарий.');

    document.querySelector<HTMLButtonElement>('#addTransaction')?.click();
    document.querySelector<HTMLButtonElement>('#exportCsv')?.click();
    expect(document.querySelector('.notice')?.textContent).toBe('План экспортирован в CSV. Экспортировано: 1 операция плана.');
  });

  it('renders the shared Russian completion notice after Merge and Replace imports', async () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();
    const persisted = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { holdings: Array<Record<string, unknown>>; scenarios: Array<Record<string, unknown>> };
    const importedPosition = { ...persisted.holdings[0], id: 'import-position', transactions: [] };
    const importedScenario = { ...persisted.scenarios[0], id: 'import-scenario', holdingId: 'import-position', transactions: [] };
    const selectBackup = async (backup: ReturnType<typeof createBackup>): Promise<void> => {
      const input = document.querySelector<HTMLInputElement>('#importJson');
      if (!input) throw new Error('Missing backup import input');
      Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(backup) }] as unknown as FileList });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await selectBackup(createBackup([importedPosition], 'import-position', 'all', '2026-07-19T00:00:00.000Z', [importedScenario]));
    document.querySelector<HTMLButtonElement>('#applyMergeImport')?.click();
    expect(document.querySelector('.notice')?.textContent).toBe('Импорт завершён: 1 позиция; 0 операций плана; 1 сценарий.');

    await selectBackup(createBackup([], undefined, 'all', '2026-07-19T00:00:00.000Z'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('#applyReplaceImport')?.click();
    confirm.mockRestore();
    expect(document.querySelector('.notice')?.textContent).toBe('Импорт завершён: 0 позиций; 0 операций плана; 0 сценариев.');
  });
});
