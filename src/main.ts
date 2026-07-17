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
  type TransactionResult,
  type TransactionType,
} from './calculator';
import {
  createBackup,
  mergeBackupScenarios,
  ladderCsv,
  parseBackupJson,
  planCsv,
  scenarioCsv,
  type BackupDocument,
  type BackupPosition,
} from './data';
import type { DcaLadder, Scenario, ScenarioStatus, ScenarioTransaction, StressPrice } from './domain';
import {
  activeLadderFee,
  generateDcaLadder,
  previewExecutionApplication,
  projectLadder,
  projectScenario,
  reverseSell,
  stressPrices,
  summarizeScenario,
} from './planner';

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
  transactions: ScenarioTransaction[];
};

type AppStore = {
  version: 4;
  activeHoldingId: string;
  holdings: HoldingState[];
  scenarios: Scenario[];
  comparisonScenarioIds: string[];
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
let loadedScenarioId: string | null = null;
let scenarioPanelExpanded = false;
let comparisonExpanded = false;
let reverseSellExpanded = false;
let stressAscending = true;
let reverseShares: number | null = null;
let reversePrice: number | null = null;
let reverseTarget = 0;
let pendingApplicationScenarioId: string | null = null;
let reverseMode: 'breakEven' | 'profit' | 'return' | 'netProceeds' = 'profit';
let reverseDirection: 'price' | 'shares' = 'price';

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

function nonNegative(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
}

function normalizeScenarioTransaction(value: Partial<ScenarioTransaction>, index = 0): ScenarioTransaction | null {
  const shares = Number(value.shares);
  const price = Number(value.price);
  if (!isFinitePositive(shares) || !isFinitePositive(price)) return null;
  const createdAt = typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : '1970-01-01T00:00:00.000Z';
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId(),
    type: value.type === 'sell' ? 'sell' : 'buy',
    shares,
    price,
    feeMode: value.feeMode === 'fixed' ? 'fixed' : 'percent',
    feeValue: Number.isFinite(Number(value.feeValue)) && Number(value.feeValue) >= 0 ? Number(value.feeValue) : 0,
    status: value.status === 'executed' || value.status === 'cancelled' ? value.status : 'planned',
    createdAt,
    updatedAt,
    createdOrder: Number.isFinite(Number(value.createdOrder)) ? Number(value.createdOrder) : index,
    ...(typeof value.executionDate === 'string' && value.executionDate ? { executionDate: value.executionDate } : {}),
    ...(isFinitePositive(Number(value.executionPrice)) ? { executionPrice: Number(value.executionPrice) } : {}),
    ...(isFinitePositive(Number(value.executionShares)) ? { executionShares: Number(value.executionShares) } : {}),
    ...(Number.isFinite(Number(value.actualFee)) && Number(value.actualFee) >= 0 ? { actualFee: Number(value.actualFee) } : {}),
    ...(typeof value.note === 'string' ? { note: value.note.slice(0, 500) } : {}),
    ...(typeof value.brokerLabel === 'string' ? { brokerLabel: value.brokerLabel.slice(0, 120) } : {}),
    ...(typeof value.appliedAt === 'string' && value.appliedAt ? { appliedAt: value.appliedAt } : {}),
    ...(typeof value.ladderLevelId === 'string' && value.ladderLevelId ? { ladderLevelId: value.ladderLevelId } : {}),
  };
}

function defaultStressPrices(): StressPrice[] {
  return [-30, -20, -10, 0, 10, 20, 30].map((value) => ({ id: createId(), kind: 'percent' as const, value }));
}

function defaultLadder(): DcaLadder {
  return { levelCount: 4, startPrice: 40, endPrice: 30, distribution: 'equalCash', spacing: 'linear', totalInvestment: 1000, totalShares: 100, feeMode: 'percent', percentFeeValue: 0, fixedFeeValue: 0, sharePrecision: 1, pricePrecision: 2, includeCurrentPosition: true, levels: [] };
}

function normalizeScenario(value: Partial<Scenario>, fallbackHoldingId: string): Scenario | null {
  if (typeof value.id !== 'string' || !value.id) return null;
  const base = value.basePosition;
  if (!base || !Number.isFinite(Number(base.shares)) || Number(base.shares) < 0 || !Number.isFinite(Number(base.averagePrice)) || Number(base.averagePrice) < 0) return null;
  const ladderRaw = value.ladder;
  const ladder = ladderRaw && typeof ladderRaw === 'object'
    ? {
        ...defaultLadder(),
        ...ladderRaw,
        levels: Array.isArray(ladderRaw.levels)
          ? ladderRaw.levels.filter((level) => level && isFinitePositive(Number(level.shares)) && isFinitePositive(Number(level.price))).map((level) => ({ id: typeof level.id === 'string' && level.id ? level.id : createId(), price: Number(level.price), shares: Number(level.shares), feeMode: level.feeMode === 'fixed' ? 'fixed' as const : 'percent' as const, feeValue: Number.isFinite(Number(level.feeValue)) && Number(level.feeValue) >= 0 ? Number(level.feeValue) : 0 }))
          : [],
      } as DcaLadder
    : null;
  const transactions = Array.isArray(value.transactions)
    ? value.transactions.map((transaction, index) => normalizeScenarioTransaction(transaction, index)).filter((transaction): transaction is ScenarioTransaction => transaction !== null)
    : [];
  const createdAt = typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : '1970-01-01T00:00:00.000Z';
  return {
    id: value.id,
    holdingId: typeof value.holdingId === 'string' && value.holdingId ? value.holdingId : fallbackHoldingId,
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : 'Untitled scenario',
    note: typeof value.note === 'string' ? value.note.slice(0, 1000) : '',
    status: value.status === 'active' || value.status === 'completed' || value.status === 'archived' ? value.status : 'draft',
    createdAt,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt,
    basePosition: { shares: Number(base.shares), averagePrice: Number(base.averagePrice) },
    marketPrice: Number.isFinite(Number(value.marketPrice)) && Number(value.marketPrice) >= 0 ? Number(value.marketPrice) : 0,
    transactions,
    ladder,
    stressPrices: Array.isArray(value.stressPrices)
      ? value.stressPrices.filter((item) => item && (item.kind === 'absolute' || item.kind === 'percent') && Number.isFinite(Number(item.value))).map((item) => ({ id: typeof item.id === 'string' && item.id ? item.id : createId(), kind: item.kind, value: Number(item.value) }))
      : defaultStressPrices(),
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
      ? value.transactions.map((item, index) => normalizeScenarioTransaction(item, index)).filter((item): item is ScenarioTransaction => item !== null)
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
        ? legacy.purchases.map((purchase, index) => ({
            id: purchase.id || createId(),
            type: 'buy' as const,
            shares: Number(purchase.shares),
            price: Number(purchase.price),
            status: 'planned' as const,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            createdOrder: index,
          }))
        : [],
    });
    return { version: 4, activeHoldingId: holding.id, holdings: [holding], scenarios: [], comparisonScenarioIds: [] };
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
        const rawScenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
        const scenarios = rawScenarios.map((scenario) => normalizeScenario(scenario, activeHoldingId)).filter((scenario): scenario is Scenario => scenario !== null);
        const comparisonScenarioIds = Array.isArray(parsed.comparisonScenarioIds)
          ? parsed.comparisonScenarioIds.filter((id): id is string => typeof id === 'string' && scenarios.some((scenario) => scenario.id === id && scenario.status !== 'archived')).slice(0, 4)
          : [];
        const migrated = { version: 4 as const, activeHoldingId, holdings, scenarios, comparisonScenarioIds };
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
  return { version: 4, activeHoldingId: holding.id, holdings: [holding], scenarios: [], comparisonScenarioIds: [] };
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
  const preview = pendingImport ? (() => { const scenarioTransactions = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.length : 0), 0); const executed = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.filter((transaction) => transaction && typeof transaction === 'object' && (transaction as { status?: unknown }).status === 'executed').length : 0), 0); const applied = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.filter((transaction) => transaction && typeof transaction === 'object' && Boolean((transaction as { appliedAt?: unknown }).appliedAt)).length : 0), 0); return `<div class="import-preview"><strong>Backup preview</strong><span>${pendingImport.positions.length} positions · ${pendingImport.positions.reduce((total, position) => total + (Array.isArray(position.transactions) ? position.transactions.length : 0), 0)} plan transactions · ${pendingImport.scenarios.length} scenarios</span><span>${scenarioTransactions} scenario transactions · ${executed} executed · ${applied} applied</span><span>Exported ${escapeHtml(pendingImport.exportedAt)} · backup schema ${pendingImport.backupSchemaVersion}</span><div class="button-row"><button id="applyMergeImport" class="secondary-button">Merge with current data</button><button id="applyReplaceImport" class="text-button danger-text">Replace all current data</button></div></div>`; })() : '';
  return `
    <section class="panel data-panel">
      <div class="section-heading"><div><span class="eyebrow">Data management</span><h2>Backup, restore, and export</h2></div></div>
      <p class="helper-text">Everything stays in this browser. Different website origins keep separate browser data.</p>
      <div class="button-row data-actions"><button id="exportAll" class="secondary-button">Export all positions</button><button id="exportActive" class="secondary-button">Export active position</button><button id="exportCsv" class="secondary-button" ${holding.transactions.length ? '' : 'disabled'}>Export plan CSV</button><label class="secondary-button file-button">Import JSON<input id="importJson" type="file" accept="application/json,.json" hidden /></label></div>
      ${preview}
    </section>`;
}

