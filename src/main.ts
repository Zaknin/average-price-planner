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
  plannedPositionMarketSnapshot,
  positionMarketSnapshot,
  salePriceForTarget,
  sharesForTargetAverage,
  type Position,
  type FeeSettings,
  type Transaction,
  type TransactionResult,
  type TransactionType,
} from './calculator';
import {
  createBackup,
  mergeBackupPositions,
  parseBackupJson,
  planCsv,
  type BackupDocument,
  type BackupPosition,
} from './data';

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
  buyFee: FeeSettings;
  sellFee: FeeSettings;
  currentMarketPrice: number;
  targetAverage: number;
  targetBuyPrice: number;
  targetRespectBudget: boolean;
  targetSellShares: number;
  targetSellMode: 'breakEven' | 'profit' | 'return';
  targetSellValue: number;
  transactions: Transaction[];
};

type AppStore = {
  version: 3;
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
let holdingEditorExpanded = false;
let curveExpanded = false;
let marketSnapshotExpanded = false;
let targetsExpanded = false;
let targetTab: 'average' | 'sell' = 'average';
let pendingImport: BackupDocument | null = null;

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
    buyFee: { mode: 'percent', value: 0 },
    sellFee: { mode: 'percent', value: 0 },
    currentMarketPrice: 0,
    targetAverage: 0,
    targetBuyPrice: 0,
    targetRespectBudget: true,
    targetSellShares: 0,
    targetSellMode: 'breakEven',
    targetSellValue: 0,
    transactions: [],
    ...overrides,
  };
}

