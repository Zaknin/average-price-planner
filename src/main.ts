import './styles.css';
import {
  analyzePurchase,
  applyTransaction,
  applyTransactions,
  budgetEfficientQuantity,
  budgetMaximumQuantity,
  isFinitePositive,
  quantityForMarginalEfficiencyFloor,
  quantityForTheoreticalCapture,
  roundToShareStep,
  type Position,
  type Transaction,
  type TransactionResult,
  type TransactionType,
} from './calculator';

type HoldingState = {
  id: string;
  ticker: string;
  currency: string;
  baseShares: number;
  baseAverage: number;
  action: TransactionType;
  transactionPrice: number;
  transactionShares: number;
  budget: number;
  shareStep: number;
  efficiencyFloor: number;
  budgetBenefitTarget: number;
  transactions: Transaction[];
};

type AppStore = {
  version: 2;
  activeHoldingId: string;
  holdings: HoldingState[];
};

type LegacyState = {
  ticker?: string;
  currency?: string;
  baseShares?: number;
  baseAverage?: number;
  purchasePrice?: number;
  purchaseShares?: number;
  budget?: number;
  shareStep?: number;
  efficiencyFloor?: number;
  budgetBenefitTarget?: number;
  purchases?: Array<{ id?: string; shares: number; price: number }>;
};

const STORAGE_KEY = 'average-down-optimizer:v2';
const LEGACY_STORAGE_KEY = 'average-down-optimizer:v1';

const appElement = document.querySelector<HTMLDivElement>('#app');
if (!appElement) throw new Error('Application root was not found.');
const app: HTMLDivElement = appElement;

let notice = '';
let store = loadStore();

function createId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    try {
      return cryptoObject.randomUUID();
    } catch {
      // Plain HTTP deployments may expose crypto without allowing randomUUID.
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createHolding(overrides: Partial<HoldingState> = {}): HoldingState {
  return {
    id: createId(),
    ticker: '',
    currency: 'USD',
    baseShares: 100,
    baseAverage: 50,
    action: 'buy',
    transactionPrice: 40,
    transactionShares: 50,
    budget: 4000,
    shareStep: 1,
    efficiencyFloor: 0.25,
    budgetBenefitTarget: 0.8,
    transactions: [],
    ...overrides,
  };
}

function normalizeHolding(value: Partial<HoldingState>): HoldingState {
  const defaults = createHolding();
  return {
    ...defaults,
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : defaults.id,
    ticker: typeof value.ticker === 'string' ? value.ticker : '',
    currency: typeof value.currency === 'string' && value.currency ? value.currency : 'USD',
    action: value.action === 'sell' ? 'sell' : 'buy',
    transactions: Array.isArray(value.transactions)
      ? value.transactions
          .filter((item): item is Transaction => Boolean(item && isFinitePositive(Number(item.shares)) && isFinitePositive(Number(item.price))))
          .map((item) => ({
            id: typeof item.id === 'string' && item.id ? item.id : createId(),
            type: item.type === 'sell' ? 'sell' : 'buy',
            shares: Number(item.shares),
            price: Number(item.price),
          }))
      : [],
  };
}

function migrateLegacy(raw: string): AppStore | null {
  try {
    const legacy = JSON.parse(raw) as LegacyState;
    const holding = createHolding({
      ticker: legacy.ticker ?? '',
      currency: legacy.currency ?? 'USD',
      baseShares: Number(legacy.baseShares ?? 100),
      baseAverage: Number(legacy.baseAverage ?? 50),
      transactionPrice: Number(legacy.purchasePrice ?? 40),
      transactionShares: Number(legacy.purchaseShares ?? 50),
      budget: Number(legacy.budget ?? 4000),
      shareStep: Number(legacy.shareStep ?? 1),
      efficiencyFloor: Number(legacy.efficiencyFloor ?? 0.25),
      budgetBenefitTarget: Number(legacy.budgetBenefitTarget ?? 0.8),
      transactions: Array.isArray(legacy.purchases)
        ? legacy.purchases.map((purchase) => ({
            id: purchase.id || createId(),
            type: 'buy' as const,
            shares: Number(purchase.shares),
            price: Number(purchase.price),
          }))
        : [],
    });
    return { version: 2, activeHoldingId: holding.id, holdings: [holding] };
  } catch {
    return null;
  }
}

function loadStore(): AppStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppStore>;
      const holdings = Array.isArray(parsed.holdings)
        ? parsed.holdings.map((holding) => normalizeHolding(holding))
        : [];
      if (holdings.length) {
        const activeHoldingId = holdings.some((holding) => holding.id === parsed.activeHoldingId)
          ? String(parsed.activeHoldingId)
          : holdings[0]!.id;
        return { version: 2, activeHoldingId, holdings };
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const migrated = migrateLegacy(legacyRaw);
      if (migrated) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    // Start with a clean local store if browser data is malformed or unavailable.
  }

  const holding = createHolding();
  return { version: 2, activeHoldingId: holding.id, holdings: [holding] };
}

