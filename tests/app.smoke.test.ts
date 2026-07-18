// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  localStorage.setItem('average-down-optimizer:v2', JSON.stringify({
    version: 2,
    activeHoldingId: 'pre-fee-position',
    holdings: [{
      id: 'pre-fee-position', ticker: '', currency: 'USD', baseShares: 100, baseAverage: 50,
      action: 'buy', transactionPrice: 40, transactionShares: 50, budget: 4000, shareStep: 1,
      efficiencyFloor: 0.25, budgetBenefitTarget: 0.8, transactions: [],
    }],
  }));
  await import('../src/main');
});

describe('application smoke test', () => {
  it('renders the default buy analysis', () => {
    expect(document.body.textContent).toContain('Average Price Planner');
    expect(document.body.textContent).toContain('New average');
    expect(document.body.textContent).toContain('$46.6667');
  });

  it('migrates fee settings for existing positions without changing their data', () => {
    const saved = JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}');
    expect(saved.holdings[0].buyFee).toEqual({ mode: 'percent', value: 0 });
    expect(saved.holdings[0].sellFee).toEqual({ mode: 'percent', value: 0 });
    expect(saved.version).toBe(4);
    expect(saved.holdings[0].currentMarketPrice).toBe(0);
    expect(saved.holdings[0].targetSellMode).toBe('breakEven');
    expect(document.querySelector<HTMLInputElement>('#transactionFee')?.value).toBe('0');
  });

  it('keeps Buy and Sell fee preferences separate', () => {
    const buyFee = document.querySelector<HTMLInputElement>('#transactionFee');
    expect(buyFee).not.toBeNull();
    if (!buyFee) return;
    buyFee.value = '0.2';
    buyFee.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('[data-action="sell"]')?.click();
    expect(document.querySelector<HTMLInputElement>('#transactionFee')?.value).toBe('0');
    document.querySelector<HTMLButtonElement>('[data-fee-mode="fixed"]')?.click();
    const sellFee = document.querySelector<HTMLInputElement>('#transactionFee');
    if (!sellFee) return;
    sellFee.value = '10';
    sellFee.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('[data-action="buy"]')?.click();
    expect(document.querySelector<HTMLInputElement>('#transactionFee')?.value).toBe('0.2');
    expect(document.querySelector<HTMLButtonElement>('[data-fee-mode="percent"]')?.classList.contains('active')).toBe(true);

    const restoredBuyFee = document.querySelector<HTMLInputElement>('#transactionFee');
    if (!restoredBuyFee) return;
    restoredBuyFee.value = '0';
    restoredBuyFee.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="sell"]')?.click();
    const restoredSellFee = document.querySelector<HTMLInputElement>('#transactionFee');
    if (!restoredSellFee) return;
    restoredSellFee.value = '0';
    restoredSellFee.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-fee-mode="percent"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="buy"]')?.click();
  });

  it('switches the calculator language without putting locale in the portfolio store', () => {
    const before = JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}');
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();
    expect(document.documentElement.lang).toBe('ru');
    expect(document.body.textContent).toContain('Планировщик средней цены');
    expect(document.body.textContent).toContain('Проверка операции');
    expect(JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}')).toEqual(before);
    expect(localStorage.getItem('average-price-planner:locale')).toBe('ru');
    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click();
  });

  it('renders localized Scenario Planner and DCA controls in Russian', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();
    document.querySelector<HTMLButtonElement>('#newScenario')?.click();
    document.querySelector<HTMLButtonElement>('#toggleScenarioPlanner')?.click();
    expect(document.body.textContent).toContain('Название сценария');
    expect(document.body.textContent).toContain('Лестница DCA');
    expect(document.body.textContent).toContain('Равными суммами');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('[data-delete-scenario]')?.click();
    confirm.mockRestore();
    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click();
  });

  it('keeps buying-guide result cards localized in Russian', () => {
    document.querySelector<HTMLButtonElement>('[data-locale="ru"]')?.click();
    expect(document.body.textContent).toContain('Ориентир убывающей отдачи');
    expect(document.body.textContent).toContain('Меньшая покупка с близким эффектом');
    expect(document.body.textContent).not.toContain('Diminishing-return reference');
    expect(document.body.textContent).not.toContain('Smaller buy with similar benefit');
    document.querySelector<HTMLButtonElement>('[data-locale="en"]')?.click();
  });

  it('recalculates when the transaction price changes', () => {
    const priceInput = document.querySelector<HTMLInputElement>('#transactionPrice');
    expect(priceInput).not.toBeNull();
    if (!priceInput) return;

    priceInput.value = '30';
    priceInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.body.textContent).toContain('$43.3333');
  });

  it('adds a buy to the plan, resets shares, and keeps the price', () => {
    const priceBefore = document.querySelector<HTMLInputElement>('#transactionPrice')?.value;
    const addButton = document.querySelector<HTMLButtonElement>('#addTransaction');
    expect(addButton).not.toBeNull();
    addButton?.click();

    expect(document.body.textContent).toContain('Buy added to the plan');
    expect(document.querySelectorAll('[data-remove]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-remove-mobile]')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('#transactionShares')?.value).toBe('0');
    expect(document.querySelector<HTMLInputElement>('#transactionPrice')?.value).toBe(priceBefore);
  });

  it('creates, loads, archives, restores, compares, and deletes a scenario with confirmations', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('#newScenario')?.click();
    expect(document.querySelector<HTMLInputElement>('#scenarioName')).not.toBeNull();
    const initialName = document.querySelector<HTMLInputElement>('#scenarioName');
    if (initialName) { initialName.value = 'Mobile plan'; initialName.dispatchEvent(new Event('change', { bubbles: true })); }
    const saved = JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}');
    expect(saved.scenarios).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-load-scenario]')?.click();
    expect(confirm).toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-duplicate-scenario]')?.click();
    expect(JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}').scenarios).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-scenario-archive]')?.click();
    expect(document.body.textContent).toContain('archived');
    document.querySelector<HTMLButtonElement>('[data-scenario-archive]')?.click();
    expect(document.body.textContent).toContain('restored');
    const compare = document.querySelector<HTMLInputElement>('[data-compare-scenario]');
    if (compare) { compare.checked = true; compare.dispatchEvent(new Event('change', { bubbles: true })); }
    expect(document.querySelectorAll('.comparison-cards .scenario-card')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-delete-scenario]')?.click();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('previews and applies executed scenario rows only after confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('#toggleScenarioPlanner')?.click();
    document.querySelector<HTMLButtonElement>('[data-status="executed"]')?.click();
    document.querySelector<HTMLButtonElement>('#previewApplyExecuted')?.click();
    expect(document.body.textContent).toContain('Review before applying');
    document.querySelector<HTMLButtonElement>('#confirmApplyExecuted')?.click();
    expect(document.body.textContent).toContain('Applied 1 executed transaction');
    expect(JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}').scenarios.some((scenario: { transactions: Array<{ appliedAt?: string }> }) => scenario.transactions.some((transaction) => transaction.appliedAt))).toBe(true);
    confirm.mockRestore();
  });

  it('renders mobile-specific controls and accessible disclosures', () => {
    const holdingEditor = document.querySelector<HTMLButtonElement>('#toggleHoldingEditor');
    expect(holdingEditor?.getAttribute('aria-controls')).toBe('holdingEditor');
    expect(holdingEditor?.getAttribute('aria-expanded')).toBe('false');
    holdingEditor?.click();
    expect(document.querySelector('#holdingEditor')?.classList.contains('is-expanded')).toBe(true);

    const curveToggle = document.querySelector<HTMLButtonElement>('#toggleCurve');
    expect(curveToggle?.getAttribute('aria-controls')).toBe('improvementCurve');
    expect(curveToggle?.getAttribute('aria-expanded')).toBe('false');
    curveToggle?.click();
    expect(document.querySelector('#improvementCurve')?.classList.contains('is-expanded')).toBe(true);

    expect(document.querySelectorAll('.scenario-card')).not.toHaveLength(0);
    expect(document.querySelectorAll('.transaction-card').length).toBeGreaterThanOrEqual(1);
  });

  it('creates and switches to another saved position', () => {
    const newButton = document.querySelector<HTMLButtonElement>('#newHolding');
    newButton?.click();

    const select = document.querySelector<HTMLSelectElement>('#holdingSelect');
    expect(select?.options.length).toBe(2);
    expect(document.body.textContent).toContain('New position created');
  });

  it('supports a sale preview after entering the new position', () => {
    const shares = document.querySelector<HTMLInputElement>('#baseShares');
    const average = document.querySelector<HTMLInputElement>('#baseAverage');
    expect(shares).not.toBeNull();
    expect(average).not.toBeNull();
    if (!shares || !average) return;

    shares.value = '10';
    average.value = '20';
    shares.dispatchEvent(new Event('change', { bubbles: true }));

    const refreshedAverage = document.querySelector<HTMLInputElement>('#baseAverage');
    if (!refreshedAverage) return;
    refreshedAverage.value = '20';
    refreshedAverage.dispatchEvent(new Event('change', { bubbles: true }));

    const price = document.querySelector<HTMLInputElement>('#transactionPrice');
    const transactionShares = document.querySelector<HTMLInputElement>('#transactionShares');
    if (!price || !transactionShares) return;
    price.value = '25';
    transactionShares.value = '2';
    price.dispatchEvent(new Event('change', { bubbles: true }));

    const refreshedTransactionShares = document.querySelector<HTMLInputElement>('#transactionShares');
    if (!refreshedTransactionShares) return;
    refreshedTransactionShares.value = '2';
    refreshedTransactionShares.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('[data-action="sell"]')?.click();
    expect(document.body.textContent).toContain('Selling shares does not change the average cost');

    const salePrice = document.querySelector<HTMLInputElement>('#transactionPrice')?.value;
    document.querySelector<HTMLButtonElement>('#addTransaction')?.click();
    expect(document.body.textContent).toContain('Sale added to the plan');
    expect(document.querySelector<HTMLInputElement>('#transactionShares')?.value).toBe('0');
    expect(document.querySelector<HTMLInputElement>('#transactionPrice')?.value).toBe(salePrice);
    expect(document.querySelectorAll('.transaction-card .action-tag.sell')).toHaveLength(1);
  });

  it('shows purchase settings without a disclosure and gives both sliders a 5–100 range', () => {
    expect(document.querySelector('details.advanced-settings')).toBeNull();
    expect(document.body.textContent).toContain('Purchase settings');

    const efficiency = document.querySelector<HTMLInputElement>('#efficiencyFloor');
    const budgetBenefit = document.querySelector<HTMLInputElement>('#budgetBenefitTarget');
    expect(efficiency?.min).toBe('5');
    expect(efficiency?.max).toBe('100');
    expect(budgetBenefit?.min).toBe('5');
    expect(budgetBenefit?.max).toBe('100');
  });

  it('uses clearer Buying Guide labels without changing the calculator inputs', () => {
    document.querySelector<HTMLButtonElement>('[data-action="buy"]')?.click();
    const price = document.querySelector<HTMLInputElement>('#transactionPrice');
    if (price) { price.value = '10'; price.dispatchEvent(new Event('change', { bubbles: true })); }
    const shares = document.querySelector<HTMLInputElement>('#transactionShares');
    if (shares) { shares.value = '1'; shares.dispatchEvent(new Event('change', { bubbles: true })); }
    expect(document.body.textContent).toContain('Minimum effect of the next share');
    expect(document.body.textContent).toContain('Target share of the full-budget improvement');
    expect(document.body.textContent).toContain('Diminishing-return reference');
    expect(document.body.textContent).toContain('Available average reduction reached');
    expect(document.body.textContent).not.toContain('Next-share usefulness cutoff');
    expect(document.body.textContent).not.toContain('Keep this much of the full-budget benefit');
  });

  it('persists a current market price and exposes target disclosures without changing the holding', () => {
    const price = document.querySelector<HTMLInputElement>('#currentMarketPrice');
    expect(price).not.toBeNull();
    if (!price) return;
    price.value = '30';
    price.dispatchEvent(new Event('change', { bubbles: true }));
    expect(JSON.parse(localStorage.getItem('average-down-optimizer:v2') ?? '{}').holdings.some((holding: { currentMarketPrice: number }) => holding.currentMarketPrice === 30)).toBe(true);

    const targetToggle = document.querySelector<HTMLButtonElement>('#toggleTargets');
    expect(targetToggle?.getAttribute('aria-controls')).toBe('targetsContent');
    expect(targetToggle?.getAttribute('aria-expanded')).toBe('false');
    targetToggle?.click();
    expect(document.querySelector('#targetsContent')?.classList.contains('is-expanded')).toBe(true);
    expect(document.body.textContent).toContain('Target average');

    const targetAverage = document.querySelector<HTMLInputElement>('#targetAverage');
    const targetBuyPrice = document.querySelector<HTMLInputElement>('#targetBuyPrice');
    if (!targetAverage || !targetBuyPrice) return;
    targetAverage.value = '15';
    targetAverage.dispatchEvent(new Event('input', { bubbles: true }));
    targetBuyPrice.value = '10';
    targetBuyPrice.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-target-tab="average"]')?.click();
    expect(document.body.textContent).toContain('Shares needed');
  });

  it('opens Help without changing storage and restores an unsaved transaction field on return', async () => {
    const before = localStorage.getItem('average-down-optimizer:v2');
    const transactionPrice = document.querySelector<HTMLInputElement>('#transactionPrice');
    if (!transactionPrice) return;
    transactionPrice.value = '33.25';
    document.querySelector<HTMLButtonElement>('#openHelp')?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(window.location.hash).toBe('#help');
    expect(document.body.textContent).toContain('How to use Average Price Planner');
    expect(localStorage.getItem('average-down-optimizer:v2')).toBe(before);
    document.querySelector<HTMLButtonElement>('#helpBackTop')?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(window.location.hash).toBe('');
    expect(document.querySelector<HTMLInputElement>('#transactionPrice')?.value).toBe('33.25');

    document.querySelector<HTMLButtonElement>('[data-help-open="market-snapshot"]')?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(window.location.hash).toBe('#help/market-snapshot');
    expect(document.querySelector('#helpArticleTitle')?.textContent).toBe('Current market snapshot');
    document.querySelector<HTMLButtonElement>('#helpBack')?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });

  it('can delete the final remaining position and opens a blank replacement', () => {
    while ((document.querySelector<HTMLSelectElement>('#holdingSelect')?.options.length ?? 0) > 1) {
      document.querySelector<HTMLButtonElement>('#deleteHolding')?.click();
    }

    document.querySelector<HTMLButtonElement>('#deleteHolding')?.click();

    expect(document.body.textContent).toContain('Position deleted');
    expect(document.querySelector<HTMLInputElement>('#ticker')?.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#baseShares')?.value).toBe('0');
    expect(document.querySelector<HTMLButtonElement>('#deleteHolding')?.disabled).toBe(false);
  });

});