function scenarioForActiveHolding(): Scenario[] {
  return store.scenarios.filter((scenario) => scenario.holdingId === activeHolding().id);
}

function loadedScenario(): Scenario | null {
  return store.scenarios.find((scenario) => scenario.id === loadedScenarioId) ?? null;
}

function createScenarioFromHolding(name = ''): Scenario | null {
  const holding = activeHolding();
  const base = validBasePosition(holding);
  if (!base) {
    notice = 'Enter a valid current position before creating a scenario.';
    return null;
  }
  const timestamp = new Date().toISOString();
  const scenario: Scenario = {
    id: createId(),
    holdingId: holding.id,
    name: name || `${holding.ticker || 'Position'} scenario`,
    note: '',
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    basePosition: base,
    marketPrice: holding.currentMarketPrice,
    transactions: holding.transactions.map((transaction, index) => ({ ...transaction, id: createId(), status: 'planned' as const, createdAt: timestamp, updatedAt: timestamp, createdOrder: index, appliedAt: undefined })),
    ladder: null,
    stressPrices: defaultStressPrices(),
  };
  store.scenarios.push(scenario);
  loadedScenarioId = scenario.id;
  scenarioPanelExpanded = true;
  saveStore();
  return scenario;
}

function touchScenario(scenario: Scenario): void {
  scenario.updatedAt = new Date().toISOString();
  saveStore();
}

function ensureLadder(scenario: Scenario): DcaLadder {
  if (!scenario.ladder) scenario.ladder = defaultLadder();
  return scenario.ladder;
}

function syncLadderTransactions(scenario: Scenario): void {
  const ladder = scenario.ladder;
  if (!ladder) return;
  const preserved = scenario.transactions.filter((transaction) => !transaction.ladderLevelId);
  const timestamp = new Date().toISOString();
  scenario.transactions = [...preserved, ...ladder.levels.map((level, index) => ({
    id: createId(), type: 'buy' as const, shares: level.shares, price: level.price,
    feeMode: level.feeMode, feeValue: level.feeValue, status: 'planned' as const,
    createdAt: timestamp, updatedAt: timestamp, createdOrder: preserved.length + index,
    ladderLevelId: level.id,
  }))];
}

function scenarioSummaryPanel(scenario: Scenario, holding: HoldingState): string {
  const summary = summarizeScenario(scenario, holding.sellFee);
  return `
    <div class="scenario-summary result-strip six">
      <div><span>Final shares</span><strong>${formatQuantity(summary.finalPosition.shares, holding)}</strong></div>
      <div><span>Final average</span><strong>${summary.finalPosition.shares ? formatCurrency(summary.finalPosition.averagePrice, holding) : 'Closed'}</strong></div>
      <div><span>Total fees</span><strong>${formatCurrency(summary.totalFees, holding)}</strong></div>
      <div><span>Realized P/L</span><strong class="${summary.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.realizedProfitLoss, holding)}</strong></div>
      <div><span>Unrealized P/L</span><strong class="${summary.unrealizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.unrealizedProfitLoss, holding)}</strong></div>
      <div><span>Break-even</span><strong>${formatCurrency(summary.breakEvenPrice, holding)}</strong></div>
    </div>`;
}