function saveStore(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    notice = 'Browser storage is unavailable, so changes may not persist after this tab closes.';
  }
}

function activeHolding(): HoldingState {
  const selected = store.holdings.find((holding) => holding.id === store.activeHoldingId);
  if (selected) return selected;
  const fallback = store.holdings[0] ?? createHolding();
  if (!store.holdings.length) store.holdings.push(fallback);
  store.activeHoldingId = fallback.id;
  return fallback;
}

function numberFromInput(id: string): number {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  return input ? Number(input.value) : 0;
}

function textFromInput(id: string): string {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  return input?.value.trim() ?? '';
}

function updateHoldingFromInputs(): void {
  const holding = activeHolding();
  holding.ticker = textFromInput('ticker').toUpperCase().replace(/[^A-Z0-9._ -]/g, '').slice(0, 24);
  holding.currency = textFromInput('currency').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';
  holding.baseShares = numberFromInput('baseShares');
  holding.baseAverage = numberFromInput('baseAverage');
  holding.transactionPrice = numberFromInput('transactionPrice');
  holding.transactionShares = numberFromInput('transactionShares');
  holding.budget = numberFromInput('budget');
  holding.shareStep = numberFromInput('shareStep');
  holding.efficiencyFloor = numberFromInput('efficiencyFloor') / 100;
  holding.budgetBenefitTarget = numberFromInput('budgetBenefitTarget') / 100;
  saveStore();
}

