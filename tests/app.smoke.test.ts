// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  await import('../src/main');
});

describe('application smoke test', () => {
  it('renders the default buy analysis', () => {
    expect(document.body.textContent).toContain('Average Price Planner');
    expect(document.body.textContent).toContain('New average');
    expect(document.body.textContent).toContain('$46.6667');
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
    expect(document.querySelector<HTMLInputElement>('#transactionShares')?.value).toBe('0');
    expect(document.querySelector<HTMLInputElement>('#transactionPrice')?.value).toBe(priceBefore);
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