function ladderPanel(scenario: Scenario, holding: HoldingState): string {
  const ladder = scenario.ladder ?? defaultLadder();
  const projection = ladder.levels.length ? projectLadder(ladder, scenario.basePosition, scenario.marketPrice) : [];
  const activeFee = activeLadderFee(ladder);
  const rows = projection.map((row, index) => `
    <article class="ladder-card">
      <div class="scenario-card-heading"><strong>Level ${index + 1}</strong><span>Total ${formatCurrency(row.totalAmount, holding)}</span></div>
      <div class="ladder-edit-grid">
        <label class="field"><span>Price</span><input data-ladder-price="${row.level.id}" type="number" value="${row.level.price}" min="0" step="any" inputmode="decimal" /></label>
        <label class="field"><span>Shares</span><input data-ladder-shares="${row.level.id}" type="number" value="${row.level.shares}" min="0" step="any" inputmode="decimal" /></label>
      </div>
      <dl><div><dt>Gross / fee</dt><dd>${formatCurrency(row.grossAmount, holding)} / ${formatCurrency(row.feeAmount, holding)}</dd></div><div><dt>Cumulative shares</dt><dd>${formatQuantity(row.cumulativePosition.shares, holding)}</dd></div><div><dt>Cumulative basis</dt><dd>${formatCurrency(row.cumulativePosition.shares * row.cumulativePosition.averagePrice, holding)}</dd></div><div><dt>Cumulative average</dt><dd>${formatCurrency(row.cumulativePosition.averagePrice, holding)}</dd></div></dl>
      <div class="button-row"><button class="text-button" data-ladder-up="${row.level.id}" ${index === 0 ? 'disabled' : ''}>Move up</button><button class="text-button" data-ladder-down="${row.level.id}" ${index === projection.length - 1 ? 'disabled' : ''}>Move down</button><button class="text-button" data-ladder-duplicate="${row.level.id}">Duplicate</button><button class="text-button danger-text" data-ladder-remove="${row.level.id}">Remove</button></div>
    </article>`).join('');
  return `
    <section class="subpanel ladder-panel">
      <div class="section-heading compact"><div><span class="eyebrow">DCA ladder</span><h3>Build staged buys</h3></div><button id="exportLadderCsv" class="text-button" ${projection.length ? '' : 'disabled'}>Export ladder CSV</button></div>
      <div class="field-grid three">
        ${field('ladderLevels', 'Levels', ladder.levelCount, 'number', '4', '1')}
        ${field('ladderStart', 'Start price', ladder.startPrice, 'number', '40')}
        ${field('ladderEnd', 'End price', ladder.endPrice, 'number', '30')}
        ${field('ladderInvestment', ladder.distribution === 'equalShares' ? 'Total shares' : 'All-in cash', ladder.distribution === 'equalShares' ? ladder.totalShares : ladder.totalInvestment, 'number', '1000')}
        ${field('ladderShareStep', 'Share precision', ladder.sharePrecision, 'number', '1')}
        ${field('ladderPricePrecision', 'Price precision', ladder.pricePrecision, 'number', '2', '1')}
      </div>
      <div class="segmented-control scenario-segment" aria-label="DCA distribution"><button data-ladder-distribution="equalCash" class="${ladder.distribution === 'equalCash' ? 'active' : ''}">Equal cash</button><button data-ladder-distribution="equalShares" class="${ladder.distribution === 'equalShares' ? 'active' : ''}">Equal shares</button><button data-ladder-distribution="custom" class="${ladder.distribution === 'custom' ? 'active' : ''}">Custom</button></div>
      <div class="segmented-control scenario-segment" aria-label="DCA spacing"><button data-ladder-spacing="linear" class="${ladder.spacing === 'linear' ? 'active' : ''}">Linear prices</button><button data-ladder-spacing="percent" class="${ladder.spacing === 'percent' ? 'active' : ''}">Equal percent</button></div>
      <div class="fee-controls compact-fee" aria-label="Ladder fee"><span class="fee-controls-label">Ladder fee</span><div class="segmented-control fee-mode-control"><button data-ladder-fee-mode="percent" class="${ladder.feeMode === 'percent' ? 'active' : ''}">Percent</button><button data-ladder-fee-mode="fixed" class="${ladder.feeMode === 'fixed' ? 'active' : ''}">Fixed</button></div>${field('ladderFee', ladder.feeMode === 'fixed' ? 'Fixed fee' : 'Fee percent', activeFee.value, 'number', '0')}</div>
      <label class="check-field"><input id="ladderIncludeCurrent" type="checkbox" ${ladder.includeCurrentPosition ? 'checked' : ''} /> Include current position in cumulative average</label>
      <div class="button-row"><button id="generateLadder" class="secondary-button">Generate ladder</button><button id="addLadderLevel" class="secondary-button">Add level</button><button id="clearLadder" class="text-button">Clear</button></div>
      ${projection.length ? `<div class="ladder-cards">${rows}</div>` : '<div class="empty-state compact-empty">Generate a ladder, then fine-tune each level before saving the scenario.</div>'}
    </section>`;
}

function scenarioTransactionsPanel(scenario: Scenario, holding: HoldingState): string {
  if (!scenario.transactions.length) return `<div class="empty-state compact-empty">No scenario transactions yet. Generate a ladder or save a current plan.</div>`;
  return `<div class="scenario-transaction-cards">${scenario.transactions.map((transaction) => `
    <article class="transaction-card">
      <div class="transaction-card-heading"><span class="action-tag ${transaction.type}">${transaction.type === 'buy' ? 'Buy' : 'Sell'}</span><span class="status-tag ${transaction.status}">${transaction.status}</span></div>
      <dl><div><dt>Planned</dt><dd>${formatQuantity(transaction.shares, holding)} @ ${formatCurrency(transaction.price, holding)}</dd></div><div><dt>Fee</dt><dd>${feeLabel({ mode: transaction.feeMode ?? 'percent', value: transaction.feeValue ?? 0 }, holding)}</dd></div><div><dt>Execution</dt><dd>${transaction.executionDate || 'Not recorded'}</dd></div><div><dt>Applied</dt><dd>${transaction.appliedAt ? 'Applied' : 'Not applied'}</dd></div></dl>
      <div class="ladder-edit-grid"><label class="field"><span>Actual price</span><input data-execution-price="${transaction.id}" type="number" min="0" step="any" value="${transaction.executionPrice ?? transaction.price}" /></label><label class="field"><span>Actual shares</span><input data-execution-shares="${transaction.id}" type="number" min="0" step="any" value="${transaction.executionShares ?? transaction.shares}" /></label><label class="field"><span>Actual fee</span><input data-actual-fee="${transaction.id}" type="number" min="0" step="any" value="${transaction.actualFee ?? ''}" placeholder="Use planned" /></label><label class="field"><span>Execution date</span><input data-execution-date="${transaction.id}" type="datetime-local" value="${transaction.executionDate ?? ''}" /></label></div>
      <label class="field"><span>Note</span><input data-transaction-note="${transaction.id}" type="text" value="${escapeHtml(transaction.note ?? '')}" placeholder="Optional note" /></label>
      <label class="field"><span>Broker / account</span><input data-broker-label="${transaction.id}" type="text" value="${escapeHtml(transaction.brokerLabel ?? '')}" placeholder="Optional label" /></label>
      <div class="button-row"><button class="text-button" data-transaction-status="${transaction.id}" data-status="planned">Planned</button><button class="text-button" data-transaction-status="${transaction.id}" data-status="executed">Executed</button><button class="text-button danger-text" data-transaction-status="${transaction.id}" data-status="cancelled">Cancelled</button></div>
    </article>`).join('')}</div>`;
}