function normalizeHolding(value: Partial<HoldingState>): HoldingState {
  const defaults = createHolding();
  const finiteNonNegative = (input: unknown, fallback: number): number => Number.isFinite(Number(input)) && Number(input) >= 0 ? Number(input) : fallback;
  const normalizeFee = (fee: Partial<FeeSettings> | undefined): FeeSettings => ({
    mode: fee?.mode === 'fixed' ? 'fixed' : 'percent',
    value: Number.isFinite(Number(fee?.value)) && Number(fee?.value) >= 0 ? Number(fee?.value) : 0,
  });
  return {
    ...defaults,
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : defaults.id,
    ticker: typeof value.ticker === 'string' ? value.ticker : '',
    currency: typeof value.currency === 'string' && value.currency ? value.currency : 'USD',
    action: value.action === 'sell' ? 'sell' : 'buy',
    baseShares: finiteNonNegative(value.baseShares, defaults.baseShares),
    baseAverage: finiteNonNegative(value.baseAverage, defaults.baseAverage),
    transactionPrice: finiteNonNegative(value.transactionPrice, defaults.transactionPrice),
    transactionShares: finiteNonNegative(value.transactionShares, defaults.transactionShares),
    budget: finiteNonNegative(value.budget, defaults.budget),
    shareStep: Math.max(Number.EPSILON, finiteNonNegative(value.shareStep, defaults.shareStep)),
    efficiencyFloor: finiteNonNegative(value.efficiencyFloor, defaults.efficiencyFloor),
    budgetBenefitTarget: finiteNonNegative(value.budgetBenefitTarget, defaults.budgetBenefitTarget),
    buyFee: normalizeFee(value.buyFee),
    sellFee: normalizeFee(value.sellFee),
    currentMarketPrice: finiteNonNegative(value.currentMarketPrice, 0),
    targetAverage: finiteNonNegative(value.targetAverage, 0),
    targetBuyPrice: finiteNonNegative(value.targetBuyPrice, 0),
    targetRespectBudget: value.targetRespectBudget !== false,
    targetSellShares: finiteNonNegative(value.targetSellShares, 0),
    targetSellMode: value.targetSellMode === 'profit' || value.targetSellMode === 'return' ? value.targetSellMode : 'breakEven',
    targetSellValue: finiteNonNegative(value.targetSellValue, 0),
    transactions: Array.isArray(value.transactions)
      ? value.transactions
          .filter((item): item is Transaction => Boolean(item && isFinitePositive(Number(item.shares)) && isFinitePositive(Number(item.price))))
          .map((item) => ({
            id: typeof item.id === 'string' && item.id ? item.id : createId(),
            type: item.type === 'sell' ? 'sell' : 'buy',
            shares: Number(item.shares),
            price: Number(item.price),
            feeMode: item.feeMode === 'fixed' ? 'fixed' : 'percent',
            feeValue: Number.isFinite(Number(item.feeValue)) && Number(item.feeValue) >= 0 ? Number(item.feeValue) : 0,
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
    return { version: 3, activeHoldingId: holding.id, holdings: [holding] };
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
        const migrated = { version: 3 as const, activeHoldingId, holdings };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
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
  return { version: 3, activeHoldingId: holding.id, holdings: [holding] };
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
  holding.currentMarketPrice = numberFromInput('currentMarketPrice');
  const activeFee = holding.action === 'buy' ? holding.buyFee : holding.sellFee;
  activeFee.value = numberFromInput('transactionFee');
  saveStore();
}

function activeFee(holding = activeHolding()): FeeSettings {
  return holding.action === 'buy' ? holding.buyFee : holding.sellFee;
}

function feeLabel(fee: FeeSettings, holding = activeHolding()): string {
  return fee.mode === 'percent' ? `${fee.value}%` : `Fixed ${formatCurrency(fee.value, holding)}`;
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

function holdingSummary(holding: HoldingState): string {
  const ticker = escapeHtml(holding.ticker || 'Unnamed position');
  const position = validBasePosition(holding);
  const positionText = position
    ? `${formatQuantity(position.shares, holding)} shares · Average ${formatCurrency(position.averagePrice, holding)}`
    : 'Add your shares and average price';
  return `
    <div class="holding-mobile-summary">
      <div class="holding-summary-copy">
        <span class="eyebrow">Active holding</span>
        <strong title="${ticker}">${ticker}</strong>
        <span>${positionText}</span>
        <span>Budget ${formatCurrency(holding.budget, holding)}</span>
      </div>
      <button
        id="toggleHoldingEditor"
        class="secondary-button holding-editor-toggle"
        type="button"
        aria-expanded="${holdingEditorExpanded}"
        aria-controls="holdingEditor"
      >${holdingEditorExpanded ? 'Done editing' : 'Edit holding'}</button>
    </div>
  `;
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

  const fee = activeFee(holding);
  if (fee.value < 0 || !Number.isFinite(fee.value)) {
    return `<div class="plain-summary warning-summary"><span>Fee input</span><strong>Enter a fee of zero or greater.</strong></div>`;
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
      feeMode: fee.mode,
      feeValue: fee.value,
    });
    const gainOrLoss = result.realizedProfitLoss >= 0 ? 'estimated gain' : 'estimated loss';
    return `
      <div class="plain-summary">
        <span>Quick answer</span>
        <strong>Selling ${formatQuantity(result.shares)} shares at ${formatCurrency(result.price)} with a ${formatCurrency(result.feeAmount)} fee produces ${formatCurrency(result.netAmount)} net proceeds.</strong>
        <p>Your average cost stays ${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : 'closed'}, with an ${gainOrLoss} of ${formatCurrency(Math.abs(result.realizedProfitLoss))}.</p>
        ${result.warning ? `<p class="negative">${escapeHtml(result.warning)}</p>` : ''}
      </div>
    `;
  }

  const analysis = analyzePurchase(position, holding.transactionShares, holding.transactionPrice, fee);
  const before = formatCurrency(position.averagePrice);
  const after = formatCurrency(analysis.newAverage);

  if (analysis.newAverage < position.averagePrice) {
    return `
      <div class="plain-summary">
        <span>Quick answer</span>
        <strong>Buying ${formatQuantity(analysis.quantity)} shares at ${formatCurrency(holding.transactionPrice)} with a ${formatCurrency(analysis.feeAmount)} fee costs ${formatCurrency(analysis.totalCost)} in total.</strong>
        <p>Your average moves from ${before} to ${after}, a decrease of ${formatCurrency(analysis.reduction)} (${percent(analysis.reductionPercent)}).</p>
      </div>
    `;
  }

  if (analysis.newAverage > position.averagePrice) {
    return `
      <div class="plain-summary warning-summary">
        <span>Quick answer</span>
        <strong>This purchase raises your average from ${before} to ${after}.</strong>
        <p>The proposed buy price is above your current average. The total cash required is ${formatCurrency(analysis.totalCost)}.</p>
      </div>
    `;
  }

  return `
    <div class="plain-summary">
      <span>Quick answer</span>
      <strong>This purchase leaves your average unchanged at ${before}.</strong>
      <p>The total cash required is ${formatCurrency(analysis.totalCost)}.</p>
    </div>
  `;
}

function resultStrip(position: Position, holding: HoldingState): string {
  if (!isFinitePositive(holding.transactionPrice) || !isFinitePositive(holding.transactionShares)) return '';

  const fee = activeFee(holding);
  if (fee.value < 0 || !Number.isFinite(fee.value)) return '';
  if (holding.action === 'sell') {
    if (holding.transactionShares > position.shares) return '';
    const result = applyTransaction(position, {
      id: 'preview',
      type: 'sell',
      price: holding.transactionPrice,
      shares: holding.transactionShares,
      feeMode: fee.mode,
      feeValue: fee.value,
    });
    const pnlClass = result.realizedProfitLoss >= 0 ? 'positive' : 'negative';
    return `
      <div class="result-strip six">
        <div><span>Gross sale</span><strong>${formatCurrency(result.grossAmount)}</strong></div>
        <div><span>Fee</span><strong>${formatCurrency(result.feeAmount)}</strong></div>
        <div><span>Net proceeds</span><strong>${formatCurrency(result.netAmount)}</strong></div>
        <div><span>Shares left</span><strong>${formatQuantity(result.sharesAfter)}</strong></div>
        <div><span>Average cost</span><strong>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : 'Position closed'}</strong></div>
        <div><span>Estimated realized P/L</span><strong class="${pnlClass}">${formatCurrency(result.realizedProfitLoss)}</strong></div>
      </div>
      <p class="simple-note">Selling shares does not change the average cost of the shares you keep. It only reduces the share count and realizes a gain or loss.</p>
    `;
  }

  const analysis = analyzePurchase(position, holding.transactionShares, holding.transactionPrice, fee);
  return `
    <div class="result-strip six">
      <div><span>Gross purchase</span><strong>${formatCurrency(analysis.grossAmount)}</strong></div>
      <div><span>Fee</span><strong>${formatCurrency(analysis.feeAmount)}</strong></div>
      <div><span>Total cash</span><strong>${formatCurrency(analysis.totalCost)}</strong></div>
      <div><span>New share count</span><strong>${formatQuantity(position.shares + analysis.quantity)}</strong></div>
      <div><span>New average</span><strong>${formatCurrency(analysis.newAverage)}</strong></div>
      <div><span>Average change</span><strong class="${analysis.reduction > 0 ? 'positive' : analysis.newAverage > position.averagePrice ? 'negative' : ''}">${analysis.reduction > 0 ? `−${formatCurrency(analysis.reduction)}` : formatCurrency(analysis.newAverage - position.averagePrice)}</strong></div>
    </div>
  `;
}

function optimizerCards(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const fee = holding.buyFee;
  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  if (!isFinitePositive(price)) {
    return `<div class="empty-state">Enter a buy price to see useful purchase-size reference points.</div>`;
  }

  if (price >= position.averagePrice) {
    return `<div class="warning"><strong>No average-down effect.</strong> The buy price must be below your current average of ${formatCurrency(position.averagePrice)}.</div>`;
  }

  const floor = Math.min(0.99, Math.max(0.01, holding.efficiencyFloor));
  const floorQty = roundToShareStep(quantityForMarginalEfficiencyFloor(position.shares, floor), step, 'round');
  const floorPoint = analyzePurchase(position, Math.max(step, floorQty), price, fee);
  const halfQty = roundToShareStep(quantityForTheoreticalCapture(position.shares, 0.5), step, 'ceil');
  const halfPoint = analyzePurchase(position, halfQty, price, fee);
  const maxBudgetQty = budgetMaximumQuantity(holding.budget, price, step, fee);
  const efficientQty = maxBudgetQty > 0
    ? budgetEfficientQuantity(position.shares, maxBudgetQty, holding.budgetBenefitTarget, step)
    : 0;
  const budgetPoint = efficientQty > 0 ? analyzePurchase(position, efficientQty, price, fee) : null;
  const fullBudgetPoint = maxBudgetQty > 0 ? analyzePurchase(position, maxBudgetQty, price, fee) : null;

  return `
    <div class="optimizer-grid">
      ${metricCard(
        'Useful stopping reference',
        `${formatQuantity(floorPoint.quantity)} shares`,
        `After this purchase, each extra share is only ${percent(floorPoint.marginalEfficiencyRemaining * 100)} as effective as the first one.`,
        `Gross ${formatCurrency(floorPoint.grossAmount)} · Fee ${formatCurrency(floorPoint.feeAmount)} · Total ${formatCurrency(floorPoint.totalCost)} · New average ${formatCurrency(floorPoint.newAverage)}`,
      )}
      ${metricCard(
        'Half of the possible drop',
        `${formatQuantity(halfPoint.quantity)} shares`,
        `This moves your average halfway from ${formatCurrency(position.averagePrice)} toward the ${formatCurrency(price)} buy price.`,
        `Gross ${formatCurrency(halfPoint.grossAmount)} · Fee ${formatCurrency(halfPoint.feeAmount)} · Total ${formatCurrency(halfPoint.totalCost)} · New average ${formatCurrency(halfPoint.newAverage)}`,
      )}
      ${budgetPoint && fullBudgetPoint
        ? metricCard(
            'Smaller efficient buy',
            `${formatQuantity(budgetPoint.quantity)} shares`,
            `This captures ${percent(holding.budgetBenefitTarget * 100, 0)} of the lowering you would get by spending your full budget.`,
            `Gross ${formatCurrency(budgetPoint.grossAmount)} · Fee ${formatCurrency(budgetPoint.feeAmount)} · Total ${formatCurrency(budgetPoint.totalCost)} · Keep ${formatCurrency(fullBudgetPoint.totalCost - budgetPoint.totalCost)} unspent`,
          )
        : metricCard(
            'Budget comparison',
            'Set a budget',
            fee.mode === 'fixed' && fee.value >= holding.budget ? 'The fixed buy fee uses the full budget, so no purchase is affordable.' : 'Enter a budget to compare a smaller efficient purchase with spending the full amount.',
          )}
    </div>
  `;
}

function scenarioTable(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const fee = holding.buyFee;
  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  if (!isFinitePositive(price) || price >= position.averagePrice) return '';

  const floorQty = roundToShareStep(
    quantityForMarginalEfficiencyFloor(position.shares, Math.min(0.99, Math.max(0.01, holding.efficiencyFloor))),
    step,
    'round',
  );
  const budgetQty = budgetMaximumQuantity(holding.budget, price, step, fee);
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
    .map((candidate) => analyzePurchase(position, candidate, price, fee));

  const scenarioCards = values.map((item) => `
    <article class="scenario-card">
      <div class="scenario-card-heading">
        <strong>${formatQuantity(item.quantity)} shares</strong>
        <span>Total ${formatCurrency(item.totalCost)}</span>
      </div>
      <dl>
        <div><dt>Gross</dt><dd>${formatCurrency(item.grossAmount)}</dd></div>
        <div><dt>Fee</dt><dd>${formatCurrency(item.feeAmount)} (${feeLabel(fee, holding)})</dd></div>
        <div><dt>Total required</dt><dd>${formatCurrency(item.totalCost)}</dd></div>
        <div><dt>New average</dt><dd>${formatCurrency(item.newAverage)}</dd></div>
        <div><dt>Average lowered</dt><dd class="positive">${formatCurrency(item.reduction)} (${percent(item.reductionPercent)})</dd></div>
        <div><dt>Possible drop</dt><dd>${percent(item.theoreticalReductionCaptured * 100)}</dd></div>
        <div><dt>Next-share usefulness</dt><dd>${percent(item.marginalEfficiencyRemaining * 100)}</dd></div>
      </dl>
    </article>
  `).join('');

  return `
    <div class="table-wrap scenario-table">
      <table>
        <thead>
          <tr>
            <th>Shares</th>
            <th>Gross</th>
            <th>Fee</th>
            <th>Total</th>
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
              <td>${formatCurrency(item.grossAmount)}</td>
              <td>${formatCurrency(item.feeAmount)}</td>
              <td>${formatCurrency(item.totalCost)}</td>
              <td>${formatCurrency(item.newAverage)}</td>
              <td class="positive">${formatCurrency(item.reduction)} (${percent(item.reductionPercent)})</td>
              <td>${percent(item.theoreticalReductionCaptured * 100)}</td>
              <td>${percent(item.marginalEfficiencyRemaining * 100)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="scenario-cards" aria-label="Purchase scenario comparison">${scenarioCards}</div>
  `;
}

function curveSvg(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const fee = holding.buyFee;
  if (!isFinitePositive(price) || price >= position.averagePrice) return '';

  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  const budgetQty = budgetMaximumQuantity(holding.budget, price, step, fee);
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
    const point = x > 0 ? analyzePurchase(position, x, price, fee) : null;
    const y = point && point.maximumPossibleReduction > 0
      ? Math.max(0, Math.min(1, point.reduction / point.maximumPossibleReduction))
      : 0;
    const sx = padX + (x / xMax) * plotW;
    const sy = padY + (1 - y) * plotH;
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`);
  }

  const markerQty = Math.max(step, roundToShareStep(floorQty, step, 'round'));
  const marker = analyzePurchase(position, markerQty, price, fee);
  const markerX = padX + (markerQty / xMax) * plotW;
  const markerY = padY + (1 - marker.theoreticalReductionCaptured) * plotH;

  return `
    <div class="curve-panel">
      <div class="section-heading compact curve-heading">
        <div>
          <span class="eyebrow">Diminishing returns</span>
          <h3>Why larger buys help less</h3>
        </div>
        <span class="muted">The first shares have the strongest effect. The curve flattens as the purchase grows.</span>
        <button
          id="toggleCurve"
          type="button"
          class="text-button curve-toggle"
          aria-expanded="${curveExpanded}"
          aria-controls="improvementCurve"
        >${curveExpanded ? 'Hide improvement curve' : 'Show improvement curve'}</button>
      </div>
      <div id="improvementCurve" class="curve-content ${curveExpanded ? 'is-expanded' : ''}">
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
    </div>
  `;
}

function marketSnapshotPanel(position: Position | null, holding: HoldingState): string {
  const snapshot = position
    ? positionMarketSnapshot(position, holding.currentMarketPrice, holding.sellFee)
    : positionMarketSnapshot({ shares: 0, averagePrice: 0 }, holding.currentMarketPrice, holding.sellFee);
  const planned = position
    ? plannedPositionMarketSnapshot(position, holding.transactions, holding.currentMarketPrice, holding.sellFee)
    : null;
  if (!snapshot.available) {
    return `
      <section class="panel market-panel">
        <div class="section-heading compact"><div><span class="eyebrow">Current price</span><h2>Position snapshot</h2></div>
          <button id="toggleMarketSnapshot" class="text-button" aria-expanded="${marketSnapshotExpanded}" aria-controls="marketSnapshot">${marketSnapshotExpanded ? 'Hide details' : 'Show snapshot'}</button>
        </div>
        <div id="marketSnapshot" class="disclosure-content ${marketSnapshotExpanded ? 'is-expanded' : ''}">
          <div class="empty-state compact-empty">${escapeHtml(snapshot.reason ?? 'Enter a current market price to see this snapshot.')}</div>
        </div>
      </section>`;
  }
  const netTone = snapshot.netUnrealizedProfitLoss >= 0 ? 'positive' : 'negative';
  return `
    <section class="panel market-panel">
      <div class="section-heading compact"><div><span class="eyebrow">Current price</span><h2>Position snapshot</h2></div>
        <button id="toggleMarketSnapshot" class="text-button" aria-expanded="${marketSnapshotExpanded}" aria-controls="marketSnapshot">${marketSnapshotExpanded ? 'Hide details' : 'Show snapshot'}</button>
      </div>
      <div id="marketSnapshot" class="disclosure-content ${marketSnapshotExpanded ? 'is-expanded' : ''}">
        <div class="snapshot-grid">
          ${metricCard('Current value', formatCurrency(snapshot.marketValue, holding), `${formatQuantity(position!.shares, holding)} shares at ${formatCurrency(holding.currentMarketPrice, holding)}`)}
          ${metricCard('Total cost basis', formatCurrency(snapshot.basis, holding), `Average ${formatCurrency(position!.averagePrice, holding)}`)}
          ${metricCard('Gross P/L', formatCurrency(snapshot.grossUnrealizedProfitLoss, holding), `Gross return ${percent(snapshot.grossReturnPercent)}`, '', snapshot.grossUnrealizedProfitLoss >= 0 ? 'positive' : 'negative')}
          ${metricCard('After fees', formatCurrency(snapshot.netUnrealizedProfitLoss, holding), `Liquidation fee ${formatCurrency(snapshot.estimatedSellFee, holding)} · Net ${formatCurrency(snapshot.netLiquidationValue, holding)}`, '', netTone)}
          ${metricCard('Break-even price', formatCurrency(snapshot.breakEvenPrice, holding), snapshot.movementToBreakEvenPercent > 0 ? `${percent(snapshot.movementToBreakEvenPercent)} rise required` : snapshot.aboveBreakEvenPercent > 0 ? `${percent(snapshot.aboveBreakEvenPercent)} above break even` : 'At break even')}
        </div>
        ${planned && holding.transactions.length ? `
          <div class="after-plan-snapshot">
            <span class="eyebrow">After planned transactions</span>
            <div class="result-strip six">
              <div><span>Resulting shares</span><strong>${formatQuantity(planned.finalPosition.shares, holding)}</strong></div>
              <div><span>Resulting average</span><strong>${planned.finalPosition.shares > 0 ? formatCurrency(planned.finalPosition.averagePrice, holding) : 'Closed'}</strong></div>
              <div><span>Cost basis</span><strong>${formatCurrency(planned.resultingBasis, holding)}</strong></div>
              <div><span>Unrealized P/L</span><strong class="${planned.unrealizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(planned.unrealizedProfitLoss, holding)}</strong></div>
              <div><span>Realized P/L</span><strong class="${planned.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(planned.realizedProfitLoss, holding)}</strong></div>
              <div><span>Plan cash flow / fees</span><strong>${formatCurrency(planned.netPlannedCashFlow, holding)} / ${formatCurrency(planned.totalFees, holding)}</strong></div>
            </div>
          </div>` : ''}
      </div>
    </section>`;
}

function targetsPanel(position: Position, holding: HoldingState): string {
  const averageResult = sharesForTargetAverage(position, {
    targetAverage: holding.targetAverage,
    purchasePrice: holding.targetBuyPrice,
    fee: holding.buyFee,
    shareStep: holding.shareStep,
    budget: holding.budget,
    respectBudget: holding.targetRespectBudget,
  });
  const sellShares = holding.targetSellShares > 0 ? holding.targetSellShares : position.shares;
  const sellResult = salePriceForTarget(position, { shares: sellShares, mode: holding.targetSellMode, targetValue: holding.targetSellValue, fee: holding.sellFee });
  const averageBody = averageResult.achievable ? `
    <div class="result-strip six">
      <div><span>Shares needed</span><strong>${formatQuantity(averageResult.requiredShares, holding)}</strong></div>
      <div><span>Gross purchase</span><strong>${formatCurrency(averageResult.grossAmount, holding)}</strong></div>
      <div><span>Fee</span><strong>${formatCurrency(averageResult.feeAmount, holding)}</strong></div>
      <div><span>Total cash needed</span><strong>${formatCurrency(averageResult.totalAmount, holding)}</strong></div>
      <div><span>Actual average</span><strong>${formatCurrency(averageResult.resultingPosition.averagePrice, holding)}</strong></div>
      <div><span>Average lowered</span><strong class="positive">${formatCurrency(averageResult.averageLowered, holding)}</strong></div>
    </div>
    <p class="simple-note">Requested target: ${formatCurrency(holding.targetAverage, holding)}. ${averageResult.targetReached ? 'The rounded share amount reaches or improves on it.' : 'Rounding changes the actual resulting average shown above.'}${averageResult.exceedsBudget ? ` This requires ${formatCurrency(averageResult.totalAmount - holding.budget, holding)} more than the configured budget.` : ''}</p>`
    : `<div class="plain-summary warning-summary"><span>Target result</span><strong>${escapeHtml(averageResult.reason ?? 'This target is not achievable.')}</strong></div>`;
  const sellBody = sellResult.valid ? `
    <div class="result-strip six">
      <div><span>Shares sold</span><strong>${formatQuantity(sellResult.shares, holding)}</strong></div>
      <div><span>Cost basis sold</span><strong>${formatCurrency(sellResult.costBasisSold, holding)}</strong></div>
      <div><span>Break-even / target price</span><strong>${formatCurrency(sellResult.requiredPrice, holding)}</strong></div>
      <div><span>Gross proceeds</span><strong>${formatCurrency(sellResult.grossAmount, holding)}</strong></div>
      <div><span>Fee / net proceeds</span><strong>${formatCurrency(sellResult.feeAmount, holding)} / ${formatCurrency(sellResult.netAmount, holding)}</strong></div>
      <div><span>Profit / return</span><strong class="${sellResult.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(sellResult.realizedProfitLoss, holding)} / ${percent(sellResult.returnPercent)}</strong></div>
    </div>
    <p class="simple-note">Remaining position: ${formatQuantity(sellResult.remainingPosition.shares, holding)} shares${sellResult.remainingPosition.shares ? ` at ${formatCurrency(sellResult.remainingPosition.averagePrice, holding)} average` : ', closed'}.</p>`
    : `<div class="plain-summary warning-summary"><span>Sale target</span><strong>${escapeHtml(sellResult.reason ?? 'Enter valid sale details.')}</strong></div>`;
  return `
    <section class="panel targets-panel">
      <div class="section-heading"><div><span class="eyebrow">Targets</span><h2>Plan an average or exit price</h2></div>
        <button id="toggleTargets" class="text-button" aria-expanded="${targetsExpanded}" aria-controls="targetsContent">${targetsExpanded ? 'Hide targets' : 'Show targets'}</button>
      </div>
      <div id="targetsContent" class="disclosure-content ${targetsExpanded ? 'is-expanded' : ''}">
        <div class="segmented-control target-tabs" aria-label="Target calculator"><button data-target-tab="average" class="${targetTab === 'average' ? 'active' : ''}">Target average</button><button data-target-tab="sell" class="${targetTab === 'sell' ? 'active' : ''}">Break-even / profit</button></div>
        ${targetTab === 'average' ? `
          <div class="target-form field-grid three">
            ${field('targetAverage', 'Target average', holding.targetAverage, 'number', '45')}
            ${field('targetBuyPrice', 'Buy price', holding.targetBuyPrice, 'number', '40')}
            <label class="check-field"><input id="targetRespectBudget" type="checkbox" ${holding.targetRespectBudget ? 'checked' : ''} /> Respect maximum budget</label>
          </div>${averageBody}` : `
          <div class="target-form field-grid three">
            ${field('targetSellShares', 'Shares to sell', sellShares, 'number', '100')}
            <div class="segmented-control compact-target-mode" aria-label="Sale target mode"><button data-target-sell-mode="breakEven" class="${holding.targetSellMode === 'breakEven' ? 'active' : ''}">Break even</button><button data-target-sell-mode="profit" class="${holding.targetSellMode === 'profit' ? 'active' : ''}">Profit</button><button data-target-sell-mode="return" class="${holding.targetSellMode === 'return' ? 'active' : ''}">Return %</button></div>
            ${holding.targetSellMode === 'breakEven' ? '<div class="target-placeholder">Uses your active sell fee.</div>' : field('targetSellValue', holding.targetSellMode === 'profit' ? 'Profit target' : 'Target return percent', holding.targetSellValue, 'number', holding.targetSellMode === 'profit' ? '500' : '10')}
          </div>${sellBody}`}
      </div>
    </section>`;
}

function dataManagementPanel(holding: HoldingState): string {
  const preview = pendingImport ? `<div class="import-preview"><strong>Backup preview</strong><span>${pendingImport.positions.length} position${pendingImport.positions.length === 1 ? '' : 's'} · ${pendingImport.positions.reduce((total, position) => total + (Array.isArray(position.transactions) ? position.transactions.length : 0), 0)} planned transactions</span><span>${pendingImport.positions.map((position) => escapeHtml(String(position.ticker || 'Unnamed position'))).join(', ')}</span><span>Exported ${escapeHtml(pendingImport.exportedAt)} · schema ${pendingImport.backupSchemaVersion}</span><div class="button-row"><button id="applyMergeImport" class="secondary-button">Merge with current data</button><button id="applyReplaceImport" class="text-button danger-text">Replace all current data</button></div></div>` : '';
  return `
    <section class="panel data-panel">
      <div class="section-heading"><div><span class="eyebrow">Data management</span><h2>Backup, restore, and export</h2></div></div>
      <p class="helper-text">Everything stays in this browser. Different website origins keep separate browser data.</p>
      <div class="button-row data-actions"><button id="exportAll" class="secondary-button">Export all positions</button><button id="exportActive" class="secondary-button">Export active position</button><button id="exportCsv" class="secondary-button" ${holding.transactions.length ? '' : 'disabled'}>Export plan CSV</button><label class="secondary-button file-button">Import JSON<input id="importJson" type="file" accept="application/json,.json" hidden /></label></div>
      ${preview}
    </section>`;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportBackup(scope: 'all' | 'active'): void {
  const holding = activeHolding();
  const positions = scope === 'all' ? store.holdings : [holding];
  const backup = createBackup(positions as unknown as BackupPosition[], scope === 'all' ? store.activeHoldingId : undefined, scope);
  const prefix = scope === 'active' && holding.ticker ? holding.ticker.replace(/[^A-Z0-9._-]/gi, '').slice(0, 24) : 'average-price-planner';
  downloadText(`${prefix}-backup-${dateStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  notice = `Exported ${positions.length} position${positions.length === 1 ? '' : 's'} as a browser-local backup.`;
  render();
}

function exportPlanCsv(): void {
  const holding = activeHolding();
  const { results } = effectivePosition(holding);
  const rows = results.map((result, index) => ({
    sequence: index + 1,
    type: result.type,
    price: result.price,
    shares: result.shares,
    grossAmount: result.grossAmount,
    feeMode: result.feeMode ?? 'percent',
    feeValue: result.feeValue ?? 0,
    feeAmount: result.feeAmount,
    totalPaid: result.type === 'buy' ? result.totalAmount : 0,
    netReceived: result.type === 'sell' ? result.netAmount : 0,
    sharesAfter: result.sharesAfter,
    averageAfter: result.averageAfter,
    averageChange: result.averageChange,
    realizedProfitLoss: result.realizedProfitLoss,
    currency: holding.currency,
  }));
  const prefix = (holding.ticker || 'position').replace(/[^A-Z0-9._-]/gi, '').slice(0, 24);
  downloadText(`${prefix}-plan-${dateStamp()}.csv`, planCsv(rows), 'text/csv;charset=utf-8');
  notice = `Exported ${rows.length} planned transaction${rows.length === 1 ? '' : 's'} as CSV.`;
  render();
}

function applyPendingImport(mode: 'merge' | 'replace'): void {
  if (!pendingImport) return;
  if (mode === 'replace' && !window.confirm('Replace all current browser-local positions with this backup? This cannot be undone unless you exported a backup first.')) return;
  const imported = pendingImport.positions.map((position) => normalizeHolding(position as Partial<HoldingState>));
  if (mode === 'merge') {
    const merged = mergeBackupPositions(store.holdings as unknown as BackupPosition[], imported as unknown as BackupPosition[], createId)
      .map((position) => normalizeHolding(position as Partial<HoldingState>));
    store.holdings = merged;
  } else {
    store.holdings = imported.length ? imported : [createHolding()];
  }
  store.activeHoldingId = mode === 'replace' && pendingImport.activeHoldingId && store.holdings.some((holding) => holding.id === pendingImport!.activeHoldingId)
    ? pendingImport.activeHoldingId
    : store.holdings[0]!.id;
  const transactionCount = imported.reduce((total, holding) => total + holding.transactions.length, 0);
  pendingImport = null;
  saveStore();
  notice = `Imported ${imported.length} position${imported.length === 1 ? '' : 's'} and ${transactionCount} planned transaction${transactionCount === 1 ? '' : 's'}.`;
  render();
}

function transactionPlan(results: TransactionResult[], holding: HoldingState): string {
  if (holding.transactions.length === 0) {
    return `<div class="empty-state">No planned transactions yet. Test a buy or sale above, then add it here.</div>`;
  }

  const transactionCards = results.map((result, index) => {
    const resultText = !result.valid
      ? result.error ?? 'Invalid transaction'
      : result.type === 'sell'
        ? `${result.realizedProfitLoss >= 0 ? 'Gain' : 'Loss'} ${formatCurrency(Math.abs(result.realizedProfitLoss), holding)}`
        : result.reduction > 0
          ? `Average −${formatCurrency(result.reduction, holding)}`
          : result.averageChange > 0
            ? `Average +${formatCurrency(result.averageChange, holding)}`
            : 'Average unchanged';
    const resultClass = !result.valid
      ? 'negative'
      : result.type === 'sell'
        ? result.realizedProfitLoss >= 0 ? 'positive' : 'negative'
        : result.reduction > 0 ? 'positive' : result.averageChange > 0 ? 'negative' : '';
    return `
      <article class="transaction-card ${result.valid ? '' : 'invalid-row'}">
        <div class="transaction-card-heading">
          <span class="action-tag ${result.type}">${result.type === 'buy' ? 'Buy' : 'Sell'}</span>
          <button class="icon-button" data-remove-mobile="${result.id}" aria-label="Remove transaction ${index + 1}">×</button>
        </div>
        <dl>
          <div><dt>Price</dt><dd>${formatCurrency(result.price, holding)}</dd></div>
          <div><dt>Shares</dt><dd>${formatQuantity(result.shares, holding)}</dd></div>
          <div><dt>Gross</dt><dd>${formatCurrency(result.grossAmount, holding)}</dd></div>
          <div><dt>Fee</dt><dd>${formatCurrency(result.feeAmount, holding)} (${feeLabel({ mode: result.feeMode ?? 'percent', value: result.feeValue ?? 0 }, holding)})</dd></div>
          <div><dt>${result.type === 'buy' ? 'Total paid' : 'Net received'}</dt><dd>${formatCurrency(result.type === 'buy' ? result.totalAmount : result.netAmount, holding)}</dd></div>
          <div><dt>Shares after</dt><dd>${formatQuantity(result.sharesAfter, holding)}</dd></div>
          <div><dt>Average after</dt><dd>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter, holding) : 'Closed'}</dd></div>
          <div><dt>Result</dt><dd class="${resultClass}">${escapeHtml(resultText)}</dd></div>
        </dl>
      </article>
    `;
  }).join('');

  return `
    <div class="table-wrap transaction-table">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>Price</th>
            <th>Shares</th>
            <th>Gross</th>
            <th>Fee</th>
            <th>Total / Net</th>
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
                  <td>—</td>
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
              <td>${formatCurrency(result.grossAmount)}</td>
              <td>${formatCurrency(result.feeAmount)} (${feeLabel({ mode: result.feeMode ?? 'percent', value: result.feeValue ?? 0 })})</td>
              <td>${formatCurrency(result.type === 'buy' ? result.totalAmount : result.netAmount)}</td>
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
    <div class="transaction-cards" aria-label="Planned transactions">${transactionCards}</div>
  `;
}

function field(
  id: string,
  label: string,
  value: string | number,
  type: 'text' | 'number',
  placeholder: string,
  step = 'any',
  mobileLabel = label,
): string {
  return `
    <label class="field">
      <span><span class="desktop-field-label">${label}</span><span class="mobile-field-label">${mobileLabel}</span></span>
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
  const transactionFee = activeFee(holding);
  const validTransaction = Boolean(
    analyzablePosition
      && isFinitePositive(holding.transactionPrice)
      && isFinitePositive(holding.transactionShares)
      && Number.isFinite(transactionFee.value)
      && transactionFee.value >= 0
      && (isBuy || holding.transactionShares <= analyzablePosition.shares),
  );

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">A</span>
        <div>
          <h1>Average Price Planner <span class="release-tag">v1.6</span></h1>
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
          ${holdingSummary(holding)}
          <div id="holdingEditor" class="holding-editor ${holdingEditorExpanded ? 'is-expanded' : ''}">
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
            ${field('currentMarketPrice', 'Current market price', holding.currentMarketPrice, 'number', '50')}
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
            ${field('transactionPrice', `${isBuy ? 'Buy' : 'Sell'} price per share`, holding.transactionPrice, 'number', '147', 'any', `${isBuy ? 'Buy' : 'Sell'} price`)}
            ${field('transactionShares', `Shares to ${isBuy ? 'buy' : 'sell'}`, holding.transactionShares, 'number', '4', 'any', 'Shares')}
            <div class="fee-controls" aria-label="${isBuy ? 'Buy' : 'Sell'} transaction fee">
              <span class="fee-controls-label">Fee</span>
              <div class="segmented-control fee-mode-control" aria-label="Fee mode">
                <button type="button" data-fee-mode="percent" class="${transactionFee.mode === 'percent' ? 'active' : ''}">Percent</button>
                <button type="button" data-fee-mode="fixed" class="${transactionFee.mode === 'fixed' ? 'active' : ''}">Fixed</button>
              </div>
              ${field('transactionFee', transactionFee.mode === 'percent' ? 'Fee percent' : 'Fixed fee', transactionFee.value, 'number', '0', '0.01', transactionFee.mode === 'percent' ? 'Fee %' : 'Fee')}
              <span class="fee-preview">${feeLabel(transactionFee)} · ${isFinitePositive(holding.transactionPrice) && isFinitePositive(holding.transactionShares) ? `Fee ${formatCurrency(transactionFee.mode === 'percent' ? holding.transactionPrice * holding.transactionShares * transactionFee.value / 100 : transactionFee.value)}` : 'Enter price and shares'}</span>
            </div>
            <button id="addTransaction" class="primary-button" ${validTransaction ? '' : 'disabled'}>Add ${isBuy ? 'buy' : 'sale'} to plan</button>
          </div>

          ${analyzablePosition
            ? `${transactionSummary(analyzablePosition, holding)}${resultStrip(analyzablePosition, holding)}`
            : `<div class="empty-state">Enter your current shares and average price before testing a transaction.</div>`}
        </section>

        ${marketSnapshotPanel(analyzablePosition, holding)}

        ${analyzablePosition ? targetsPanel(analyzablePosition, holding) : ''}

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

        ${dataManagementPanel(holding)}

        <p class="disclaimer">This app performs arithmetic and planning only; it does not assess investment quality. Calculations include the transaction fees you configure, but remain estimates before taxes. Selling does not change average cost under the average-cost method; it realizes a gain or loss on the shares sold.</p>
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
    'transactionFee',
    'budget',
    'shareStep',
    'efficiencyFloor',
    'budgetBenefitTarget',
    'currentMarketPrice',
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

  document.querySelector<HTMLButtonElement>('#toggleHoldingEditor')?.addEventListener('click', () => {
    holdingEditorExpanded = !holdingEditorExpanded;
    render();
  });

  document.querySelector<HTMLButtonElement>('#toggleCurve')?.addEventListener('click', () => {
    curveExpanded = !curveExpanded;
    render();
  });

  document.querySelector<HTMLButtonElement>('#toggleMarketSnapshot')?.addEventListener('click', () => {
    marketSnapshotExpanded = !marketSnapshotExpanded;
    render();
  });

  document.querySelector<HTMLButtonElement>('#toggleTargets')?.addEventListener('click', () => {
    targetsExpanded = !targetsExpanded;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-target-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      targetTab = button.dataset.targetTab === 'sell' ? 'sell' : 'average';
      targetsExpanded = true;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-target-sell-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      activeHolding().targetSellMode = button.dataset.targetSellMode === 'profit' ? 'profit' : button.dataset.targetSellMode === 'return' ? 'return' : 'breakEven';
      targetsExpanded = true;
      saveStore();
      render();
    });
  });

  ['targetAverage', 'targetBuyPrice', 'targetSellShares', 'targetSellValue'].forEach((id) => {
    document.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('input', (event) => {
      const holding = activeHolding();
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (id === 'targetAverage') holding.targetAverage = value;
      if (id === 'targetBuyPrice') holding.targetBuyPrice = value;
      if (id === 'targetSellShares') holding.targetSellShares = value;
      if (id === 'targetSellValue') holding.targetSellValue = value;
      saveStore();
    });
    document.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', () => {
      targetsExpanded = true;
      render();
    });
  });
  document.querySelector<HTMLInputElement>('#targetRespectBudget')?.addEventListener('change', (event) => {
    activeHolding().targetRespectBudget = (event.currentTarget as HTMLInputElement).checked;
    targetsExpanded = true;
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

  document.querySelectorAll<HTMLButtonElement>('[data-fee-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFee().mode = button.dataset.feeMode === 'fixed' ? 'fixed' : 'percent';
      saveStore();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#exportAll')?.addEventListener('click', () => exportBackup('all'));
  document.querySelector<HTMLButtonElement>('#exportActive')?.addEventListener('click', () => exportBackup('active'));
  document.querySelector<HTMLButtonElement>('#exportCsv')?.addEventListener('click', () => exportPlanCsv());
  document.querySelector<HTMLInputElement>('#importJson')?.addEventListener('change', async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Import rejected: backup files must be 5 MB or smaller.');
      pendingImport = parseBackupJson(await file.text());
      notice = 'Backup checked. Review the preview before applying it.';
    } catch (error) {
      pendingImport = null;
      notice = error instanceof Error ? error.message : 'Import rejected: the selected backup could not be read.';
    }
    render();
  });
  document.querySelector<HTMLButtonElement>('#applyMergeImport')?.addEventListener('click', () => applyPendingImport('merge'));
  document.querySelector<HTMLButtonElement>('#applyReplaceImport')?.addEventListener('click', () => applyPendingImport('replace'));

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
    const fee = activeFee(holding);
    if (!Number.isFinite(fee.value) || fee.value < 0) {
      notice = 'Enter a fee of zero or greater.';
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
      feeMode: fee.mode,
      feeValue: fee.value,
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

  document.querySelectorAll<HTMLButtonElement>('[data-remove], [data-remove-mobile]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.remove ?? button.dataset.removeMobile;
      const holding = activeHolding();
      holding.transactions = holding.transactions.filter((transaction) => transaction.id !== id);
      notice = 'Transaction removed.';
      saveStore();
      render();
    });
  });
}

render();