function formatCurrency(value: number, holding = activeHolding()): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: holding.currency || 'USD',
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${holding.currency || '$'} ${value.toFixed(4)}`;
  }
}

function formatQuantity(value: number, holding = activeHolding()): string {
  if (!Number.isFinite(value)) return '—';
  const step = holding.shareStep;
  const digits = step < 1
    ? Math.min(6, Math.max(3, String(step).split('.')[1]?.length ?? 3))
    : 2;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function percent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function validBasePosition(holding = activeHolding()): Position | null {
  if (!isFinitePositive(holding.baseShares) || !isFinitePositive(holding.baseAverage)) return null;
  return { shares: holding.baseShares, averagePrice: holding.baseAverage };
}

function effectivePosition(holding = activeHolding()): {
  base: Position | null;
  position: Position | null;
  results: TransactionResult[];
} {
  const base = validBasePosition(holding);
  if (!base) return { base: null, position: null, results: [] };
  const applied = applyTransactions(base, holding.transactions);
  return { base, position: applied.finalPosition, results: applied.results };
}

function holdingName(holding: HoldingState, index: number): string {
  const ticker = holding.ticker.trim() || `Position ${index + 1}`;
  return `${ticker} · ${formatQuantity(holding.baseShares, holding)} shares`;
}

function metricCard(title: string, value: string, detail: string, footer = '', tone = ''): string {
  return `
    <article class="metric-card ${tone}">
      <span class="metric-label">${title}</span>
      <strong class="metric-value">${value}</strong>
      <span class="metric-detail">${detail}</span>
      ${footer ? `<span class="metric-footer">${footer}</span>` : ''}
    </article>
  `;
}

function transactionSummary(position: Position, holding: HoldingState): string {
  if (!isFinitePositive(holding.transactionPrice) || !isFinitePositive(holding.transactionShares)) {
    return `<div class="empty-state compact-empty">Enter a price and number of shares to see the result.</div>`;
  }

  if (holding.action === 'sell') {
    if (holding.transactionShares > position.shares) {
      return `
        <div class="plain-summary warning-summary">
          <span>Check the share amount</span>
          <strong>You only have ${formatQuantity(position.shares)} shares available in this planned position.</strong>
          <p>Reduce the sale to ${formatQuantity(position.shares)} shares or less.</p>
        </div>
      `;
    }

    const result = applyTransaction(position, {
      id: 'preview',
      type: 'sell',
      price: holding.transactionPrice,
      shares: holding.transactionShares,
    });
    const gainOrLoss = result.realizedProfitLoss >= 0 ? 'estimated gain' : 'estimated loss';
    return `
      <div class="plain-summary">
        <span>Quick answer</span>
        <strong>Selling ${formatQuantity(result.shares)} shares at ${formatCurrency(result.price)} leaves ${formatQuantity(result.sharesAfter)} shares.</strong>
        <p>You receive ${formatCurrency(result.grossAmount)} before fees. Your average cost stays ${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : 'closed'}, with an ${gainOrLoss} of ${formatCurrency(Math.abs(result.realizedProfitLoss))}.</p>
      </div>
    `;
  }

  const analysis = analyzePurchase(position, holding.transactionShares, holding.transactionPrice);
  const before = formatCurrency(position.averagePrice);
  const after = formatCurrency(analysis.newAverage);

  if (analysis.newAverage < position.averagePrice) {
    return `
      <div class="plain-summary">
        <span>Quick answer</span>
        <strong>Buying ${formatQuantity(analysis.quantity)} shares at ${formatCurrency(holding.transactionPrice)} lowers your average from ${before} to ${after}.</strong>
        <p>You spend ${formatCurrency(analysis.cost)}. Your average falls by ${formatCurrency(analysis.reduction)} (${percent(analysis.reductionPercent)}).</p>
      </div>
    `;
  }

  if (analysis.newAverage > position.averagePrice) {
    return `
      <div class="plain-summary warning-summary">
        <span>Quick answer</span>
        <strong>This purchase raises your average from ${before} to ${after}.</strong>
        <p>The proposed buy price is above your current average. The purchase costs ${formatCurrency(analysis.cost)}.</p>
      </div>
    `;
  }

  return `
    <div class="plain-summary">
      <span>Quick answer</span>
      <strong>This purchase leaves your average unchanged at ${before}.</strong>
      <p>The purchase costs ${formatCurrency(analysis.cost)}.</p>
    </div>
  `;
}

function resultStrip(position: Position, holding: HoldingState): string {
  if (!isFinitePositive(holding.transactionPrice) || !isFinitePositive(holding.transactionShares)) return '';

  if (holding.action === 'sell') {
    if (holding.transactionShares > position.shares) return '';
    const result = applyTransaction(position, {
      id: 'preview',
      type: 'sell',
      price: holding.transactionPrice,
      shares: holding.transactionShares,
    });
    const pnlClass = result.realizedProfitLoss >= 0 ? 'positive' : 'negative';
    return `
      <div class="result-strip four">
        <div><span>Shares left</span><strong>${formatQuantity(result.sharesAfter)}</strong></div>
        <div><span>Average cost</span><strong>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : 'Position closed'}</strong></div>
        <div><span>Cash received</span><strong>${formatCurrency(result.grossAmount)}</strong></div>
        <div><span>Estimated realized P/L</span><strong class="${pnlClass}">${formatCurrency(result.realizedProfitLoss)}</strong></div>
      </div>
      <p class="simple-note">Selling shares does not change the average cost of the shares you keep. It only reduces the share count and realizes a gain or loss.</p>
    `;
  }

  const analysis = analyzePurchase(position, holding.transactionShares, holding.transactionPrice);
  return `
    <div class="result-strip four">
      <div><span>New average</span><strong>${formatCurrency(analysis.newAverage)}</strong></div>
      <div><span>Average changes by</span><strong class="${analysis.reduction > 0 ? 'positive' : analysis.newAverage > position.averagePrice ? 'negative' : ''}">${analysis.reduction > 0 ? `−${formatCurrency(analysis.reduction)}` : formatCurrency(analysis.newAverage - position.averagePrice)}</strong></div>
      <div><span>Purchase cost</span><strong>${formatCurrency(analysis.cost)}</strong></div>
      <div><span>Total shares after</span><strong>${formatQuantity(position.shares + analysis.quantity)}</strong></div>
    </div>
  `;
}

function optimizerCards(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  if (!isFinitePositive(price)) {
    return `<div class="empty-state">Enter a buy price to see useful purchase-size reference points.</div>`;
  }

  if (price >= position.averagePrice) {
    return `<div class="warning"><strong>No average-down effect.</strong> The buy price must be below your current average of ${formatCurrency(position.averagePrice)}.</div>`;
  }

  const floor = Math.min(0.99, Math.max(0.01, holding.efficiencyFloor));
  const floorQty = roundToShareStep(quantityForMarginalEfficiencyFloor(position.shares, floor), step, 'round');
  const floorPoint = analyzePurchase(position, Math.max(step, floorQty), price);
  const halfQty = roundToShareStep(quantityForTheoreticalCapture(position.shares, 0.5), step, 'ceil');
  const halfPoint = analyzePurchase(position, halfQty, price);
  const maxBudgetQty = budgetMaximumQuantity(holding.budget, price, step);
  const efficientQty = maxBudgetQty > 0
    ? budgetEfficientQuantity(position.shares, maxBudgetQty, holding.budgetBenefitTarget, step)
    : 0;
  const budgetPoint = efficientQty > 0 ? analyzePurchase(position, efficientQty, price) : null;
  const fullBudgetPoint = maxBudgetQty > 0 ? analyzePurchase(position, maxBudgetQty, price) : null;

  return `
    <div class="optimizer-grid">
      ${metricCard(
        'Useful stopping reference',
        `${formatQuantity(floorPoint.quantity)} shares`,
        `After this purchase, each extra share is only ${percent(floorPoint.marginalEfficiencyRemaining * 100)} as effective as the first one.`,
        `Spend ${formatCurrency(floorPoint.cost)} · New average ${formatCurrency(floorPoint.newAverage)}`,
      )}
      ${metricCard(
        'Half of the possible drop',
        `${formatQuantity(halfPoint.quantity)} shares`,
        `This moves your average halfway from ${formatCurrency(position.averagePrice)} toward the ${formatCurrency(price)} buy price.`,
        `Spend ${formatCurrency(halfPoint.cost)} · New average ${formatCurrency(halfPoint.newAverage)}`,
      )}
      ${budgetPoint && fullBudgetPoint
        ? metricCard(
            'Smaller efficient buy',
            `${formatQuantity(budgetPoint.quantity)} shares`,
            `This captures ${percent(holding.budgetBenefitTarget * 100, 0)} of the lowering you would get by spending your full budget.`,
            `Spend ${formatCurrency(budgetPoint.cost)} · Keep ${formatCurrency(fullBudgetPoint.cost - budgetPoint.cost)} unspent`,
          )
        : metricCard(
            'Budget comparison',
            'Set a budget',
            'Enter a budget to compare a smaller efficient purchase with spending the full amount.',
          )}
    </div>
  `;
}

function scenarioTable(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  if (!isFinitePositive(price) || price >= position.averagePrice) return '';

  const floorQty = roundToShareStep(
    quantityForMarginalEfficiencyFloor(position.shares, Math.min(0.99, Math.max(0.01, holding.efficiencyFloor))),
    step,
    'round',
  );
  const budgetQty = budgetMaximumQuantity(holding.budget, price, step);
  const candidates = new Set<number>([
    roundToShareStep(position.shares * 0.1, step, 'ceil'),
    roundToShareStep(position.shares * 0.25, step, 'ceil'),
    roundToShareStep(position.shares * 0.5, step, 'ceil'),
    roundToShareStep(position.shares, step, 'ceil'),
    floorQty,
    budgetQty,
  ]);

  const values = [...candidates]
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
    .map((candidate) => analyzePurchase(position, candidate, price));

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Shares</th>
            <th>Cost</th>
            <th>New average</th>
            <th>Average falls by</th>
            <th>Possible drop reached</th>
            <th>Next-share usefulness</th>
          </tr>
        </thead>
        <tbody>
          ${values.map((item) => `
            <tr>
              <td>${formatQuantity(item.quantity)}</td>
              <td>${formatCurrency(item.cost)}</td>
              <td>${formatCurrency(item.newAverage)}</td>
              <td class="positive">${formatCurrency(item.reduction)} (${percent(item.reductionPercent)})</td>
              <td>${percent(item.theoreticalReductionCaptured * 100)}</td>
              <td>${percent(item.marginalEfficiencyRemaining * 100)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function curveSvg(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  if (!isFinitePositive(price) || price >= position.averagePrice) return '';

  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  const budgetQty = budgetMaximumQuantity(holding.budget, price, step);
  const floorQty = quantityForMarginalEfficiencyFloor(
    position.shares,
    Math.min(0.99, Math.max(0.01, holding.efficiencyFloor)),
  );
  const xMax = Math.max(position.shares * 4, budgetQty, floorQty * 1.5, step * 10);
  const width = 780;
  const height = 260;
  const padX = 52;
  const padY = 28;
  const plotW = width - padX - 20;
  const plotH = height - padY - 42;
  const points: string[] = [];

  for (let i = 0; i <= 80; i += 1) {
    const x = (xMax * i) / 80;
    const y = x / (position.shares + x);
    const sx = padX + (x / xMax) * plotW;
    const sy = padY + (1 - y) * plotH;
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`);
  }

  const markerQty = Math.max(step, roundToShareStep(floorQty, step, 'round'));
  const marker = analyzePurchase(position, markerQty, price);
  const markerX = padX + (markerQty / xMax) * plotW;
  const markerY = padY + (1 - marker.theoreticalReductionCaptured) * plotH;

  return `
    <div class="curve-panel">
      <div class="section-heading compact">
        <div>
          <span class="eyebrow">Diminishing returns</span>
          <h3>Why larger buys help less</h3>
        </div>
        <span class="muted">The first shares have the strongest effect. The curve flattens as the purchase grows.</span>
      </div>
      <svg class="curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="Average-down benefit curve">
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${padY + plotH}" class="axis" />
        <line x1="${padX}" y1="${padY + plotH}" x2="${padX + plotW}" y2="${padY + plotH}" class="axis" />
        <line x1="${padX}" y1="${padY + plotH / 2}" x2="${padX + plotW}" y2="${padY + plotH / 2}" class="grid" />
        <polyline points="${points.join(' ')}" class="curve-line" />
        <circle cx="${markerX}" cy="${markerY}" r="6" class="curve-marker" />
        <text x="${Math.min(markerX + 10, width - 205)}" y="${Math.max(markerY - 10, 18)}" class="chart-label">${formatQuantity(markerQty)} shares · ${percent(marker.theoreticalReductionCaptured * 100)} of possible drop</text>
        <text x="8" y="${padY + 4}" class="chart-label">100%</text>
        <text x="16" y="${padY + plotH / 2 + 4}" class="chart-label">50%</text>
        <text x="25" y="${padY + plotH + 4}" class="chart-label">0%</text>
        <text x="${padX}" y="${height - 10}" class="chart-label">0 shares</text>
        <text x="${padX + plotW - 80}" y="${height - 10}" class="chart-label">${formatQuantity(xMax)}</text>
      </svg>
    </div>
  `;
}

function transactionPlan(results: TransactionResult[], holding: HoldingState): string {
  if (holding.transactions.length === 0) {
    return `<div class="empty-state">No planned transactions yet. Test a buy or sale above, then add it here.</div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>Price</th>
            <th>Shares</th>
            <th>Cash</th>
            <th>Shares after</th>
            <th>Average after</th>
            <th>Result</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${results.map((result, index) => {
            if (!result.valid) {
              return `
                <tr class="invalid-row">
                  <td>${index + 1}</td>
                  <td>${result.type === 'buy' ? 'Buy' : 'Sell'}</td>
                  <td>${formatCurrency(result.price)}</td>
                  <td>${formatQuantity(result.shares)}</td>
                  <td>—</td>
                  <td>${formatQuantity(result.sharesAfter)}</td>
                  <td>${formatCurrency(result.averageAfter)}</td>
                  <td class="negative">${escapeHtml(result.error ?? 'Invalid')}</td>
                  <td><button class="icon-button" data-remove="${result.id}" aria-label="Remove transaction">×</button></td>
                </tr>
              `;
            }

            const resultText = result.type === 'sell'
              ? `${result.realizedProfitLoss >= 0 ? 'Gain' : 'Loss'} ${formatCurrency(Math.abs(result.realizedProfitLoss))}`
              : result.reduction > 0
                ? `Average −${formatCurrency(result.reduction)}`
                : result.averageChange > 0
                  ? `Average +${formatCurrency(result.averageChange)}`
                  : 'Average unchanged';
            const resultClass = result.type === 'sell'
              ? result.realizedProfitLoss >= 0 ? 'positive' : 'negative'
              : result.reduction > 0 ? 'positive' : result.averageChange > 0 ? 'negative' : '';

            return `
              <tr>
                <td>${index + 1}</td>
                <td><span class="action-tag ${result.type}">${result.type === 'buy' ? 'Buy' : 'Sell'}</span></td>
                <td>${formatCurrency(result.price)}</td>
                <td>${formatQuantity(result.shares)}</td>
                <td>${result.type === 'buy' ? `−${formatCurrency(result.grossAmount)}` : `+${formatCurrency(result.grossAmount)}`}</td>
                <td>${formatQuantity(result.sharesAfter)}</td>
                <td>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : 'Closed'}</td>
                <td class="${resultClass}">${resultText}</td>
                <td><button class="icon-button" data-remove="${result.id}" aria-label="Remove transaction">×</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function field(
  id: string,
  label: string,
  value: string | number,
  type: 'text' | 'number',
  placeholder: string,
  step = 'any',
): string {
  return `
    <label class="field">
      <span>${label}</span>
      <input id="${id}" type="${type}" value="${escapeHtml(String(value))}" placeholder="${placeholder}" ${type === 'number' ? `step="${step}" min="0" inputmode="decimal"` : ''} autocomplete="off" />
    </label>
  `;
}

function render(): void {
  const holding = activeHolding();
  const { position, results } = effectivePosition(holding);
  const analyzablePosition = position && isFinitePositive(position.shares) && isFinitePositive(position.averagePrice)
    ? position
    : null;
  const tickerLabel = escapeHtml(holding.ticker || 'this position');
  const isBuy = holding.action === 'buy';
  const validTransaction = Boolean(
    analyzablePosition
      && isFinitePositive(holding.transactionPrice)
      && isFinitePositive(holding.transactionShares)
      && (isBuy || holding.transactionShares <= analyzablePosition.shares),
  );

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">A</span>
        <div>
          <h1>Average Price Planner</h1>
          <p>Compare future buys and sales for each holding</p>
        </div>
      </div>
      <div class="privacy-badge"><span></span> Saved only in this browser</div>
    </header>

    <main class="layout">
      <aside class="sidebar">
        <section class="panel positions-panel">
          <div class="section-heading compact">
            <div>
              <span class="eyebrow">Saved positions</span>
              <h2>Switch holdings</h2>
            </div>
          </div>
          <label class="field">
            <span>Current holding</span>
            <select id="holdingSelect">
              ${store.holdings.map((item, index) => `<option value="${item.id}" ${item.id === holding.id ? 'selected' : ''}>${escapeHtml(holdingName(item, index))}</option>`).join('')}
            </select>
          </label>
          <div class="button-row">
            <button id="newHolding" class="secondary-button">New position</button>
            <button id="deleteHolding" class="text-button danger-text">Delete</button>
          </div>
          <p class="helper-text">Each ticker keeps its own holding, settings, and plan on this browser.</p>
        </section>

        <section class="panel holding-panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Current holding</span>
              <h2>What you own now</h2>
            </div>
            <button id="resetHolding" class="text-button">Reset</button>
          </div>

          <div class="field-grid two">
            ${field('ticker', 'Ticker / name', holding.ticker, 'text', 'SOXL')}
            ${field('currency', 'Currency', holding.currency, 'text', 'USD')}
            ${field('baseShares', 'Shares owned', holding.baseShares, 'number', '48.5')}
            ${field('baseAverage', 'Average buy price', holding.baseAverage, 'number', '189')}
          </div>

          <div class="purchase-settings">
            <span class="settings-title">Purchase settings</span>
            <div class="field-grid two">
              ${field('shareStep', 'Smallest share amount', holding.shareStep, 'number', '1', 'any')}
              ${field('budget', 'Budget limit', holding.budget, 'number', '4000', 'any')}
            </div>
            <label class="range-field">
              <span><b>Next-share usefulness cutoff</b><output id="efficiencyFloorValue">${percent(holding.efficiencyFloor * 100, 0)}</output></span>
              <input id="efficiencyFloor" type="range" min="5" max="100" step="5" value="${holding.efficiencyFloor * 100}" />
              <small>Choose how useful the next extra share should still be compared with the first added share.</small>
            </label>
            <label class="range-field">
              <span><b>Keep this much of the full-budget benefit</b><output id="budgetBenefitTargetValue">${percent(holding.budgetBenefitTarget * 100, 0)}</output></span>
              <input id="budgetBenefitTarget" type="range" min="5" max="100" step="5" value="${holding.budgetBenefitTarget * 100}" />
              <small>Find the smallest purchase that gives this percentage of the average-price improvement available from the full budget.</small>
            </label>
          </div>
        </section>
      </aside>

      <section class="content">
        ${notice ? `<div class="notice" role="status">${escapeHtml(notice)}</div>` : ''}

        <section class="panel hero-panel">
          <div class="section-heading action-heading">
            <div>
              <span class="eyebrow">Test a transaction</span>
              <h2>${isBuy ? `What if you buy more ${tickerLabel}?` : `What if you sell some ${tickerLabel}?`}</h2>
            </div>
            ${analyzablePosition ? `<div class="position-pill">${formatQuantity(analyzablePosition.shares)} shares @ ${formatCurrency(analyzablePosition.averagePrice)}</div>` : ''}
          </div>

          <div class="segmented-control" aria-label="Transaction type">
            <button type="button" data-action="buy" class="${isBuy ? 'active' : ''}">Buy</button>
            <button type="button" data-action="sell" class="${!isBuy ? 'active' : ''}">Sell</button>
          </div>

          <div class="transaction-entry">
            ${field('transactionPrice', `${isBuy ? 'Buy' : 'Sell'} price per share`, holding.transactionPrice, 'number', '147')}
            ${field('transactionShares', `Shares to ${isBuy ? 'buy' : 'sell'}`, holding.transactionShares, 'number', '4')}
            <button id="addTransaction" class="primary-button" ${validTransaction ? '' : 'disabled'}>Add ${isBuy ? 'buy' : 'sale'} to plan</button>
          </div>

          ${analyzablePosition
            ? `${transactionSummary(analyzablePosition, holding)}${resultStrip(analyzablePosition, holding)}`
            : `<div class="empty-state">Enter your current shares and average price before testing a transaction.</div>`}
        </section>

        ${isBuy && analyzablePosition ? `
          <section class="panel">
            <div class="section-heading">
              <div>
                <span class="eyebrow">Buying guide</span>
                <h2>Useful purchase sizes</h2>
              </div>
            </div>
            ${optimizerCards(analyzablePosition, holding)}
            ${curveSvg(analyzablePosition, holding)}
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <span class="eyebrow">Compare options</span>
                <h2>Different buy sizes</h2>
              </div>
            </div>
            ${scenarioTable(analyzablePosition, holding)}
            ${isFinitePositive(holding.transactionPrice) && holding.transactionPrice < analyzablePosition.averagePrice
              ? `<p class="simple-note table-note"><strong>Possible drop reached</strong> shows how far the new average has moved toward the buy price. <strong>Next-share usefulness</strong> shows how much effect the next extra share still has.</p>`
              : ''}
          </section>
        ` : ''}

        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Future transactions</span>
              <h2>Plan for ${tickerLabel}</h2>
            </div>
            ${holding.transactions.length ? `<button id="clearPlan" class="text-button">Clear plan</button>` : ''}
          </div>
          ${transactionPlan(results, holding)}
        </section>

        <p class="disclaimer">Calculations are estimates before commissions and taxes. Selling does not change average cost under the average-cost method; it realizes a gain or loss on the shares sold.</p>
      </section>
    </main>
  `;

  wireEvents();
  notice = '';
}

function wireEvents(): void {
  const inputIds = [
    'ticker',
    'currency',
    'baseShares',
    'baseAverage',
    'transactionPrice',
    'transactionShares',
    'budget',
    'shareStep',
    'efficiencyFloor',
    'budgetBenefitTarget',
  ];

  for (const id of inputIds) {
    const element = document.querySelector<HTMLInputElement>(`#${id}`);
    if (!element) continue;

    if (element.type === 'range') {
      element.addEventListener('input', () => {
        updateHoldingFromInputs();
        const output = document.querySelector<HTMLOutputElement>(`#${id}Value`);
        if (output) output.value = percent(Number(element.value), 0);
      });
      element.addEventListener('change', () => {
        updateHoldingFromInputs();
        render();
      });
    } else {
      element.addEventListener('change', () => {
        updateHoldingFromInputs();
        render();
      });
    }
  }

  document.querySelector<HTMLSelectElement>('#holdingSelect')?.addEventListener('change', (event) => {
    store.activeHoldingId = (event.currentTarget as HTMLSelectElement).value;
    saveStore();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      activeHolding().action = button.dataset.action === 'sell' ? 'sell' : 'buy';
      saveStore();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#newHolding')?.addEventListener('click', () => {
    updateHoldingFromInputs();
    const newHolding = createHolding({
      ticker: '',
      baseShares: 0,
      baseAverage: 0,
      transactionPrice: 0,
      transactionShares: 0,
      transactions: [],
    });
    store.holdings.push(newHolding);
    store.activeHoldingId = newHolding.id;
    notice = 'New position created. Enter its ticker and current holding.';
    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#deleteHolding')?.addEventListener('click', () => {
    const index = store.holdings.findIndex((holding) => holding.id === store.activeHoldingId);
    store.holdings = store.holdings.filter((holding) => holding.id !== store.activeHoldingId);

    if (store.holdings.length === 0) {
      const blankHolding = createHolding({
        ticker: '',
        baseShares: 0,
        baseAverage: 0,
        transactionPrice: 0,
        transactionShares: 0,
        transactions: [],
      });
      store.holdings.push(blankHolding);
      store.activeHoldingId = blankHolding.id;
      notice = 'Position deleted. Enter a ticker to start a new one.';
    } else {
      const nextIndex = Math.max(0, Math.min(index, store.holdings.length - 1));
      store.activeHoldingId = store.holdings[nextIndex]!.id;
      notice = 'Position deleted from this browser.';
    }

    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#addTransaction')?.addEventListener('click', () => {
    updateHoldingFromInputs();
    const holding = activeHolding();
    const { position } = effectivePosition(holding);
    if (!position || !isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
      notice = 'Enter a valid current holding first.';
      render();
      return;
    }
    if (!isFinitePositive(holding.transactionPrice) || !isFinitePositive(holding.transactionShares)) {
      notice = 'Enter a price and number of shares first.';
      render();
      return;
    }
    if (holding.action === 'sell' && holding.transactionShares > position.shares) {
      notice = `You cannot sell more than ${formatQuantity(position.shares)} shares.`;
      render();
      return;
    }

    holding.transactions.push({
      id: createId(),
      type: holding.action,
      price: holding.transactionPrice,
      shares: holding.transactionShares,
    });
    holding.transactionShares = 0;
    notice = `${holding.action === 'buy' ? 'Buy' : 'Sale'} added to the plan. Enter a new share amount for the next transaction.`;
    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#clearPlan')?.addEventListener('click', () => {
    activeHolding().transactions = [];
    notice = 'Plan cleared.';
    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#resetHolding')?.addEventListener('click', () => {
    const current = activeHolding();
    const replacement = createHolding({ id: current.id, ticker: current.ticker });
    const index = store.holdings.findIndex((holding) => holding.id === current.id);
    store.holdings[index] = replacement;
    notice = 'This holding was reset.';
    saveStore();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.remove;
      const holding = activeHolding();
      holding.transactions = holding.transactions.filter((transaction) => transaction.id !== id);
      notice = 'Transaction removed.';
      saveStore();
      render();
    });
  });
}

render();