function scenarioPlannerPanel(holding: HoldingState): string {
  const scenario = loadedScenario();
  const content = scenario ? `
    <div class="field-grid two">${field('scenarioName', 'Scenario name', scenario.name, 'text', 'Scenario')}<label class="field"><span>Status</span><select id="scenarioStatus">${(['draft', 'active', 'completed', 'archived'] as ScenarioStatus[]).map((status) => `<option value="${status}" ${scenario.status === status ? 'selected' : ''}>${status[0]!.toUpperCase() + status.slice(1)}</option>`).join('')}</select></label>${field('scenarioMarketPrice', 'Scenario market price', scenario.marketPrice, 'number', '50')}<label class="field"><span>Scenario note</span><input id="scenarioNote" type="text" value="${escapeHtml(scenario.note)}" placeholder="Optional note" /></label></div>
    ${scenarioSummaryPanel(scenario, holding)}
    ${ladderPanel(scenario, holding)}
    <section class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">Scenario transactions</span><h3>Planned, executed, and cancelled</h3></div><button id="exportScenarioCsv" class="text-button">Export scenario CSV</button></div>${scenarioTransactionsPanel(scenario, holding)}</section>
    ${stressPanel(scenario, holding)}
    ${reverseSellPanel(scenario, holding)}
    ${executionApplicationPanel(scenario, holding)}` : `<div class="empty-state">Create or load a saved scenario to build a DCA ladder, record execution values, compare outcomes, and stress-test prices.</div>`;
  return `
    <section class="panel scenario-planner-panel">
      <div class="section-heading"><div><span class="eyebrow">Scenario planner</span><h2>Build before changing your position</h2></div><button id="toggleScenarioPlanner" class="text-button" aria-expanded="${scenarioPanelExpanded}" aria-controls="scenarioPlannerContent">${scenarioPanelExpanded ? 'Hide planner' : 'Show planner'}</button></div>
      <div id="scenarioPlannerContent" class="disclosure-content ${scenarioPanelExpanded ? 'is-expanded' : ''}">${content}</div>
    </section>`;
}

function stressPanel(scenario: Scenario, holding: HoldingState): string {
  const summary = summarizeScenario(scenario, holding.sellFee);
  const baseMarket = scenario.marketPrice || holding.currentMarketPrice;
  const entries = stressPrices(scenario.stressPrices, baseMarket).filter((item) => Number.isFinite(item.price) && item.price >= 0).sort((a, b) => stressAscending ? a.price - b.price : b.price - a.price);
  return `
    <section class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">Stress test</span><h3>Price outcomes</h3></div><button id="toggleStressSort" class="text-button">Sort ${stressAscending ? 'descending' : 'ascending'}</button></div>
      <div class="button-row"><button id="resetStressPrices" class="text-button">Reset defaults</button><button id="addStressPrice" class="text-button">Add custom price</button></div>
      <div class="stress-cards">${entries.map(({ entry, price }) => {
        const marketValue = summary.finalPosition.shares * price;
        const unrealized = marketValue - summary.finalCostBasis - (summary.finalPosition.shares ? feeAmountForScenario(marketValue, holding.sellFee) : 0);
        const total = summary.realizedProfitLoss + unrealized;
        return `<article class="scenario-card"><div class="scenario-card-heading"><strong>${formatCurrency(price, holding)}</strong><button class="icon-button" data-remove-stress="${entry.id}" aria-label="Remove stress price">×</button></div><dl><div><dt>Final value</dt><dd>${formatCurrency(marketValue, holding)}</dd></div><div><dt>Unrealized P/L</dt><dd class="${unrealized >= 0 ? 'positive' : 'negative'}">${formatCurrency(unrealized, holding)}</dd></div><div><dt>Realized P/L</dt><dd>${formatCurrency(summary.realizedProfitLoss, holding)}</dd></div><div><dt>Total projected P/L</dt><dd class="${total >= 0 ? 'positive' : 'negative'}">${formatCurrency(total, holding)}</dd></div></dl></article>`;
      }).join('')}</div>
    </section>`;
}

function feeAmountForScenario(gross: number, fee: FeeSettings): number {
  return fee.mode === 'percent' ? gross * fee.value / 100 : fee.value;
}

function reverseSellPanel(scenario: Scenario, holding: HoldingState): string {
  const shares = reverseShares ?? scenario.basePosition.shares;
  const price = reversePrice ?? scenario.marketPrice;
  const result = reverseSell({ position: scenario.basePosition, fee: holding.sellFee, shareStep: holding.shareStep, mode: reverseMode, direction: reverseDirection, shares, price, targetValue: reverseTarget });
  return `
    <section class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">Reverse sell</span><h3>Plan an exit</h3></div><button id="toggleReverseSell" class="text-button" aria-expanded="${reverseSellExpanded}">${reverseSellExpanded ? 'Hide' : 'Show'}</button></div>
    <div class="disclosure-content ${reverseSellExpanded ? 'is-expanded' : ''}"><div class="segmented-control scenario-segment"><button data-reverse-direction="price" class="${reverseDirection === 'price' ? 'active' : ''}">Solve price</button><button data-reverse-direction="shares" class="${reverseDirection === 'shares' ? 'active' : ''}">Solve shares</button></div><div class="segmented-control scenario-segment"><button data-reverse-mode="profit" class="${reverseMode === 'profit' ? 'active' : ''}">Profit</button><button data-reverse-mode="return" class="${reverseMode === 'return' ? 'active' : ''}">Return %</button><button data-reverse-mode="netProceeds" class="${reverseMode === 'netProceeds' ? 'active' : ''}">Net proceeds</button><button data-reverse-mode="breakEven" class="${reverseMode === 'breakEven' ? 'active' : ''}">Break even</button></div><div class="field-grid three">${field('reverseShares', 'Shares to sell', shares, 'number', '100')}${field('reversePrice', 'Sale price', price, 'number', '60')}${field('reverseTarget', reverseMode === 'return' ? 'Target return %' : reverseMode === 'netProceeds' ? 'Target net proceeds' : 'Profit target', reverseTarget, 'number', '500')}</div>${result.valid ? `<div class="result-strip six"><div><span>Required price</span><strong>${formatCurrency(result.requiredPrice, holding)}</strong></div><div><span>Quantity</span><strong>${formatQuantity(result.requiredShares, holding)}</strong></div><div><span>Gross / fee</span><strong>${formatCurrency(result.grossAmount, holding)} / ${formatCurrency(result.feeAmount, holding)}</strong></div><div><span>Net proceeds</span><strong>${formatCurrency(result.netAmount, holding)}</strong></div><div><span>Realized P/L</span><strong>${formatCurrency(result.realizedProfitLoss, holding)}</strong></div><div><span>Remaining shares</span><strong>${formatQuantity(result.remainingPosition.shares, holding)}</strong></div></div>` : `<div class="plain-summary warning-summary"><strong>${escapeHtml(result.error ?? 'Enter valid reverse-sell inputs.')}</strong></div>`}</div></section>`;
}

function executionApplicationPanel(scenario: Scenario, holding: HoldingState): string {
  const preview = previewExecutionApplication({ shares: holding.baseShares, averagePrice: holding.baseAverage }, scenario);
  const isPending = pendingApplicationScenarioId === scenario.id;
  return `<section class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">Apply execution</span><h3>Update saved position explicitly</h3></div><button id="previewApplyExecuted" class="secondary-button" ${preview.candidates.length ? '' : 'disabled'}>Apply executed transactions</button></div>${isPending ? `<div class="import-preview"><strong>Application preview</strong><span>${preview.candidates.length} executed transaction${preview.candidates.length === 1 ? '' : 's'}; ${preview.skipped.length} skipped.</span>${preview.valid ? `<span>Result: ${formatQuantity(preview.finalPosition.shares, holding)} shares at ${formatCurrency(preview.finalPosition.averagePrice, holding)} · Fees ${formatCurrency(preview.totalFees, holding)} · Realized P/L ${formatCurrency(preview.realizedProfitLoss, holding)}</span><div class="button-row"><button id="confirmApplyExecuted" class="secondary-button">Confirm apply</button><button id="cancelApplyExecuted" class="text-button">Cancel</button></div>` : `<span class="negative">${escapeHtml(preview.error ?? 'The application is blocked.')}</span>`}</div>` : '<p class="helper-text">Only executed, not-yet-applied rows are considered. Planned and cancelled rows are skipped.</p>'}</section>`;
}

function savedScenariosPanel(holding: HoldingState): string {
  const scenarios = scenarioForActiveHolding();
  return `<section class="panel"><div class="section-heading"><div><span class="eyebrow">Saved scenarios</span><h2>Compare plans safely</h2></div><div class="button-row"><button id="newScenario" class="secondary-button">New scenario</button><button id="savePlanScenario" class="secondary-button">Save current plan</button></div></div>${scenarios.length ? `<div class="saved-scenario-cards">${scenarios.map((scenario) => { const summary = summarizeScenario(scenario, holding.sellFee); return `<article class="scenario-card ${scenario.status === 'archived' ? 'archived' : ''}"><div class="scenario-card-heading"><strong>${escapeHtml(scenario.name)}</strong><span class="status-tag ${scenario.status}">${scenario.status}</span></div><p>${escapeHtml(scenario.note || 'No note')}</p><dl><div><dt>Final position</dt><dd>${formatQuantity(summary.finalPosition.shares, holding)} @ ${formatCurrency(summary.finalPosition.averagePrice, holding)}</dd></div><div><dt>Total P/L</dt><dd class="${summary.totalProjectedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.totalProjectedProfitLoss, holding)}</dd></div></dl><div class="button-row"><button class="text-button" data-load-scenario="${scenario.id}">Load</button><button class="text-button" data-duplicate-scenario="${scenario.id}">Duplicate</button><button class="text-button" data-scenario-archive="${scenario.id}">${scenario.status === 'archived' ? 'Restore' : 'Archive'}</button><button class="text-button danger-text" data-delete-scenario="${scenario.id}">Delete</button><label class="compare-check"><input type="checkbox" data-compare-scenario="${scenario.id}" ${store.comparisonScenarioIds.includes(scenario.id) ? 'checked' : ''} ${scenario.status === 'archived' ? 'disabled' : ''} /> Compare</label></div></article>`; }).join('')}</div>` : '<div class="empty-state">No saved scenarios for this position yet.</div>'}</section>`;
}

function comparisonPanel(holding: HoldingState): string {
  const scenarios = store.scenarios.filter((scenario) => store.comparisonScenarioIds.includes(scenario.id) && scenario.status !== 'archived');
  return `<section class="panel"><div class="section-heading"><div><span class="eyebrow">Compare</span><h2>Up to four scenarios</h2></div><button id="toggleComparison" class="text-button" aria-expanded="${comparisonExpanded}">${comparisonExpanded ? 'Hide comparison' : 'Show comparison'}</button></div><div class="disclosure-content ${comparisonExpanded ? 'is-expanded' : ''}">${scenarios.length ? `<div class="comparison-cards">${scenarios.map((scenario) => { const summary = summarizeScenario(scenario, holding.sellFee); return `<article class="scenario-card"><div class="scenario-card-heading"><strong>${escapeHtml(scenario.name)}</strong><button class="icon-button" data-remove-comparison="${scenario.id}" aria-label="Remove from comparison">×</button></div><dl><div><dt>Starting position</dt><dd>${formatQuantity(summary.startingShares, holding)} @ ${formatCurrency(summary.startingAverage, holding)}</dd></div><div><dt>Planned buys / sells</dt><dd>${formatQuantity(summary.plannedBuyShares, holding)} / ${formatQuantity(summary.plannedSellShares, holding)}</dd></div><div><dt>Total fees</dt><dd>${formatCurrency(summary.totalFees, holding)}</dd></div><div><dt>Final quantity</dt><dd>${formatQuantity(summary.finalPosition.shares, holding)}</dd></div><div><dt>Final average</dt><dd>${formatCurrency(summary.finalPosition.averagePrice, holding)}</dd></div><div><dt>Market value</dt><dd>${formatCurrency(summary.marketValue, holding)}</dd></div><div><dt>Realized P/L</dt><dd>${formatCurrency(summary.realizedProfitLoss, holding)}</dd></div><div><dt>Unrealized P/L</dt><dd>${formatCurrency(summary.unrealizedProfitLoss, holding)}</dd></div><div><dt>Break-even</dt><dd>${formatCurrency(summary.breakEvenPrice, holding)}</dd></div><div><dt>Maximum cash required</dt><dd>${formatCurrency(summary.maximumCapitalRequirement, holding)}</dd></div></dl></article>`; }).join('')}</div><button id="clearComparison" class="text-button">Clear comparison</button>` : '<div class="empty-state">Select up to four active scenarios to compare their arithmetic outcomes.</div>'}</div></section>`;
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
  const scenarios = scope === 'all' ? store.scenarios : store.scenarios.filter((scenario) => scenario.holdingId === holding.id);
  const backup = createBackup(positions as unknown as BackupPosition[], scope === 'all' ? store.activeHoldingId : undefined, scope, undefined, scenarios as unknown as BackupPosition[], scope === 'all' ? store.comparisonScenarioIds : store.comparisonScenarioIds.filter((id) => scenarios.some((scenario) => scenario.id === id)));
  const prefix = scope === 'active' && holding.ticker ? holding.ticker.replace(/[^A-Z0-9._-]/gi, '').slice(0, 24) : 'average-price-planner';
  downloadText(`${prefix}-backup-${dateStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  notice = `Exported ${positions.length} position${positions.length === 1 ? '' : 's'} and ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} as a browser-local backup.`;
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
  const importedScenarios = pendingImport.scenarios.map((scenario) => normalizeScenario(scenario, imported[0]?.id ?? activeHolding().id)).filter((scenario): scenario is Scenario => scenario !== null);
  if (mode === 'merge') {
    const usedHoldingIds = new Set(store.holdings.map((holding) => holding.id));
    const holdingIdMap = new Map<string, string>();
    const mergedImported = imported.map((holding) => {
      const originalId = holding.id;
      let id = originalId;
      while (usedHoldingIds.has(id)) id = createId();
      usedHoldingIds.add(id);
      holdingIdMap.set(originalId, id);
      return { ...holding, id };
    });
    store.holdings = [...store.holdings, ...mergedImported];
    const remappedScenarios = importedScenarios.map((scenario) => ({ ...scenario, holdingId: holdingIdMap.get(scenario.holdingId) ?? scenario.holdingId }));
    store.scenarios = mergeBackupScenarios(store.scenarios as unknown as BackupPosition[], remappedScenarios as unknown as BackupPosition[], createId)
      .map((scenario) => normalizeScenario(scenario, activeHolding().id))
      .filter((scenario): scenario is Scenario => scenario !== null);
  } else {
    store.holdings = imported.length ? imported : [createHolding()];
    store.scenarios = importedScenarios.filter((scenario) => store.holdings.some((holding) => holding.id === scenario.holdingId));
    store.comparisonScenarioIds = pendingImport.comparisonScenarioIds.filter((id) => store.scenarios.some((scenario) => scenario.id === id && scenario.status !== 'archived')).slice(0, 4);
  }
  store.activeHoldingId = mode === 'replace' && pendingImport.activeHoldingId && store.holdings.some((holding) => holding.id === pendingImport!.activeHoldingId)
    ? pendingImport.activeHoldingId
    : store.holdings[0]!.id;
  const transactionCount = imported.reduce((total, holding) => total + holding.transactions.length, 0);
  pendingImport = null;
  saveStore();
  notice = `Imported ${imported.length} position${imported.length === 1 ? '' : 's'}, ${transactionCount} plan transaction${transactionCount === 1 ? '' : 's'}, and ${importedScenarios.length} scenario${importedScenarios.length === 1 ? '' : 's'}.`;
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
          <h1>Average Price Planner <span class="release-tag">v1.7</span></h1>
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

        ${scenarioPlannerPanel(holding)}

        ${savedScenariosPanel(holding)}

        ${comparisonPanel(holding)}

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
      status: 'planned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdOrder: holding.transactions.length,
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

  document.querySelector<HTMLButtonElement>('#toggleScenarioPlanner')?.addEventListener('click', () => {
    scenarioPanelExpanded = !scenarioPanelExpanded;
    render();
  });
  document.querySelector<HTMLButtonElement>('#newScenario')?.addEventListener('click', () => {
    if (createScenarioFromHolding()) notice = 'New scenario created from the current position.';
    render();
  });
  document.querySelector<HTMLButtonElement>('#savePlanScenario')?.addEventListener('click', () => {
    if (createScenarioFromHolding(`${activeHolding().ticker || 'Position'} saved plan`)) notice = 'Current plan saved as an independent scenario.';
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-load-scenario]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.loadScenario;
    if (!id || !store.scenarios.some((scenario) => scenario.id === id)) return;
    if (!window.confirm('Load this scenario into the planner? Your saved current position will not be changed.')) return;
    loadedScenarioId = id;
    scenarioPanelExpanded = true;
    pendingApplicationScenarioId = null;
    notice = 'Scenario loaded into the planner workspace.';
    render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-duplicate-scenario]').forEach((button) => button.addEventListener('click', () => {
    const source = store.scenarios.find((scenario) => scenario.id === button.dataset.duplicateScenario);
    if (!source) return;
    const timestamp = new Date().toISOString();
    const copy: Scenario = JSON.parse(JSON.stringify(source)) as Scenario;
    copy.id = createId(); copy.name = `${source.name} copy`; copy.status = 'draft'; copy.createdAt = timestamp; copy.updatedAt = timestamp;
    copy.transactions = copy.transactions.map((transaction, index) => ({ ...transaction, id: createId(), appliedAt: undefined, createdAt: timestamp, updatedAt: timestamp, createdOrder: index }));
    copy.ladder = copy.ladder ? { ...copy.ladder, levels: copy.ladder.levels.map((level) => ({ ...level, id: createId() })) } : null;
    store.scenarios.push(copy); loadedScenarioId = copy.id; scenarioPanelExpanded = true; saveStore(); notice = 'Scenario duplicated.'; render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-scenario-archive]').forEach((button) => button.addEventListener('click', () => {
    const scenario = store.scenarios.find((item) => item.id === button.dataset.scenarioArchive);
    if (!scenario) return;
    scenario.status = scenario.status === 'archived' ? 'draft' : 'archived';
    store.comparisonScenarioIds = store.comparisonScenarioIds.filter((id) => id !== scenario.id);
    touchScenario(scenario); notice = scenario.status === 'archived' ? 'Scenario archived.' : 'Scenario restored as a draft.'; render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-scenario]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.deleteScenario;
    if (!id || !window.confirm('Delete this saved scenario? This cannot be undone.')) return;
    store.scenarios = store.scenarios.filter((scenario) => scenario.id !== id);
    store.comparisonScenarioIds = store.comparisonScenarioIds.filter((item) => item !== id);
    if (loadedScenarioId === id) loadedScenarioId = null;
    saveStore(); notice = 'Scenario deleted.'; render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-compare-scenario]').forEach((input) => input.addEventListener('change', () => {
    const id = input.dataset.compareScenario;
    const scenario = store.scenarios.find((item) => item.id === id);
    if (!id || !scenario || scenario.status === 'archived') return;
    if (input.checked) {
      if (store.comparisonScenarioIds.length >= 4) { notice = 'Comparison is limited to four non-archived scenarios.'; input.checked = false; render(); return; }
      store.comparisonScenarioIds = [...store.comparisonScenarioIds.filter((item) => item !== id), id];
      comparisonExpanded = true;
    } else store.comparisonScenarioIds = store.comparisonScenarioIds.filter((item) => item !== id);
    saveStore(); render();
  }));
  document.querySelector<HTMLButtonElement>('#toggleComparison')?.addEventListener('click', () => { comparisonExpanded = !comparisonExpanded; render(); });
  document.querySelector<HTMLButtonElement>('#clearComparison')?.addEventListener('click', () => { store.comparisonScenarioIds = []; saveStore(); render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-remove-comparison]').forEach((button) => button.addEventListener('click', () => { store.comparisonScenarioIds = store.comparisonScenarioIds.filter((id) => id !== button.dataset.removeComparison); saveStore(); render(); }));

  const scenario = loadedScenario();
  const updateScenarioField = (id: string, apply: (value: string) => void): void => {
    document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.addEventListener('change', (event) => {
      const current = loadedScenario(); if (!current) return;
      apply((event.currentTarget as HTMLInputElement | HTMLSelectElement).value); touchScenario(current); render();
    });
  };
  updateScenarioField('scenarioName', (value) => { const current = loadedScenario(); if (current) current.name = value.trim() || 'Untitled scenario'; });
  updateScenarioField('scenarioStatus', (value) => { const current = loadedScenario(); if (current) { current.status = (['draft', 'active', 'completed', 'archived'] as string[]).includes(value) ? value as ScenarioStatus : 'draft'; if (current.status === 'archived') store.comparisonScenarioIds = store.comparisonScenarioIds.filter((id) => id !== current.id); } });
  updateScenarioField('scenarioMarketPrice', (value) => { const current = loadedScenario(); if (current) current.marketPrice = nonNegative(value); });
  updateScenarioField('scenarioNote', (value) => { const current = loadedScenario(); if (current) current.note = value; });

  if (scenario) {
    const ladder = ensureLadder(scenario);
    ['ladderLevels', 'ladderStart', 'ladderEnd', 'ladderInvestment', 'ladderShareStep', 'ladderPricePrecision', 'ladderFee'].forEach((id) => {
      document.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', (event) => {
        const value = nonNegative((event.currentTarget as HTMLInputElement).value);
        if (id === 'ladderLevels') ladder.levelCount = Math.max(2, Math.min(20, Math.round(value)));
        if (id === 'ladderStart') ladder.startPrice = value;
        if (id === 'ladderEnd') ladder.endPrice = value;
        if (id === 'ladderInvestment') { if (ladder.distribution === 'equalShares') ladder.totalShares = value; else ladder.totalInvestment = value; }
        if (id === 'ladderShareStep') ladder.sharePrecision = Math.max(Number.EPSILON, value);
        if (id === 'ladderPricePrecision') ladder.pricePrecision = Math.max(Number.EPSILON, value);
        if (id === 'ladderFee') { if (ladder.feeMode === 'fixed') ladder.fixedFeeValue = value; else ladder.percentFeeValue = value; }
        touchScenario(scenario); render();
      });
    });
    document.querySelector<HTMLInputElement>('#ladderIncludeCurrent')?.addEventListener('change', (event) => { ladder.includeCurrentPosition = (event.currentTarget as HTMLInputElement).checked; touchScenario(scenario); render(); });
    document.querySelectorAll<HTMLButtonElement>('[data-ladder-distribution]').forEach((button) => button.addEventListener('click', () => { ladder.distribution = button.dataset.ladderDistribution === 'equalShares' ? 'equalShares' : button.dataset.ladderDistribution === 'custom' ? 'custom' : 'equalCash'; touchScenario(scenario); render(); }));
    document.querySelectorAll<HTMLButtonElement>('[data-ladder-spacing]').forEach((button) => button.addEventListener('click', () => { ladder.spacing = button.dataset.ladderSpacing === 'percent' ? 'percent' : 'linear'; touchScenario(scenario); render(); }));
    document.querySelectorAll<HTMLButtonElement>('[data-ladder-fee-mode]').forEach((button) => button.addEventListener('click', () => { ladder.feeMode = button.dataset.ladderFeeMode === 'fixed' ? 'fixed' : 'percent'; touchScenario(scenario); render(); }));
    document.querySelector<HTMLButtonElement>('#generateLadder')?.addEventListener('click', () => {
      try {
        const generated = generateDcaLadder({ ...ladder, distribution: ladder.distribution === 'custom' ? 'equalShares' : ladder.distribution, makeId: createId });
        if (generated.error) throw new Error(generated.error);
        scenario.ladder = { ...generated.ladder, distribution: ladder.distribution };
        syncLadderTransactions(scenario); touchScenario(scenario); notice = 'Fee-aware ladder generated. Fine-tune rows before execution.';
      } catch (error) { notice = error instanceof Error ? error.message : 'Could not generate this ladder.'; }
      render();
    });
    document.querySelector<HTMLButtonElement>('#addLadderLevel')?.addEventListener('click', () => { const last = ladder.levels.at(-1); ladder.levels.push({ id: createId(), price: last?.price ?? ladder.endPrice, shares: last?.shares ?? ladder.sharePrecision, feeMode: ladder.feeMode, feeValue: activeLadderFee(ladder).value }); ladder.levelCount = Math.min(20, ladder.levels.length); syncLadderTransactions(scenario); touchScenario(scenario); render(); });
    document.querySelector<HTMLButtonElement>('#clearLadder')?.addEventListener('click', () => { scenario.transactions = scenario.transactions.filter((transaction) => !transaction.ladderLevelId); scenario.ladder = null; touchScenario(scenario); notice = 'Ladder cleared; other scenario transactions were kept.'; render(); });
    const changeLevel = (selector: string, apply: (level: DcaLadder['levels'][number], value: number) => void): void => document.querySelectorAll<HTMLInputElement>(selector).forEach((input) => input.addEventListener('change', () => { const level = ladder.levels.find((item) => item.id === (input.dataset.ladderPrice ?? input.dataset.ladderShares)); if (!level) return; apply(level, nonNegative(input.value)); syncLadderTransactions(scenario); touchScenario(scenario); render(); }));
    changeLevel('[data-ladder-price]', (level, value) => { level.price = value; });
    changeLevel('[data-ladder-shares]', (level, value) => { level.shares = value; });
    document.querySelectorAll<HTMLButtonElement>('[data-ladder-remove], [data-ladder-duplicate], [data-ladder-up], [data-ladder-down]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.ladderRemove ?? button.dataset.ladderDuplicate ?? button.dataset.ladderUp ?? button.dataset.ladderDown; const index = ladder.levels.findIndex((level) => level.id === id); if (index < 0) return; if (button.dataset.ladderRemove) ladder.levels.splice(index, 1); if (button.dataset.ladderDuplicate) ladder.levels.splice(index + 1, 0, { ...ladder.levels[index]!, id: createId() }); if (button.dataset.ladderUp && index > 0) [ladder.levels[index - 1], ladder.levels[index]] = [ladder.levels[index]!, ladder.levels[index - 1]!]; if (button.dataset.ladderDown && index < ladder.levels.length - 1) [ladder.levels[index + 1], ladder.levels[index]] = [ladder.levels[index]!, ladder.levels[index + 1]!]; ladder.levelCount = Math.max(2, ladder.levels.length); syncLadderTransactions(scenario); touchScenario(scenario); render(); }));
    document.querySelector<HTMLButtonElement>('#exportLadderCsv')?.addEventListener('click', () => { const rows = projectLadder(ladder, scenario.basePosition, scenario.marketPrice).map((row, index) => ({ level: index + 1, price: row.level.price, shares: row.level.shares, grossAmount: row.grossAmount, feeMode: row.level.feeMode, feeValue: row.level.feeValue, feeAmount: row.feeAmount, totalAmount: row.totalAmount, cumulativeShares: row.cumulativePosition.shares, cumulativeBasis: row.cumulativePosition.shares * row.cumulativePosition.averagePrice, cumulativeAverage: row.cumulativePosition.averagePrice, currency: activeHolding().currency })); downloadText('dca-ladder.csv', ladderCsv(rows), 'text/csv;charset=utf-8'); });
    document.querySelector<HTMLButtonElement>('#exportScenarioCsv')?.addEventListener('click', () => { const results = projectScenario(scenario).results; const rows = scenario.transactions.map((transaction, index) => { const result = results.find((item) => item.id === transaction.id); return { sequence: index + 1, scenarioName: scenario.name, scenarioStatus: scenario.status, transactionStatus: transaction.status, type: transaction.type, date: transaction.executionDate ?? transaction.createdAt, shares: result?.shares ?? transaction.shares, price: result?.price ?? transaction.price, feeMode: result?.feeMode ?? transaction.feeMode ?? 'percent', feeValue: result?.feeValue ?? transaction.feeValue ?? 0, grossAmount: result?.grossAmount ?? 0, feeAmount: result?.feeAmount ?? 0, totalPaid: result?.totalAmount ?? 0, netReceived: result?.netAmount ?? 0, sharesAfter: result?.sharesAfter ?? 0, averageAfter: result?.averageAfter ?? 0, averageChange: result?.averageChange ?? 0, realizedProfitLoss: result?.realizedProfitLoss ?? 0, note: transaction.note ?? '', brokerLabel: transaction.brokerLabel ?? '', applied: transaction.appliedAt ? 'Applied' : 'Not applied', currency: activeHolding().currency }; }); downloadText('scenario.csv', scenarioCsv(rows), 'text/csv;charset=utf-8'); });
    const changeTransaction = (selector: string, apply: (transaction: ScenarioTransaction, value: string) => void): void => document.querySelectorAll<HTMLInputElement>(selector).forEach((input) => input.addEventListener('change', () => { const id = input.dataset.executionPrice ?? input.dataset.executionShares ?? input.dataset.actualFee ?? input.dataset.executionDate ?? input.dataset.transactionNote ?? input.dataset.brokerLabel; const transaction = scenario.transactions.find((item) => item.id === id); if (!transaction) return; apply(transaction, input.value); touchScenario(scenario); render(); }));
    changeTransaction('[data-execution-price]', (transaction, value) => { transaction.executionPrice = nonNegative(value); });
    changeTransaction('[data-execution-shares]', (transaction, value) => { transaction.executionShares = nonNegative(value); });
    changeTransaction('[data-actual-fee]', (transaction, value) => { transaction.actualFee = value.trim() === '' ? undefined : nonNegative(value); });
    changeTransaction('[data-execution-date]', (transaction, value) => { transaction.executionDate = value || undefined; });
    changeTransaction('[data-transaction-note]', (transaction, value) => { transaction.note = value; });
    changeTransaction('[data-broker-label]', (transaction, value) => { transaction.brokerLabel = value; });
    document.querySelectorAll<HTMLButtonElement>('[data-transaction-status]').forEach((button) => button.addEventListener('click', () => { const transaction = scenario.transactions.find((item) => item.id === button.dataset.transactionStatus); if (!transaction) return; transaction.status = button.dataset.status === 'executed' ? 'executed' : button.dataset.status === 'cancelled' ? 'cancelled' : 'planned'; if (transaction.status === 'executed' && !transaction.executionDate) transaction.executionDate = new Date().toISOString().slice(0, 16); touchScenario(scenario); render(); }));
    document.querySelector<HTMLButtonElement>('#resetStressPrices')?.addEventListener('click', () => { scenario.stressPrices = defaultStressPrices(); touchScenario(scenario); render(); });
    document.querySelector<HTMLButtonElement>('#addStressPrice')?.addEventListener('click', () => { const value = window.prompt('Enter an absolute stress-test price'); if (value === null) return; const price = Number(value); if (!Number.isFinite(price) || price < 0) { notice = 'Enter a price of zero or greater.'; render(); return; } scenario.stressPrices.push({ id: createId(), kind: 'absolute', value: price }); touchScenario(scenario); render(); });
    document.querySelector<HTMLButtonElement>('#toggleStressSort')?.addEventListener('click', () => { stressAscending = !stressAscending; render(); });
    document.querySelectorAll<HTMLButtonElement>('[data-remove-stress]').forEach((button) => button.addEventListener('click', () => { scenario.stressPrices = scenario.stressPrices.filter((entry) => entry.id !== button.dataset.removeStress); touchScenario(scenario); render(); }));
    document.querySelector<HTMLButtonElement>('#toggleReverseSell')?.addEventListener('click', () => { reverseSellExpanded = !reverseSellExpanded; render(); });
    document.querySelectorAll<HTMLButtonElement>('[data-reverse-direction]').forEach((button) => button.addEventListener('click', () => { reverseDirection = button.dataset.reverseDirection === 'shares' ? 'shares' : 'price'; render(); }));
    document.querySelectorAll<HTMLButtonElement>('[data-reverse-mode]').forEach((button) => button.addEventListener('click', () => { const mode = button.dataset.reverseMode; reverseMode = mode === 'return' || mode === 'netProceeds' || mode === 'breakEven' ? mode : 'profit'; render(); }));
    document.querySelector<HTMLInputElement>('#reverseShares')?.addEventListener('change', (event) => { reverseShares = Number((event.currentTarget as HTMLInputElement).value); render(); });
    document.querySelector<HTMLInputElement>('#reversePrice')?.addEventListener('change', (event) => { reversePrice = Number((event.currentTarget as HTMLInputElement).value); render(); });
    document.querySelector<HTMLInputElement>('#reverseTarget')?.addEventListener('change', (event) => { reverseTarget = Number((event.currentTarget as HTMLInputElement).value); render(); });
    document.querySelector<HTMLButtonElement>('#previewApplyExecuted')?.addEventListener('click', () => { pendingApplicationScenarioId = scenario.id; render(); });
    document.querySelector<HTMLButtonElement>('#cancelApplyExecuted')?.addEventListener('click', () => { pendingApplicationScenarioId = null; render(); });
    document.querySelector<HTMLButtonElement>('#confirmApplyExecuted')?.addEventListener('click', () => { const holding = activeHolding(); const preview = previewExecutionApplication({ shares: holding.baseShares, averagePrice: holding.baseAverage }, scenario); if (!preview.valid || !preview.candidates.length) { notice = preview.error ?? 'There are no valid executed transactions to apply.'; pendingApplicationScenarioId = null; render(); return; } if (!window.confirm(`Apply ${preview.candidates.length} executed transaction(s) to the saved position?`)) return; holding.baseShares = preview.finalPosition.shares; holding.baseAverage = preview.finalPosition.averagePrice; const appliedAt = new Date().toISOString(); const ids = new Set(preview.candidates.map((transaction) => transaction.id)); scenario.transactions.forEach((transaction) => { if (ids.has(transaction.id)) transaction.appliedAt = appliedAt; }); touchScenario(scenario); pendingApplicationScenarioId = null; notice = `Applied ${preview.candidates.length} executed transaction(s) atomically.`; render(); });
  }

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
