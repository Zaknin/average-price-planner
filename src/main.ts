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
import { backupImportMessage } from './backup-errors';
import { displayScenarioName } from './scenario-display';
import type { DcaLadder, PlannerMessageCode, Scenario, ScenarioStatus, ScenarioTransaction, StressPrice } from './domain';
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
import { helpHash, helpRouteFromHash, renderHelp } from './help';
import { formatCurrency as formatLocalizedCurrency, formatDateTime, formatNumber as formatLocalizedNumber, formatPercent, getLocale, initializeLocale, parseLocalizedDecimal, plural, setLocale, t, type Locale } from './i18n';
import { APP_VERSION } from './version';

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

initializeLocale();

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
let inputDrafts: Record<string, string> = {};
let helpReturnContext: { sectionId: string; scrollY: number } | null = null;

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
  const numeric = typeof value === 'string' ? parseLocalizedDecimal(value) : Number(value);
  return numeric !== null && Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
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
    name: typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '',
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
    notice = t('storageUnavailable');
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
  return input ? parseLocalizedDecimal(input.value) ?? 0 : 0;
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
  inputDrafts = {};
  saveStore();
}

function captureInputDrafts(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[id], select[id]').forEach((element) => {
    if (element.type !== 'checkbox' && element.type !== 'file') inputDrafts[element.id] = element.value;
  });
}

function openHelp(topic = 'home', sectionId = ''): void {
  captureInputDrafts();
  helpReturnContext = { sectionId, scrollY: window.scrollY };
  const nextHash = helpHash(topic);
  if (window.location.hash === nextHash) render();
  else window.location.hash = nextHash;
}

function backToCalculator(): void {
  if (window.location.hash) window.location.hash = '';
  else render();
}

function contextualHelpLink(topic: string): string {
  return `<button type="button" class="context-help" data-help-open="${topic}" aria-label="${t('learnHowThisWorks')}">${t('learnHowThisWorks')}</button>`;
}

function activeFee(holding = activeHolding()): FeeSettings {
  return holding.action === 'buy' ? holding.buyFee : holding.sellFee;
}

function feeLabel(fee: FeeSettings, holding = activeHolding()): string {
  return fee.mode === 'percent' ? `${fee.value}%` : getLocale() === 'ru' ? `${t('fixedFee')}: ${formatCurrency(fee.value, holding)}` : `Fixed ${formatCurrency(fee.value, holding)}`;
}

function formatCurrency(value: number, holding = activeHolding()): string {
  return formatLocalizedCurrency(value, holding.currency || 'USD');
}

function formatQuantity(value: number, holding = activeHolding()): string {
  if (!Number.isFinite(value)) return '—';
  const step = holding.shareStep;
  const digits = step < 1
    ? Math.min(6, Math.max(3, String(step).split('.')[1]?.length ?? 3))
    : 2;
  return formatLocalizedNumber(value, digits);
}

function countPhrase(value: number, one: string, few: string, many: string, fractional = few): string {
  const formatted = formatLocalizedNumber(value);
  if (getLocale() !== 'ru') return formatted;
  return `${formatted} ${Number.isInteger(value) ? plural(value, one, few, many) : fractional}`;
}

function sharePhrase(value: number, context: 'standalone' | 'genitive' | 'complete' = 'standalone', holding = activeHolding()): string {
  if (getLocale() !== 'ru') {
    const formatted = formatQuantity(value, holding);
    return context === 'complete'
      ? `${formatted} ${plural(value, 'share', t('sharesSuffix'), t('sharesSuffix'))}`
      : formatted;
  }
  return context === 'genitive'
    ? countPhrase(value, 'акции', 'акций', 'акций', 'акции')
    : countPhrase(value, 'акция', 'акции', 'акций', 'акции');
}

function executedTradePhrase(value: number, grammaticalCase: 'accusative' | 'nominative' = 'nominative'): string {
  if (getLocale() !== 'ru') return `${formatLocalizedNumber(value)} executed transaction${value === 1 ? '' : 's'}`;
  return grammaticalCase === 'accusative'
    ? countPhrase(value, 'исполненную сделку', 'исполненные сделки', 'исполненных сделок', 'исполненные сделки')
    : countPhrase(value, 'исполненная сделка', 'исполненные сделки', 'исполненных сделок', 'исполненные сделки');
}

function executedTradeAgreement(value: number): string {
  if (getLocale() !== 'ru') return 'Applied';
  return Number.isInteger(value) ? plural(value, 'учтена', 'учтены', 'учтено') : 'учтено';
}

function percent(value: number, fractionDigits = 1): string {
  return formatPercent(value, fractionDigits);
}

function plannerMessage(code: PlannerMessageCode | null | undefined): string {
  const key = {
    invalidPosition: 'plannerInvalidPosition', invalidSellFee: 'plannerInvalidSellFee', invalidTarget: 'plannerInvalidTarget', invalidSaleQuantity: 'plannerInvalidSaleQuantity', invalidSalePrice: 'plannerInvalidSalePrice', unattainableTarget: 'plannerUnattainableTarget', requiredQuantityExceedsPosition: 'plannerRequiredQuantityExceedsPosition', executionApplyFailed: 'plannerExecutionApplyFailed', invalidLadderLevels: 'plannerInvalidLadderLevels', invalidLadderFee: 'plannerInvalidLadderFee', invalidLadderInvestment: 'plannerInvalidLadderInvestment', invalidLadderShares: 'plannerInvalidLadderShares', ladderFeeUncovered: 'plannerLadderFeeUncovered',
  } as const;
  return code ? t(key[code]) : t('invalidReverseSell');
}

function localeSelector(): string {
  const locale = getLocale();
  return `<div class="locale-control" role="group" aria-label="Language / Язык"><button type="button" data-locale="en" aria-label="English" aria-pressed="${locale === 'en'}" class="${locale === 'en' ? 'active' : ''}">EN</button><button type="button" data-locale="ru" aria-label="Русский" aria-pressed="${locale === 'ru'}" class="${locale === 'ru' ? 'active' : ''}">RU</button></div>`;
}

function changeLocale(locale: Locale): void {
  captureInputDrafts();
  setLocale(locale);
  render();
  document.querySelector<HTMLButtonElement>(`[data-locale="${locale}"]`)?.focus();
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
  const ticker = holding.ticker.trim() || `${t('positionLabel')} ${index + 1}`;
  return `${ticker} · ${sharePhrase(holding.baseShares, 'standalone', holding)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`}`;
}

function holdingSummary(holding: HoldingState): string {
  const ticker = escapeHtml(holding.ticker || t('unnamedPosition'));
  const position = validBasePosition(holding);
  const positionText = position
    ? `${sharePhrase(position.shares, 'standalone', holding)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`} · ${t('averageCost')} ${formatCurrency(position.averagePrice, holding)}`
    : t('addPositionDetails');
  return `
    <div class="holding-mobile-summary">
      <div class="holding-summary-copy">
        <span class="eyebrow">${t('activeHolding')}</span>
        <strong title="${ticker}">${ticker}</strong>
        <span>${positionText}</span>
        <span>${t('budget')} ${formatCurrency(holding.budget, holding)}</span>
      </div>
      <button
        id="toggleHoldingEditor"
        class="secondary-button holding-editor-toggle"
        type="button"
        aria-expanded="${holdingEditorExpanded}"
        aria-controls="holdingEditor"
      >${holdingEditorExpanded ? t('doneEditing') : t('editHolding')}</button>
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
    return `<div class="empty-state compact-empty">${t('enterPriceAndSharesResult')}</div>`;
  }

  const fee = activeFee(holding);
  if (fee.value < 0 || !Number.isFinite(fee.value)) {
    return `<div class="plain-summary warning-summary"><span>${t('feeInput')}</span><strong>${t('enterNonNegativeFee')}</strong></div>`;
  }

  if (holding.action === 'sell') {
    if (holding.transactionShares > position.shares) {
      return `
        <div class="plain-summary warning-summary">
          <span>${t('checkShareAmount')}</span>
          <strong>${t('onlySharesAvailable', { shares: sharePhrase(position.shares) })}</strong>
          <p>${t('reduceSale', { shares: sharePhrase(position.shares, 'genitive') })}</p>
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
    const gainOrLoss = result.realizedProfitLoss >= 0 ? t('estimatedGain') : t('estimatedLoss');
    return `
      <div class="plain-summary">
        <span>${t('quickAnswer')}</span>
        <strong>${t('sellingSummary', { shares: sharePhrase(result.shares, 'genitive'), price: formatCurrency(result.price), fee: formatCurrency(result.feeAmount), proceeds: formatCurrency(result.netAmount) })}</strong>
        <p>${t('averageStays', { average: result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : t('closed'), outcome: gainOrLoss, value: formatCurrency(Math.abs(result.realizedProfitLoss)) })}</p>
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
        <span>${t('quickAnswer')}</span>
        <strong>${t('buyingSummary', { shares: sharePhrase(analysis.quantity, 'genitive'), price: formatCurrency(holding.transactionPrice), fee: formatCurrency(analysis.feeAmount), total: formatCurrency(analysis.totalCost) })}</strong>
        <p>${t('averageMoves', { before, after, reduction: formatCurrency(analysis.reduction), percent: percent(analysis.reductionPercent) })}</p>
      </div>
    `;
  }

  if (analysis.newAverage > position.averagePrice) {
    return `
      <div class="plain-summary warning-summary">
        <span>${t('quickAnswer')}</span>
        <strong>${t('purchaseRaisesAverage', { before, after })}</strong>
        <p>${t('buyAboveAverage', { total: formatCurrency(analysis.totalCost) })}</p>
      </div>
    `;
  }

  return `
    <div class="plain-summary">
      <span>${t('quickAnswer')}</span>
      <strong>${t('purchaseUnchanged', { average: before })}</strong>
      <p>${t('totalCashRequired', { total: formatCurrency(analysis.totalCost) })}</p>
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
        <div><span>${t('grossSale')}</span><strong>${formatCurrency(result.grossAmount)}</strong></div>
        <div><span>${t('fee')}</span><strong>${formatCurrency(result.feeAmount)}</strong></div>
        <div><span>${t('netProceeds')}</span><strong>${formatCurrency(result.netAmount)}</strong></div>
        <div><span>${t('sharesLeft')}</span><strong>${formatQuantity(result.sharesAfter)}</strong></div>
        <div><span>${t('averageCost')}</span><strong>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : t('positionClosed')}</strong></div>
        <div><span>${t('estimatedRealizedProfitLoss')}</span><strong class="${pnlClass}">${formatCurrency(result.realizedProfitLoss)}</strong></div>
      </div>
      <p class="simple-note">${t('sellingDoesNotChangeAverage')} ${contextualHelpLink('reading-results')}</p>
    `;
  }

  const analysis = analyzePurchase(position, holding.transactionShares, holding.transactionPrice, fee);
  return `
    <div class="result-strip six">
      <div><span>${t('grossPurchase')}</span><strong>${formatCurrency(analysis.grossAmount)}</strong></div>
      <div><span>${t('fee')}</span><strong>${formatCurrency(analysis.feeAmount)}</strong></div>
      <div><span>${t('totalCash')}</span><strong>${formatCurrency(analysis.totalCost)}</strong></div>
      <div><span>${t('newShareCount')}</span><strong>${formatQuantity(position.shares + analysis.quantity)}</strong></div>
      <div><span>${t('newAverage')}</span><strong>${formatCurrency(analysis.newAverage)}</strong></div>
      <div><span>${t('averageChange')}</span><strong class="${analysis.reduction > 0 ? 'positive' : analysis.newAverage > position.averagePrice ? 'negative' : ''}">${analysis.reduction > 0 ? `−${formatCurrency(analysis.reduction)}` : formatCurrency(analysis.newAverage - position.averagePrice)}</strong></div>
    </div>
    <p class="simple-note result-help">${contextualHelpLink('reading-results')}</p>
  `;
}

function optimizerCards(position: Position, holding: HoldingState): string {
  const price = holding.transactionPrice;
  const fee = holding.buyFee;
  const step = isFinitePositive(holding.shareStep) ? holding.shareStep : 1;
  if (!isFinitePositive(price)) {
    return `<div class="empty-state">${t('enterBuyPrice')}</div>`;
  }

  if (price >= position.averagePrice) {
    return `<div class="warning"><strong>${t('noAverageDownEffect')}</strong> ${t('buyBelowAverage', { average: formatCurrency(position.averagePrice) })}</div>`;
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
        t('diminishingReference'),
        `${sharePhrase(floorPoint.quantity)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`}`,
        t('eachExtraShareEffect', { percent: percent(floorPoint.marginalEfficiencyRemaining * 100) }),
        t('optimizerFinancialSummary', { gross: formatCurrency(floorPoint.grossAmount), fee: formatCurrency(floorPoint.feeAmount), total: formatCurrency(floorPoint.totalCost), average: formatCurrency(floorPoint.newAverage) }),
      )}
      ${metricCard(
        t('halfwayToBuyPrice'),
        `${sharePhrase(halfPoint.quantity)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`}`,
        t('halfwayMove', { average: formatCurrency(position.averagePrice), price: formatCurrency(price) }),
        t('optimizerFinancialSummary', { gross: formatCurrency(halfPoint.grossAmount), fee: formatCurrency(halfPoint.feeAmount), total: formatCurrency(halfPoint.totalCost), average: formatCurrency(halfPoint.newAverage) }),
      )}
      ${budgetPoint && fullBudgetPoint
        ? metricCard(
        t('smallerBuySimilarBenefit'),
            `${sharePhrase(budgetPoint.quantity)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`}`,
            t('capturesBudgetBenefit', { percent: percent(holding.budgetBenefitTarget * 100, 0) }),
            t('keepUnspent', { gross: formatCurrency(budgetPoint.grossAmount), fee: formatCurrency(budgetPoint.feeAmount), total: formatCurrency(budgetPoint.totalCost), unspent: formatCurrency(fullBudgetPoint.totalCost - budgetPoint.totalCost) }),
          )
        : metricCard(
            t('fullBudgetComparison'),
            t('setBudget'),
            fee.mode === 'fixed' && fee.value >= holding.budget ? t('fixedFeeUsesBudget') : t('enterBudgetComparison'),
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
        <strong>${sharePhrase(item.quantity)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`}</strong>
        <span>${t('total')} ${formatCurrency(item.totalCost)}</span>
      </div>
      <dl>
        <div><dt>${t('gross')}</dt><dd>${formatCurrency(item.grossAmount)}</dd></div>
        <div><dt>${t('fee')}</dt><dd>${formatCurrency(item.feeAmount)} (${feeLabel(fee, holding)})</dd></div>
        <div><dt>${t('totalRequired')}</dt><dd>${formatCurrency(item.totalCost)}</dd></div>
        <div><dt>${t('newAverage')}</dt><dd>${formatCurrency(item.newAverage)}</dd></div>
        <div><dt>${t('averageLowered')}</dt><dd class="positive">${formatCurrency(item.reduction)} (${percent(item.reductionPercent)})</dd></div>
        <div><dt>${t('achievedReduction')}</dt><dd>${percent(item.theoreticalReductionCaptured * 100)}</dd></div>
        <div><dt>${t('effectOneMoreShare')}</dt><dd>${percent(item.marginalEfficiencyRemaining * 100)}</dd></div>
      </dl>
    </article>
  `).join('');

  return `
    <div class="table-wrap scenario-table">
      <table>
        <thead>
          <tr>
            <th>${t('shares')}</th>
            <th>${t('gross')}</th>
            <th>${t('fee')}</th>
            <th>${t('total')}</th>
            <th>${t('newAverage')}</th>
            <th>${t('averageFallsBy')}</th>
            <th>${t('availableReductionReached')}</th>
            <th>${t('effectOneMoreShare')}</th>
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
    <div class="scenario-cards" aria-label="${t('purchaseScenarioComparison')}">${scenarioCards}</div>
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
          <span class="eyebrow">${t('diminishingReturns')}</span>
          <h3>${t('largerBuysHelpLess')}</h3>
        </div>
        <span class="muted">${t('curveExplanation')}</span>
        <button
          id="toggleCurve"
          type="button"
          class="text-button curve-toggle"
          aria-expanded="${curveExpanded}"
          aria-controls="improvementCurve"
        >${curveExpanded ? t('hideImprovementCurve') : t('showImprovementCurve')}</button>
      </div>
      <div id="improvementCurve" class="curve-content ${curveExpanded ? 'is-expanded' : ''}">
      <svg class="curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="${t('averageDownBenefitCurve')}">
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${padY + plotH}" class="axis" />
        <line x1="${padX}" y1="${padY + plotH}" x2="${padX + plotW}" y2="${padY + plotH}" class="axis" />
        <line x1="${padX}" y1="${padY + plotH / 2}" x2="${padX + plotW}" y2="${padY + plotH / 2}" class="grid" />
        <polyline points="${points.join(' ')}" class="curve-line" />
        <circle cx="${markerX}" cy="${markerY}" r="6" class="curve-marker" />
        <text x="${Math.min(markerX + 10, width - 230)}" y="${Math.max(markerY - 10, 18)}" class="chart-label">${sharePhrase(markerQty)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`} · ${t('reductionReached', { percent: percent(marker.theoreticalReductionCaptured * 100) })}</text>
        <text x="8" y="${padY + 4}" class="chart-label">100%</text>
        <text x="16" y="${padY + plotH / 2 + 4}" class="chart-label">50%</text>
        <text x="25" y="${padY + plotH + 4}" class="chart-label">0%</text>
        <text x="${padX}" y="${height - 10}" class="chart-label">${t('zeroShares')}</text>
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
      <section id="market-snapshot" class="panel market-panel">
        <div class="section-heading compact"><div><span class="eyebrow">${t('currentPrice')}</span><h2>${t('positionSnapshot')}</h2></div>
          <div class="heading-actions">${contextualHelpLink('market-snapshot')}<button id="toggleMarketSnapshot" class="text-button" aria-expanded="${marketSnapshotExpanded}" aria-controls="marketSnapshot">${marketSnapshotExpanded ? t('hideDetails') : t('showSnapshot')}</button></div>
        </div>
        <div id="marketSnapshot" class="disclosure-content ${marketSnapshotExpanded ? 'is-expanded' : ''}">
          <div class="empty-state compact-empty">${t('currentPriceSnapshotNeeded')}</div>
        </div>
      </section>`;
  }
  const netTone = snapshot.netUnrealizedProfitLoss >= 0 ? 'positive' : 'negative';
  return `
    <section id="market-snapshot" class="panel market-panel">
      <div class="section-heading compact"><div><span class="eyebrow">${t('currentPrice')}</span><h2>${t('positionSnapshot')}</h2></div>
        <div class="heading-actions">${contextualHelpLink('market-snapshot')}<button id="toggleMarketSnapshot" class="text-button" aria-expanded="${marketSnapshotExpanded}" aria-controls="marketSnapshot">${marketSnapshotExpanded ? t('hideDetails') : t('showSnapshot')}</button></div>
      </div>
      <div id="marketSnapshot" class="disclosure-content ${marketSnapshotExpanded ? 'is-expanded' : ''}">
        <div class="snapshot-grid">
          ${metricCard(t('currentValue'), formatCurrency(snapshot.marketValue, holding), `${sharePhrase(position!.shares, 'standalone', holding)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`} @ ${formatCurrency(holding.currentMarketPrice, holding)}`)}
          ${metricCard(t('totalCostBasis'), formatCurrency(snapshot.basis, holding), `${t('averageCost')} ${formatCurrency(position!.averagePrice, holding)}`)}
          ${metricCard(t('grossProfitLoss'), formatCurrency(snapshot.grossUnrealizedProfitLoss, holding), t('grossReturn', { percent: percent(snapshot.grossReturnPercent) }), '', snapshot.grossUnrealizedProfitLoss >= 0 ? 'positive' : 'negative')}
          ${metricCard(t('afterFees'), formatCurrency(snapshot.netUnrealizedProfitLoss, holding), t('liquidationFee', { fee: formatCurrency(snapshot.estimatedSellFee, holding), net: formatCurrency(snapshot.netLiquidationValue, holding) }), '', netTone)}
          ${metricCard(t('breakEvenPrice'), formatCurrency(snapshot.breakEvenPrice, holding), snapshot.movementToBreakEvenPercent > 0 ? t('riseRequired', { percent: percent(snapshot.movementToBreakEvenPercent) }) : snapshot.aboveBreakEvenPercent > 0 ? t('aboveBreakEven', { percent: percent(snapshot.aboveBreakEvenPercent) }) : t('atBreakEven'))}
        </div>
        ${planned && holding.transactions.length ? `
          <div class="after-plan-snapshot">
            <span class="eyebrow">${t('afterPlannedTransactions')}</span>
            <div class="result-strip six">
              <div><span>${t('resultingShares')}</span><strong>${formatQuantity(planned.finalPosition.shares, holding)}</strong></div>
              <div><span>${t('resultingAverage')}</span><strong>${planned.finalPosition.shares > 0 ? formatCurrency(planned.finalPosition.averagePrice, holding) : t('closed')}</strong></div>
              <div><span>${t('costBasis')}</span><strong>${formatCurrency(planned.resultingBasis, holding)}</strong></div>
              <div><span>${t('unrealizedProfitLoss')}</span><strong class="${planned.unrealizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(planned.unrealizedProfitLoss, holding)}</strong></div>
              <div><span>${t('realizedProfitLoss')}</span><strong class="${planned.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(planned.realizedProfitLoss, holding)}</strong></div>
              <div><span>${t('planCashFlowFees')}</span><strong>${formatCurrency(planned.netPlannedCashFlow, holding)} / ${formatCurrency(planned.totalFees, holding)}</strong></div>
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
      <div><span>${t('sharesNeeded')}</span><strong>${formatQuantity(averageResult.requiredShares, holding)}</strong></div>
      <div><span>${t('grossPurchase')}</span><strong>${formatCurrency(averageResult.grossAmount, holding)}</strong></div>
      <div><span>${t('fee')}</span><strong>${formatCurrency(averageResult.feeAmount, holding)}</strong></div>
      <div><span>${t('totalCashNeeded')}</span><strong>${formatCurrency(averageResult.totalAmount, holding)}</strong></div>
      <div><span>${t('actualAverage')}</span><strong>${formatCurrency(averageResult.resultingPosition.averagePrice, holding)}</strong></div>
      <div><span>${t('averageLowered')}</span><strong class="positive">${formatCurrency(averageResult.averageLowered, holding)}</strong></div>
    </div>
    <p class="simple-note">${t('requestedTarget', { target: formatCurrency(holding.targetAverage, holding) })} ${averageResult.targetReached ? t('roundedTargetReached') : t('roundedTargetChanged')}${averageResult.exceedsBudget ? ` ${t('budgetExcess', { amount: formatCurrency(averageResult.totalAmount - holding.budget, holding) })}` : ''}</p>`
    : `<div class="plain-summary warning-summary"><span>${t('targetResult')}</span><strong>${t('targetNotAchievable')}</strong></div>`;
  const sellBody = sellResult.valid ? `
    <div class="result-strip six">
      <div><span>${t('sharesSold')}</span><strong>${formatQuantity(sellResult.shares, holding)}</strong></div>
      <div><span>${t('costBasisSold')}</span><strong>${formatCurrency(sellResult.costBasisSold, holding)}</strong></div>
      <div><span>${t('breakEvenTargetPrice')}</span><strong>${formatCurrency(sellResult.requiredPrice, holding)}</strong></div>
      <div><span>${t('grossProceeds')}</span><strong>${formatCurrency(sellResult.grossAmount, holding)}</strong></div>
      <div><span>${t('feeNetProceeds')}</span><strong>${formatCurrency(sellResult.feeAmount, holding)} / ${formatCurrency(sellResult.netAmount, holding)}</strong></div>
      <div><span>${t('profitReturn')}</span><strong class="${sellResult.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(sellResult.realizedProfitLoss, holding)} / ${percent(sellResult.returnPercent)}</strong></div>
    </div>
    <p class="simple-note">${t('remainingPosition', { shares: sharePhrase(sellResult.remainingPosition.shares, 'standalone', holding), average: sellResult.remainingPosition.shares ? t('averageAt', { average: formatCurrency(sellResult.remainingPosition.averagePrice, holding) }) : t('closedSuffix') })}</p>`
    : `<div class="plain-summary warning-summary"><span>${t('saleTarget')}</span><strong>${t('enterValidSaleDetails')}</strong></div>`;
  return `
    <section id="target-tools" class="panel targets-panel">
      <div class="section-heading"><div><span class="eyebrow">${t('targets')}</span><h2>${t('planAverageOrExit')}</h2></div>
        <div class="heading-actions">${contextualHelpLink('target-tools')}<button id="toggleTargets" class="text-button" aria-expanded="${targetsExpanded}" aria-controls="targetsContent">${targetsExpanded ? t('hideTargets') : t('showTargets')}</button></div>
      </div>
      <div id="targetsContent" class="disclosure-content ${targetsExpanded ? 'is-expanded' : ''}">
        <div class="segmented-control target-tabs" aria-label="${t('targetCalculator')}"><button data-target-tab="average" class="${targetTab === 'average' ? 'active' : ''}">${t('targetAverage')}</button><button data-target-tab="sell" class="${targetTab === 'sell' ? 'active' : ''}">${t('breakEvenProfit')}</button></div>
        ${targetTab === 'average' ? `
          <div class="target-form field-grid three">
            ${field('targetAverage', t('targetAverage'), holding.targetAverage, 'number', '45')}
            ${field('targetBuyPrice', t('buyPricePerShare'), holding.targetBuyPrice, 'number', '40')}
            <label class="check-field"><input id="targetRespectBudget" type="checkbox" ${holding.targetRespectBudget ? 'checked' : ''} /> ${t('respectMaximumBudget')}</label>
          </div>${averageBody}` : `
          <div class="target-form field-grid three">
            ${field('targetSellShares', t('sharesToSell'), sellShares, 'number', '100')}
            <div class="segmented-control compact-target-mode" aria-label="${t('saleTargetMode')}"><button data-target-sell-mode="breakEven" class="${holding.targetSellMode === 'breakEven' ? 'active' : ''}">${t('breakEven')}</button><button data-target-sell-mode="profit" class="${holding.targetSellMode === 'profit' ? 'active' : ''}">${t('profit')}</button><button data-target-sell-mode="return" class="${holding.targetSellMode === 'return' ? 'active' : ''}">${t('returnPercent')}</button></div>
            ${holding.targetSellMode === 'breakEven' ? `<div class="target-placeholder">${t('usesActiveSellFee')}</div>` : field('targetSellValue', holding.targetSellMode === 'profit' ? t('profitTarget') : t('targetReturnPercent'), holding.targetSellValue, 'number', holding.targetSellMode === 'profit' ? '500' : '10')}
          </div>${sellBody}`}
      </div>
    </section>`;
}

function dataManagementPanel(holding: HoldingState): string {
  const preview = pendingImport ? (() => { const scenarioTransactions = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.length : 0), 0); const executed = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.filter((transaction) => transaction && typeof transaction === 'object' && (transaction as { status?: unknown }).status === 'executed').length : 0), 0); const applied = pendingImport.scenarios.reduce((total, scenario) => total + (Array.isArray(scenario.transactions) ? scenario.transactions.filter((transaction) => transaction && typeof transaction === 'object' && Boolean((transaction as { appliedAt?: unknown }).appliedAt)).length : 0), 0); const planTransactions = pendingImport.positions.reduce((total, position) => total + (Array.isArray(position.transactions) ? position.transactions.length : 0), 0); const phrase = (count: number, one: string, few: string, many: string, fallback: string): string => getLocale() === 'ru' ? countPhrase(count, one, few, many) : `${formatLocalizedNumber(count)} ${fallback}`; return `<div class="import-preview"><strong>${t('backupPreview')}</strong><span>${phrase(pendingImport.positions.length, 'сохранённая позиция', 'сохранённые позиции', 'сохранённых позиций', t('positions'))} · ${phrase(planTransactions, 'операция плана', 'операции плана', 'операций плана', t('planTransactions'))} · ${phrase(pendingImport.scenarios.length, 'сценарий', 'сценария', 'сценариев', t('savedScenarios'))}</span><span>${phrase(scenarioTransactions, 'сделка сценария', 'сделки сценария', 'сделок сценария', t('scenarioTransactionsCount'))} · ${phrase(executed, 'исполненная сделка', 'исполненные сделки', 'исполненных сделок', t('executed'))} · ${phrase(applied, 'сделка, учтённая в позиции', 'сделки, учтённые в позиции', 'сделок, учтённых в позиции', t('applied'))}</span><span>${t('exportedAt', { date: formatDateTime(pendingImport.exportedAt) })} · ${t('backupSchema', { version: String(pendingImport.backupSchemaVersion) })}</span><div class="button-row"><button id="applyMergeImport" class="secondary-button">${t('mergeCurrentData')}</button><button id="applyReplaceImport" class="text-button danger-text">${t('replaceCurrentData')}</button></div></div>`; })() : '';
  return `
    <section id="data-management" class="panel data-panel">
      <div class="section-heading"><div><span class="eyebrow">${t('dataManagement')}</span><h2>${t('backupRestoreExport')}</h2></div>${contextualHelpLink('backup-export')}</div>
      <p class="helper-text">${t('browserDataNotice')}</p>
      <div class="button-row data-actions"><button id="exportAll" class="secondary-button">${t('exportAllPositions')}</button><button id="exportActive" class="secondary-button">${t('exportActivePosition')}</button><button id="exportCsv" class="secondary-button" ${holding.transactions.length ? '' : 'disabled'}>${t('exportPlanCsv')}</button><label class="secondary-button file-button">${t('importJson')}<input id="importJson" type="file" accept="application/json,.json" hidden /></label></div>
      ${preview}
    </section>`;
}

function scenarioForActiveHolding(): Scenario[] {
  return store.scenarios
    .filter((scenario) => scenario.holdingId === activeHolding().id)
    .map((scenario) => ({ ...scenario, name: displayScenarioName(scenario.name) }));
}

function loadedScenario(): Scenario | null {
  return store.scenarios.find((scenario) => scenario.id === loadedScenarioId) ?? null;
}

function createScenarioFromHolding(name = ''): Scenario | null {
  const holding = activeHolding();
  const base = validBasePosition(holding);
  if (!base) {
    notice = t('validPositionBeforeScenario');
    return null;
  }
  const timestamp = new Date().toISOString();
  const scenario: Scenario = {
    id: createId(),
    holdingId: holding.id,
    name: name || t('scenarioDefaultName', { position: holding.ticker || t('positionLabel') }),
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
      <div><span>${t('finalShares')}</span><strong>${formatQuantity(summary.finalPosition.shares, holding)}</strong></div>
      <div><span>${t('finalAverage')}</span><strong>${summary.finalPosition.shares ? formatCurrency(summary.finalPosition.averagePrice, holding) : t('closed')}</strong></div>
      <div><span>${t('totalFees')}</span><strong>${formatCurrency(summary.totalFees, holding)}</strong></div>
      <div><span>${t('totalProfitLoss')}</span><strong class="${summary.realizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.realizedProfitLoss, holding)}</strong></div>
      <div><span>${t('unrealizedProfitLoss')}</span><strong class="${summary.unrealizedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.unrealizedProfitLoss, holding)}</strong></div>
      <div><span>${t('breakEven')}</span><strong>${formatCurrency(summary.breakEvenPrice, holding)}</strong></div>
    </div>`;
}

function ladderPanel(scenario: Scenario, holding: HoldingState): string {
  const ladder = scenario.ladder ?? defaultLadder();
  const projection = ladder.levels.length ? projectLadder(ladder, scenario.basePosition, scenario.marketPrice) : [];
  const activeFee = activeLadderFee(ladder);
  const rows = projection.map((row, index) => `
    <article class="ladder-card">
      <div class="scenario-card-heading"><strong>${t('level')} ${index + 1}</strong><span>${t('total')} ${formatCurrency(row.totalAmount, holding)}</span></div>
      <div class="ladder-edit-grid">
        <label class="field"><span>${t('price')}</span><input data-ladder-price="${row.level.id}" type="number" value="${row.level.price}" min="0" step="any" inputmode="decimal" /></label>
        <label class="field"><span>${t('shares')}</span><input data-ladder-shares="${row.level.id}" type="number" value="${row.level.shares}" min="0" step="any" inputmode="decimal" /></label>
      </div>
      <dl><div><dt>${t('grossFee')}</dt><dd>${formatCurrency(row.grossAmount, holding)} / ${formatCurrency(row.feeAmount, holding)}</dd></div><div><dt>${t('cumulativeShares')}</dt><dd>${formatQuantity(row.cumulativePosition.shares, holding)}</dd></div><div><dt>${t('cumulativeBasis')}</dt><dd>${formatCurrency(row.cumulativePosition.shares * row.cumulativePosition.averagePrice, holding)}</dd></div><div><dt>${t('cumulativeAverage')}</dt><dd>${formatCurrency(row.cumulativePosition.averagePrice, holding)}</dd></div></dl>
      <div class="button-row"><button class="text-button" data-ladder-up="${row.level.id}" ${index === 0 ? 'disabled' : ''}>${t('moveUp')}</button><button class="text-button" data-ladder-down="${row.level.id}" ${index === projection.length - 1 ? 'disabled' : ''}>${t('moveDown')}</button><button class="text-button" data-ladder-duplicate="${row.level.id}">${t('duplicate')}</button><button class="text-button danger-text" data-ladder-remove="${row.level.id}">${t('remove')}</button></div>
    </article>`).join('');
  return `
    <section id="dca-ladder" class="subpanel ladder-panel">
      <div class="section-heading compact"><div><span class="eyebrow">${t('dcaLadder')}</span><h3>${t('buildStagedBuys')}</h3></div><div class="heading-actions">${contextualHelpLink('dca-ladder')}<button id="exportLadderCsv" class="text-button" ${projection.length ? '' : 'disabled'}>${t('exportLadderCsv')}</button></div></div>
      <div class="field-grid three">
        ${field('ladderLevels', t('levels'), ladder.levelCount, 'number', '4', '1')}
        ${field('ladderStart', t('startPrice'), ladder.startPrice, 'number', '40')}
        ${field('ladderEnd', t('endPrice'), ladder.endPrice, 'number', '30')}
        ${field('ladderInvestment', ladder.distribution === 'equalShares' ? t('totalShares') : t('allInCash'), ladder.distribution === 'equalShares' ? ladder.totalShares : ladder.totalInvestment, 'number', '1000')}
        ${field('ladderShareStep', t('sharePrecision'), ladder.sharePrecision, 'number', '1')}
        ${field('ladderPricePrecision', t('pricePrecision'), ladder.pricePrecision, 'number', '2', '1')}
      </div>
      <div class="segmented-control scenario-segment" aria-label="${t('dcaDistribution')}"><button data-ladder-distribution="equalCash" class="${ladder.distribution === 'equalCash' ? 'active' : ''}">${t('equalCash')}</button><button data-ladder-distribution="equalShares" class="${ladder.distribution === 'equalShares' ? 'active' : ''}">${t('equalShares')}</button><button data-ladder-distribution="custom" class="${ladder.distribution === 'custom' ? 'active' : ''}">${t('custom')}</button></div>
      <div class="segmented-control scenario-segment" aria-label="${t('dcaSpacing')}"><button data-ladder-spacing="linear" class="${ladder.spacing === 'linear' ? 'active' : ''}">${t('linearPrices')}</button><button data-ladder-spacing="percent" class="${ladder.spacing === 'percent' ? 'active' : ''}">${t('equalPercent')}</button></div>
      <div class="fee-controls compact-fee" aria-label="${t('ladderFee')}"><span class="fee-controls-label">${t('ladderFee')}</span><div class="segmented-control fee-mode-control"><button data-ladder-fee-mode="percent" class="${ladder.feeMode === 'percent' ? 'active' : ''}">${t('percent')}</button><button data-ladder-fee-mode="fixed" class="${ladder.feeMode === 'fixed' ? 'active' : ''}">${t('fixed')}</button></div>${field('ladderFee', ladder.feeMode === 'fixed' ? t('fixedFee') : t('feePercent'), activeFee.value, 'number', '0')}</div>
      <label class="check-field"><input id="ladderIncludeCurrent" type="checkbox" ${ladder.includeCurrentPosition ? 'checked' : ''} /> ${t('includeCurrentInAverage')}</label>
      <div class="button-row"><button id="generateLadder" class="secondary-button">${t('generateLadder')}</button><button id="addLadderLevel" class="secondary-button">${t('addLevel')}</button><button id="clearLadder" class="text-button">${t('clear')}</button></div>
      ${projection.length ? `<div class="ladder-cards">${rows}</div>` : `<div class="empty-state compact-empty">${t('ladderEmpty')}</div>`}
    </section>`;
}

function scenarioTransactionsPanel(scenario: Scenario, holding: HoldingState): string {
  if (!scenario.transactions.length) return `<div class="empty-state compact-empty">${t('noScenarioRows')}</div>`;
  return `<div class="scenario-transaction-cards">${scenario.transactions.map((transaction) => `
    <article class="transaction-card">
      <div class="transaction-card-heading"><span class="action-tag ${transaction.type}">${transaction.type === 'buy' ? t('buy') : t('sell')}</span><span class="status-tag ${transaction.status}">${t(transaction.status)}</span></div>
      <dl><div><dt>${t('planned')}</dt><dd>${sharePhrase(transaction.shares, 'standalone', holding)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`} @ ${formatCurrency(transaction.price, holding)}</dd></div><div><dt>${t('fee')}</dt><dd>${feeLabel({ mode: transaction.feeMode ?? 'percent', value: transaction.feeValue ?? 0 }, holding)}</dd></div><div><dt>${t('executionDate')}</dt><dd>${transaction.executionDate ? formatDateTime(transaction.executionDate) : t('notRecorded')}</dd></div><div><dt>${t('applied')}</dt><dd>${transaction.appliedAt ? t('applied') : t('notApplied')}</dd></div></dl>
      <div class="ladder-edit-grid"><label class="field"><span>${t('actualPrice')}</span><input data-execution-price="${transaction.id}" type="number" min="0" step="any" value="${transaction.executionPrice ?? transaction.price}" /></label><label class="field"><span>${t('actualShares')}</span><input data-execution-shares="${transaction.id}" type="number" min="0" step="any" value="${transaction.executionShares ?? transaction.shares}" /></label><label class="field"><span>${t('actualFee')}</span><input data-actual-fee="${transaction.id}" type="number" min="0" step="any" value="${transaction.actualFee ?? ''}" placeholder="${t('usePlanned')}" /></label><label class="field"><span>${t('executionDate')}</span><input data-execution-date="${transaction.id}" type="datetime-local" value="${transaction.executionDate ?? ''}" /></label></div>
      <label class="field"><span>${t('note')}</span><input data-transaction-note="${transaction.id}" type="text" value="${escapeHtml(transaction.note ?? '')}" placeholder="${t('optionalNote')}" /></label>
      <label class="field"><span>${t('brokerAccount')}</span><input data-broker-label="${transaction.id}" type="text" value="${escapeHtml(transaction.brokerLabel ?? '')}" placeholder="${t('optionalLabel')}" /></label>
      <div class="button-row"><button class="text-button" data-transaction-status="${transaction.id}" data-status="planned">${t('planned')}</button><button class="text-button" data-transaction-status="${transaction.id}" data-status="executed">${t('executed')}</button><button class="text-button danger-text" data-transaction-status="${transaction.id}" data-status="cancelled">${t('cancelled')}</button></div>
    </article>`).join('')}</div>`;
}

function scenarioPlannerPanel(holding: HoldingState): string {
  const scenario = loadedScenario();
  const content = scenario ? `
    <div class="field-grid two">${field('scenarioName', t('scenarioName'), scenario.name, 'text', t('scenarioName'))}<label class="field"><span>${t('status')}</span><select id="scenarioStatus">${(['draft', 'active', 'completed', 'archived'] as ScenarioStatus[]).map((status) => `<option value="${status}" ${scenario.status === status ? 'selected' : ''}>${t(status)}</option>`).join('')}</select></label>${field('scenarioMarketPrice', t('scenarioMarketPrice'), scenario.marketPrice, 'number', '50')}<label class="field"><span>${t('scenarioNote')}</span><input id="scenarioNote" type="text" value="${escapeHtml(scenario.note)}" placeholder="${t('optionalNote')}" /></label></div>
    ${scenarioSummaryPanel(scenario, holding)}
    ${ladderPanel(scenario, holding)}
    <section class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">${t('scenarioTransactions')}</span><h3>${t('plannedExecutedCancelled')}</h3></div><button id="exportScenarioCsv" class="text-button">${t('exportScenarioCsv')}</button></div>${scenarioTransactionsPanel(scenario, holding)}</section>
    ${stressPanel(scenario, holding)}
    ${reverseSellPanel(scenario, holding)}
    ${executionApplicationPanel(scenario, holding)}` : `<div class="empty-state">${t('createOrLoadScenario')}</div>`;
  return `
    <section id="scenario-planner" class="panel scenario-planner-panel">
      <div class="section-heading"><div><span class="eyebrow">${t('scenarioPlanner')}</span><h2>${t('buildBeforeChanging')}</h2></div><div class="heading-actions">${contextualHelpLink('scenario-planner')}<button id="toggleScenarioPlanner" class="text-button" aria-expanded="${scenarioPanelExpanded}" aria-controls="scenarioPlannerContent">${scenarioPanelExpanded ? t('hidePlanner') : t('showPlanner')}</button></div></div>
      <div id="scenarioPlannerContent" class="disclosure-content ${scenarioPanelExpanded ? 'is-expanded' : ''}">${content}</div>
    </section>`;
}

function stressPanel(scenario: Scenario, holding: HoldingState): string {
  const summary = summarizeScenario(scenario, holding.sellFee);
  const baseMarket = scenario.marketPrice || holding.currentMarketPrice;
  const entries = stressPrices(scenario.stressPrices, baseMarket).filter((item) => Number.isFinite(item.price) && item.price >= 0).sort((a, b) => stressAscending ? a.price - b.price : b.price - a.price);
  return `
    <section id="stress-tests" class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">${t('stressTests')}</span><h3>${t('priceOutcomes')}</h3></div><div class="heading-actions">${contextualHelpLink('stress-tests')}<button id="toggleStressSort" class="text-button">${stressAscending ? t('sortDescending') : t('sortAscending')}</button></div></div>
      <div class="button-row"><button id="resetStressPrices" class="text-button">${t('resetDefaults')}</button><button id="addStressPrice" class="text-button">${t('addCustomPrice')}</button></div>
      <div class="stress-cards">${entries.map(({ entry, price }) => {
        const marketValue = summary.finalPosition.shares * price;
        const unrealized = marketValue - summary.finalCostBasis - (summary.finalPosition.shares ? feeAmountForScenario(marketValue, holding.sellFee) : 0);
        const total = summary.realizedProfitLoss + unrealized;
        return `<article class="scenario-card"><div class="scenario-card-heading"><strong>${formatCurrency(price, holding)}</strong><button class="icon-button" data-remove-stress="${entry.id}" aria-label="${t('removeStressPrice')}">×</button></div><dl><div><dt>${t('finalValue')}</dt><dd>${formatCurrency(marketValue, holding)}</dd></div><div><dt>${t('unrealizedProfitLoss')}</dt><dd class="${unrealized >= 0 ? 'positive' : 'negative'}">${formatCurrency(unrealized, holding)}</dd></div><div><dt>${t('totalProfitLoss')}</dt><dd>${formatCurrency(summary.realizedProfitLoss, holding)}</dd></div><div><dt>${t('totalProjectedProfitLoss')}</dt><dd class="${total >= 0 ? 'positive' : 'negative'}">${formatCurrency(total, holding)}</dd></div></dl></article>`;
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
    <section id="reverse-sell" class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">${t('reverseSellPlanner')}</span><h3>${t('planExit')}</h3></div><div class="heading-actions">${contextualHelpLink('reverse-sell')}<button id="toggleReverseSell" class="text-button" aria-expanded="${reverseSellExpanded}">${reverseSellExpanded ? t('hide') : t('show')}</button></div></div>
    <div class="disclosure-content ${reverseSellExpanded ? 'is-expanded' : ''}"><div class="segmented-control scenario-segment"><button data-reverse-direction="price" class="${reverseDirection === 'price' ? 'active' : ''}">${t('solvePrice')}</button><button data-reverse-direction="shares" class="${reverseDirection === 'shares' ? 'active' : ''}">${t('solveShares')}</button></div><div class="segmented-control scenario-segment"><button data-reverse-mode="profit" class="${reverseMode === 'profit' ? 'active' : ''}">${t('profit')}</button><button data-reverse-mode="return" class="${reverseMode === 'return' ? 'active' : ''}">${t('returnPercent')}</button><button data-reverse-mode="netProceeds" class="${reverseMode === 'netProceeds' ? 'active' : ''}">${t('targetNetProceeds')}</button><button data-reverse-mode="breakEven" class="${reverseMode === 'breakEven' ? 'active' : ''}">${t('breakEven')}</button></div><div class="field-grid three">${field('reverseShares', t('sharesToSell'), shares, 'number', '100')}${field('reversePrice', t('salePrice'), price, 'number', '60')}${field('reverseTarget', reverseMode === 'return' ? t('returnPercent') : reverseMode === 'netProceeds' ? t('targetNetProceeds') : t('profitTarget'), reverseTarget, 'number', '500')}</div>${result.valid ? `<div class="result-strip six"><div><span>${t('requiredPrice')}</span><strong>${formatCurrency(result.requiredPrice, holding)}</strong></div><div><span>${t('quantity')}</span><strong>${formatQuantity(result.requiredShares, holding)}</strong></div><div><span>${t('grossFee')}</span><strong>${formatCurrency(result.grossAmount, holding)} / ${formatCurrency(result.feeAmount, holding)}</strong></div><div><span>${t('netProceeds')}</span><strong>${formatCurrency(result.netAmount, holding)}</strong></div><div><span>${t('totalProfitLoss')}</span><strong>${formatCurrency(result.realizedProfitLoss, holding)}</strong></div><div><span>${t('remainingShares')}</span><strong>${formatQuantity(result.remainingPosition.shares, holding)}</strong></div></div>` : `<div class="plain-summary warning-summary"><strong>${plannerMessage(result.errorCode)}</strong></div>`}</div></section>`;
}

function executionApplicationPanel(scenario: Scenario, holding: HoldingState): string {
  const preview = previewExecutionApplication({ shares: holding.baseShares, averagePrice: holding.baseAverage }, scenario);
  const isPending = pendingApplicationScenarioId === scenario.id;
  return `<section id="executed-transactions" class="subpanel"><div class="section-heading compact"><div><span class="eyebrow">${t('applyExecuted')}</span><h3>${t('reviewBeforeUpdate')}</h3></div><div class="heading-actions">${contextualHelpLink('executed-transactions')}<button id="previewApplyExecuted" class="secondary-button" ${preview.candidates.length ? '' : 'disabled'}>${t('reviewExecutedTrades')}</button></div></div>${isPending ? `<div class="import-preview"><strong>${t('reviewBeforeApplying')}</strong><span>${t('rowsToApply')}: ${formatLocalizedNumber(preview.candidates.length)}. ${t('skippedRows')}: ${formatLocalizedNumber(preview.skipped.length)}.</span>${preview.valid ? `<span>${sharePhrase(preview.finalPosition.shares, 'standalone', holding)}${getLocale() === 'ru' ? '' : ` ${t('sharesSuffix')}`} · ${formatCurrency(preview.finalPosition.averagePrice, holding)} · ${t('totalFees')} ${formatCurrency(preview.totalFees, holding)} · ${t('totalProfitLoss')} ${formatCurrency(preview.realizedProfitLoss, holding)}</span><div class="button-row"><button id="confirmApplyExecuted" class="secondary-button">${t('confirmPositionUpdate')}</button><button id="cancelApplyExecuted" class="text-button">${t('cancel')}</button></div>` : `<span class="negative">${plannerMessage(preview.errorCode)}</span>`}</div>` : `<p class="helper-text">${t('eligibleExecutedHelp')}</p>`}</section>`;
}

function savedScenariosPanel(holding: HoldingState): string {
  const scenarios = scenarioForActiveHolding();
  return `<section id="saved-scenarios" class="panel"><div class="section-heading"><div><span class="eyebrow">${t('savedScenarios')}</span><h2>${t('comparePlansSafely')}</h2></div><div class="heading-actions">${contextualHelpLink('saved-scenarios')}<div class="button-row"><button id="newScenario" class="secondary-button">${t('newScenario')}</button><button id="savePlanScenario" class="secondary-button">${t('saveCurrentPlan')}</button></div></div></div>${scenarios.length ? `<div class="saved-scenario-cards">${scenarios.map((scenario) => { const summary = summarizeScenario(scenario, holding.sellFee); return `<article class="scenario-card ${scenario.status === 'archived' ? 'archived' : ''}"><div class="scenario-card-heading"><strong>${escapeHtml(scenario.name)}</strong><span class="status-tag ${scenario.status}">${t(scenario.status)}</span></div><p>${escapeHtml(scenario.note || t('noNote'))}</p><dl><div><dt>${t('finalPosition')}</dt><dd>${formatQuantity(summary.finalPosition.shares, holding)} @ ${formatCurrency(summary.finalPosition.averagePrice, holding)}</dd></div><div><dt>${t('totalProfitLoss')}</dt><dd class="${summary.totalProjectedProfitLoss >= 0 ? 'positive' : 'negative'}">${formatCurrency(summary.totalProjectedProfitLoss, holding)}</dd></div></dl><div class="button-row"><button class="text-button" data-load-scenario="${scenario.id}">${t('load')}</button><button class="text-button" data-duplicate-scenario="${scenario.id}">${t('duplicate')}</button><button class="text-button" data-scenario-archive="${scenario.id}">${scenario.status === 'archived' ? t('restore') : t('archive')}</button><button class="text-button danger-text" data-delete-scenario="${scenario.id}">${t('delete')}</button><label class="compare-check"><input type="checkbox" data-compare-scenario="${scenario.id}" ${store.comparisonScenarioIds.includes(scenario.id) ? 'checked' : ''} ${scenario.status === 'archived' ? 'disabled' : ''} /> ${t('compare')}</label></div></article>`; }).join('')}</div>` : `<div class="empty-state">${t('noSavedScenarios')}</div>`}</section>`;
}

function comparisonPanel(holding: HoldingState): string {
  const scenarios = store.scenarios
    .filter((scenario) => store.comparisonScenarioIds.includes(scenario.id) && scenario.status !== 'archived')
    .map((scenario) => ({ ...scenario, name: displayScenarioName(scenario.name) }));
  return `<section id="scenario-comparison" class="panel"><div class="section-heading"><div><span class="eyebrow">${t('compare')}</span><h2>${t('upToFourScenarios')}</h2></div><div class="heading-actions">${contextualHelpLink('scenario-comparison')}<button id="toggleComparison" class="text-button" aria-expanded="${comparisonExpanded}">${comparisonExpanded ? t('hideComparison') : t('showComparison')}</button></div></div><div class="disclosure-content ${comparisonExpanded ? 'is-expanded' : ''}">${scenarios.length ? `<div class="comparison-cards">${scenarios.map((scenario) => { const summary = summarizeScenario(scenario, holding.sellFee); return `<article class="scenario-card"><div class="scenario-card-heading"><strong>${escapeHtml(scenario.name)}</strong><button class="icon-button" data-remove-comparison="${scenario.id}" aria-label="${t('removeFromComparison')}">×</button></div><dl><div><dt>${t('startingPosition')}</dt><dd>${formatQuantity(summary.startingShares, holding)} @ ${formatCurrency(summary.startingAverage, holding)}</dd></div><div><dt>${t('plannedBuysSells')}</dt><dd>${formatQuantity(summary.plannedBuyShares, holding)} / ${formatQuantity(summary.plannedSellShares, holding)}</dd></div><div><dt>${t('totalFees')}</dt><dd>${formatCurrency(summary.totalFees, holding)}</dd></div><div><dt>${t('finalQuantity')}</dt><dd>${formatQuantity(summary.finalPosition.shares, holding)}</dd></div><div><dt>${t('finalAverage')}</dt><dd>${formatCurrency(summary.finalPosition.averagePrice, holding)}</dd></div><div><dt>${t('marketValue')}</dt><dd>${formatCurrency(summary.marketValue, holding)}</dd></div><div><dt>${t('totalProfitLoss')}</dt><dd>${formatCurrency(summary.realizedProfitLoss, holding)}</dd></div><div><dt>${t('unrealizedProfitLoss')}</dt><dd>${formatCurrency(summary.unrealizedProfitLoss, holding)}</dd></div><div><dt>${t('breakEven')}</dt><dd>${formatCurrency(summary.breakEvenPrice, holding)}</dd></div><div><dt>${t('maximumCapitalRequirement')}</dt><dd>${formatCurrency(summary.maximumCapitalRequirement, holding)}</dd></div></dl></article>`; }).join('')}</div><button id="clearComparison" class="text-button">${t('clearComparison')}</button>` : `<div class="empty-state">${t('comparisonEmpty')}</div>`}</div></section>`;
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
  notice = t('exportedBackup', { positions: countPhrase(positions.length, 'позиция', 'позиции', 'позиций'), scenarios: countPhrase(scenarios.length, 'сценарий', 'сценария', 'сценариев') });
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
  notice = t('exportedPlanCsv', { rows: countPhrase(rows.length, 'операция', 'операции', 'операций') });
  render();
}

function applyPendingImport(mode: 'merge' | 'replace'): void {
  if (!pendingImport) return;
  if (mode === 'replace' && !window.confirm(t('confirmReplaceImport'))) return;
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
  notice = t('importedData', { positions: countPhrase(imported.length, 'позиция', 'позиции', 'позиций'), transactions: countPhrase(transactionCount, 'операция плана', 'операции плана', 'операций плана'), scenarios: countPhrase(importedScenarios.length, 'сценарий', 'сценария', 'сценариев') });
  render();
}

function transactionPlan(results: TransactionResult[], holding: HoldingState): string {
  if (holding.transactions.length === 0) {
    return `<div class="empty-state">${t('noPlannedTransactions')}</div>`;
  }

  const transactionCards = results.map((result, index) => {
    const resultText = !result.valid
      ? t('invalidTransaction')
      : result.type === 'sell'
        ? `${result.realizedProfitLoss >= 0 ? t('gain') : t('loss')} ${formatCurrency(Math.abs(result.realizedProfitLoss), holding)}`
        : result.reduction > 0
          ? t('averageReduced', { amount: formatCurrency(result.reduction, holding) })
          : result.averageChange > 0
            ? t('averageRaised', { amount: formatCurrency(result.averageChange, holding) })
            : t('averageUnchanged');
    const resultClass = !result.valid
      ? 'negative'
      : result.type === 'sell'
        ? result.realizedProfitLoss >= 0 ? 'positive' : 'negative'
        : result.reduction > 0 ? 'positive' : result.averageChange > 0 ? 'negative' : '';
    return `
      <article class="transaction-card ${result.valid ? '' : 'invalid-row'}">
        <div class="transaction-card-heading">
          <span class="action-tag ${result.type}">${result.type === 'buy' ? t('buy') : t('sell')}</span>
          <button class="icon-button" data-remove-mobile="${result.id}" aria-label="${t('removeTransaction', { number: index + 1 })}">×</button>
        </div>
        <dl>
          <div><dt>${t('price')}</dt><dd>${formatCurrency(result.price, holding)}</dd></div>
          <div><dt>${t('shares')}</dt><dd>${formatQuantity(result.shares, holding)}</dd></div>
          <div><dt>${t('gross')}</dt><dd>${formatCurrency(result.grossAmount, holding)}</dd></div>
          <div><dt>${t('fee')}</dt><dd>${formatCurrency(result.feeAmount, holding)} (${feeLabel({ mode: result.feeMode ?? 'percent', value: result.feeValue ?? 0 }, holding)})</dd></div>
          <div><dt>${result.type === 'buy' ? t('totalPaid') : t('netReceived')}</dt><dd>${formatCurrency(result.type === 'buy' ? result.totalAmount : result.netAmount, holding)}</dd></div>
          <div><dt>${t('sharesLeft')}</dt><dd>${formatQuantity(result.sharesAfter, holding)}</dd></div>
          <div><dt>${t('averageAfter')}</dt><dd>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter, holding) : t('closed')}</dd></div>
          <div><dt>${t('result')}</dt><dd class="${resultClass}">${escapeHtml(resultText)}</dd></div>
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
            <th>${t('action')}</th>
            <th>${t('price')}</th>
            <th>${t('shares')}</th>
            <th>${t('gross')}</th>
            <th>${t('fee')}</th>
            <th>${t('totalNet')}</th>
            <th>${t('sharesLeft')}</th>
            <th>${t('averageAfter')}</th>
            <th>${t('result')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${results.map((result, index) => {
            if (!result.valid) {
              return `
                <tr class="invalid-row">
                  <td>${index + 1}</td>
                  <td>${result.type === 'buy' ? t('buy') : t('sell')}</td>
                  <td>${formatCurrency(result.price)}</td>
                  <td>${formatQuantity(result.shares)}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>${formatQuantity(result.sharesAfter)}</td>
                  <td>${formatCurrency(result.averageAfter)}</td>
                  <td class="negative">${t('invalidTransaction')}</td>
                  <td><button class="icon-button" data-remove="${result.id}" aria-label="${t('removeTransactionShort')}">×</button></td>
                </tr>
              `;
            }

            const resultText = result.type === 'sell'
              ? `${result.realizedProfitLoss >= 0 ? t('gain') : t('loss')} ${formatCurrency(Math.abs(result.realizedProfitLoss))}`
              : result.reduction > 0
                ? t('averageReduced', { amount: formatCurrency(result.reduction) })
                : result.averageChange > 0
                  ? t('averageRaised', { amount: formatCurrency(result.averageChange) })
                  : t('averageUnchanged');
            const resultClass = result.type === 'sell'
              ? result.realizedProfitLoss >= 0 ? 'positive' : 'negative'
              : result.reduction > 0 ? 'positive' : result.averageChange > 0 ? 'negative' : '';

            return `
              <tr>
                <td>${index + 1}</td>
                <td><span class="action-tag ${result.type}">${result.type === 'buy' ? t('buy') : t('sell')}</span></td>
                <td>${formatCurrency(result.price)}</td>
                <td>${formatQuantity(result.shares)}</td>
              <td>${formatCurrency(result.grossAmount)}</td>
              <td>${formatCurrency(result.feeAmount)} (${feeLabel({ mode: result.feeMode ?? 'percent', value: result.feeValue ?? 0 })})</td>
              <td>${formatCurrency(result.type === 'buy' ? result.totalAmount : result.netAmount)}</td>
                <td>${formatQuantity(result.sharesAfter)}</td>
                <td>${result.sharesAfter > 0 ? formatCurrency(result.averageAfter) : t('closed')}</td>
                <td class="${resultClass}">${resultText}</td>
                <td><button class="icon-button" data-remove="${result.id}" aria-label="${t('removeTransactionShort')}">×</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="transaction-cards" aria-label="${t('futureTransactions')}">${transactionCards}</div>
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
  const displayValue = inputDrafts[id] ?? String(value);
  return `
    <label class="field">
      <span><span class="desktop-field-label">${label}</span><span class="mobile-field-label">${mobileLabel}</span></span>
      <input id="${id}" type="${type}" value="${escapeHtml(displayValue)}" placeholder="${placeholder}" ${type === 'number' ? `step="${step}" min="0" inputmode="decimal"` : ''} autocomplete="off" />
    </label>
  `;
}

function render(): void {
  const helpRoute = helpRouteFromHash();
  if (helpRoute) {
    renderHelp(app, helpRoute, { backToCalculator, changeLocale });
    return;
  }
  const holding = activeHolding();
  const { position, results } = effectivePosition(holding);
  const analyzablePosition = position && isFinitePositive(position.shares) && isFinitePositive(position.averagePrice)
    ? position
    : null;
  const tickerLabel = escapeHtml(holding.ticker || t('thisPosition'));
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
          <h1>${t('documentTitle')} <span class="release-tag">v${APP_VERSION}</span></h1>
          <p>${t('appTagline')}</p>
        </div>
      </div>
      <div class="header-actions">${localeSelector()}<div class="privacy-badge"><span></span> ${t('savedOnlyHere')}</div></div>
    </header>

    <main class="layout">
      <aside class="sidebar">
        <section class="panel positions-panel">
          <div class="section-heading compact">
            <div>
              <span class="eyebrow">${t('positions')}</span>
              <h2>${t('switchHoldings')}</h2>
            </div>
          </div>
          <label class="field">
            <span>${t('currentHolding')}</span>
            <select id="holdingSelect">
              ${store.holdings.map((item, index) => `<option value="${item.id}" ${item.id === holding.id ? 'selected' : ''}>${escapeHtml(holdingName(item, index))}</option>`).join('')}
            </select>
          </label>
          <div class="button-row">
            <button id="newHolding" class="secondary-button">${t('newPosition')}</button>
            <button id="deleteHolding" class="text-button danger-text">${t('delete')}</button>
          </div>
          <p class="helper-text">${t('eachTickerOwns')}</p>
        </section>

        <section id="position" class="panel holding-panel">
          ${holdingSummary(holding)}
          <div id="holdingEditor" class="holding-editor ${holdingEditorExpanded ? 'is-expanded' : ''}">
          <div class="section-heading">
            <div>
              <span class="eyebrow">${t('currentHolding')}</span>
              <h2>${t('whatYouOwnNow')}</h2>
            </div>
            <div class="heading-actions">${contextualHelpLink('positions')}<button id="resetHolding" class="text-button">${t('reset')}</button></div>
          </div>

          <div class="field-grid two">
            ${field('ticker', t('tickerName'), holding.ticker, 'text', 'SOXL')}
            ${field('currency', t('currency'), holding.currency, 'text', 'USD')}
            ${field('baseShares', t('sharesOwned'), holding.baseShares, 'number', '48.5')}
            ${field('baseAverage', t('averageBuyPrice'), holding.baseAverage, 'number', '189')}
            ${field('currentMarketPrice', t('currentMarketPrice'), holding.currentMarketPrice, 'number', '50')}
          </div>

          <div class="purchase-settings">
            <span class="settings-title">${t('purchaseSettings')}</span>
            <div class="field-grid two">
              ${field('shareStep', t('smallestShareAmount'), holding.shareStep, 'number', '1', 'any')}
              ${field('budget', t('budgetLimit'), holding.budget, 'number', '4000', 'any')}
            </div>
            <label class="range-field">
              <span><b>${t('minimumNextShareEffect')}</b><output id="efficiencyFloorValue">${percent(holding.efficiencyFloor * 100, 0)}</output></span>
              <input id="efficiencyFloor" type="range" min="5" max="100" step="5" value="${holding.efficiencyFloor * 100}" />
              <small>${t('nextShareHelp')}</small>
            </label>
            <label class="range-field">
              <span><b>${t('fullBudgetTarget')}</b><output id="budgetBenefitTargetValue">${percent(holding.budgetBenefitTarget * 100, 0)}</output></span>
              <input id="budgetBenefitTarget" type="range" min="5" max="100" step="5" value="${holding.budgetBenefitTarget * 100}" />
              <small>${t('fullBudgetHelp')}</small>
            </label>
          </div>
          </div>
        </section>
        <section class="panel help-entry-card">
          <div><span class="eyebrow">${t('helpGuide')}</span><h2>${t('helpGuide')}</h2><p class="helper-text">${t('helpGuideDescription')}</p></div>
          <button id="openHelp" class="text-button" aria-label="${t('openHelp')}">? ${t('openHelp')}</button>
        </section>
      </aside>

      <section class="content">
        ${notice ? `<div class="notice" role="status">${escapeHtml(notice)}</div>` : ''}

        <section id="transaction" class="panel hero-panel">
          <div class="section-heading action-heading">
            <div>
              <span class="eyebrow">${t('testTransaction')}</span>
              <h2>${isBuy ? t('whatIfBuy', { position: tickerLabel }) : t('whatIfSell', { position: tickerLabel })}</h2>
            </div>
            <div class="heading-actions">${contextualHelpLink('buy-sell')}${analyzablePosition ? `<div class="position-pill">${sharePhrase(analyzablePosition.shares, 'complete', holding)} @ ${formatCurrency(analyzablePosition.averagePrice)}</div>` : ''}</div>
          </div>

          <div class="segmented-control" aria-label="${t('transactionType')}">
            <button type="button" data-action="buy" class="${isBuy ? 'active' : ''}">${t('buy')}</button>
            <button type="button" data-action="sell" class="${!isBuy ? 'active' : ''}">${t('sell')}</button>
          </div>

          <div class="transaction-entry">
            ${field('transactionPrice', isBuy ? t('buyPricePerShare') : t('sellPricePerShare'), holding.transactionPrice, 'number', '147', 'any', t('price'))}
            ${field('transactionShares', isBuy ? t('sharesToBuy') : t('sharesToSell'), holding.transactionShares, 'number', '4', 'any', t('shares'))}
            <div class="fee-controls" aria-label="${t('fee')}">
              <span class="fee-controls-label">${t('fee')}</span>
              <div class="segmented-control fee-mode-control" aria-label="${t('feeMode')}">
                <button type="button" data-fee-mode="percent" class="${transactionFee.mode === 'percent' ? 'active' : ''}">${t('percent')}</button>
                <button type="button" data-fee-mode="fixed" class="${transactionFee.mode === 'fixed' ? 'active' : ''}">${t('fixed')}</button>
              </div>
              ${field('transactionFee', transactionFee.mode === 'percent' ? t('feePercent') : t('fixedFee'), transactionFee.value, 'number', '0', '0.01', t('fee'))}
              <span class="fee-preview">${feeLabel(transactionFee)} · ${isFinitePositive(holding.transactionPrice) && isFinitePositive(holding.transactionShares) ? `${t('fee')} ${formatCurrency(transactionFee.mode === 'percent' ? holding.transactionPrice * holding.transactionShares * transactionFee.value / 100 : transactionFee.value)}` : t('enterPriceShares')}</span>
            </div>
            <button id="addTransaction" class="primary-button" ${validTransaction ? '' : 'disabled'}>${isBuy ? t('addBuyToPlan') : t('addSaleToPlan')}</button>
          </div>

          ${analyzablePosition
            ? `${transactionSummary(analyzablePosition, holding)}${resultStrip(analyzablePosition, holding)}`
            : `<div class="empty-state">${t('needPosition')}</div>`}
        </section>

        ${marketSnapshotPanel(analyzablePosition, holding)}

        ${analyzablePosition ? targetsPanel(analyzablePosition, holding) : ''}

        ${scenarioPlannerPanel(holding)}

        ${savedScenariosPanel(holding)}

        ${comparisonPanel(holding)}

        ${isBuy && analyzablePosition ? `
          <section id="buying-guide" class="panel">
            <div class="section-heading">
              <div>
                <span class="eyebrow">${t('buyingGuide')}</span>
                <h2>${t('usefulPurchaseSizes')}</h2>
              </div>${contextualHelpLink('buying-guide')}
            </div>
            ${optimizerCards(analyzablePosition, holding)}
            ${curveSvg(analyzablePosition, holding)}
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <span class="eyebrow">${t('compareOptions')}</span>
                <h2>${t('differentBuySizes')}</h2>
              </div>${contextualHelpLink('buying-guide')}
            </div>
            ${scenarioTable(analyzablePosition, holding)}
            ${isFinitePositive(holding.transactionPrice) && holding.transactionPrice < analyzablePosition.averagePrice
              ? `<p class="simple-note table-note">${t('averageReductionHelp')}</p>`
              : ''}
          </section>
        ` : ''}

        <section id="future-plan" class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">${t('futureTransactions')}</span>
              <h2>${t('planFor', { position: tickerLabel })}</h2>
            </div>
            <div class="heading-actions">${contextualHelpLink('future-plan')}${holding.transactions.length ? `<button id="clearPlan" class="text-button">${t('clearPlan')}</button>` : ''}</div>
          </div>
          ${transactionPlan(results, holding)}
        </section>

        ${dataManagementPanel(holding)}

        <p class="disclaimer">${t('planningDisclaimer')}</p>
      </section>
    </main>
  `;

  wireEvents();
  inputDrafts = {};
  notice = '';
}

function wireEvents(): void {
  document.querySelector<HTMLButtonElement>('#openHelp')?.addEventListener('click', () => openHelp());
  document.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((button) => button.addEventListener('click', () => changeLocale(button.dataset.locale === 'ru' ? 'ru' : 'en')));
  document.querySelectorAll<HTMLButtonElement>('[data-help-open]').forEach((button) => button.addEventListener('click', () => {
    const sectionId = button.closest<HTMLElement>('[id]')?.id ?? '';
    openHelp(button.dataset.helpOpen ?? 'home', sectionId);
  }));
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
      const value = parseLocalizedDecimal((event.currentTarget as HTMLInputElement).value) ?? 0;
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
      pendingImport = parseBackupJson(await file.text());
      notice = t('backupChecked');
    } catch (error) {
      pendingImport = null;
      notice = backupImportMessage(error);
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
    notice = t('newPositionCreated');
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
      notice = t('positionDeletedNew');
    } else {
      const nextIndex = Math.max(0, Math.min(index, store.holdings.length - 1));
      store.activeHoldingId = store.holdings[nextIndex]!.id;
      notice = t('positionDeleted');
    }

    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#addTransaction')?.addEventListener('click', () => {
    updateHoldingFromInputs();
    const holding = activeHolding();
    const { position } = effectivePosition(holding);
    if (!position || !isFinitePositive(position.shares) || !isFinitePositive(position.averagePrice)) {
      notice = t('validHoldingFirst');
      render();
      return;
    }
    if (!isFinitePositive(holding.transactionPrice) || !isFinitePositive(holding.transactionShares)) {
      notice = t('priceAndSharesFirst');
      render();
      return;
    }
    const fee = activeFee(holding);
    if (!Number.isFinite(fee.value) || fee.value < 0) {
      notice = t('enterNonNegativeFee');
      render();
      return;
    }
    if (holding.action === 'sell' && holding.transactionShares > position.shares) {
      notice = t('cannotSellMore', { shares: sharePhrase(position.shares, 'genitive', holding) });
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
    notice = t('transactionAdded', { action: holding.action === 'buy' ? t('buy') : t('sale') });
    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#clearPlan')?.addEventListener('click', () => {
    activeHolding().transactions = [];
    notice = t('planCleared');
    saveStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('#toggleScenarioPlanner')?.addEventListener('click', () => {
    scenarioPanelExpanded = !scenarioPanelExpanded;
    render();
  });
  document.querySelector<HTMLButtonElement>('#newScenario')?.addEventListener('click', () => {
    if (createScenarioFromHolding()) notice = t('scenarioCreated');
    render();
  });
  document.querySelector<HTMLButtonElement>('#savePlanScenario')?.addEventListener('click', () => {
    if (createScenarioFromHolding(t('savedPlanName', { position: activeHolding().ticker || t('positionLabel') }))) notice = t('scenarioSaved');
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-load-scenario]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.loadScenario;
    if (!id || !store.scenarios.some((scenario) => scenario.id === id)) return;
    if (!window.confirm(t('confirmLoadScenario'))) return;
    loadedScenarioId = id;
    scenarioPanelExpanded = true;
    pendingApplicationScenarioId = null;
    notice = t('scenarioLoaded');
    render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-duplicate-scenario]').forEach((button) => button.addEventListener('click', () => {
    const source = store.scenarios.find((scenario) => scenario.id === button.dataset.duplicateScenario);
    if (!source) return;
    const timestamp = new Date().toISOString();
    const copy: Scenario = JSON.parse(JSON.stringify(source)) as Scenario;
    copy.id = createId(); copy.name = t('copiedScenarioName', { name: displayScenarioName(source.name) }); copy.status = 'draft'; copy.createdAt = timestamp; copy.updatedAt = timestamp;
    copy.transactions = copy.transactions.map((transaction, index) => ({ ...transaction, id: createId(), appliedAt: undefined, createdAt: timestamp, updatedAt: timestamp, createdOrder: index }));
    copy.ladder = copy.ladder ? { ...copy.ladder, levels: copy.ladder.levels.map((level) => ({ ...level, id: createId() })) } : null;
    store.scenarios.push(copy); loadedScenarioId = copy.id; scenarioPanelExpanded = true; saveStore(); notice = t('scenarioDuplicated'); render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-scenario-archive]').forEach((button) => button.addEventListener('click', () => {
    const scenario = store.scenarios.find((item) => item.id === button.dataset.scenarioArchive);
    if (!scenario) return;
    scenario.status = scenario.status === 'archived' ? 'draft' : 'archived';
    store.comparisonScenarioIds = store.comparisonScenarioIds.filter((id) => id !== scenario.id);
    touchScenario(scenario); notice = scenario.status === 'archived' ? t('scenarioArchived') : t('scenarioRestored'); render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-scenario]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.deleteScenario;
    if (!id || !window.confirm(t('confirmDeleteScenario'))) return;
    store.scenarios = store.scenarios.filter((scenario) => scenario.id !== id);
    store.comparisonScenarioIds = store.comparisonScenarioIds.filter((item) => item !== id);
    if (loadedScenarioId === id) loadedScenarioId = null;
    saveStore(); notice = t('scenarioDeleted'); render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-compare-scenario]').forEach((input) => input.addEventListener('change', () => {
    const id = input.dataset.compareScenario;
    const scenario = store.scenarios.find((item) => item.id === id);
    if (!id || !scenario || scenario.status === 'archived') return;
    if (input.checked) {
      if (store.comparisonScenarioIds.length >= 4) { notice = t('comparisonLimit'); input.checked = false; render(); return; }
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
  updateScenarioField('scenarioName', (value) => { const current = loadedScenario(); if (current) current.name = value.trim(); });
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
        if (generated.error) { notice = plannerMessage(generated.errorCode); render(); return; }
        scenario.ladder = { ...generated.ladder, distribution: ladder.distribution };
        syncLadderTransactions(scenario); touchScenario(scenario); notice = t('ladderGenerated');
      } catch (error) { notice = error instanceof Error ? error.message : t('ladderGenerationFailed'); }
      render();
    });
    document.querySelector<HTMLButtonElement>('#addLadderLevel')?.addEventListener('click', () => { const last = ladder.levels.at(-1); ladder.levels.push({ id: createId(), price: last?.price ?? ladder.endPrice, shares: last?.shares ?? ladder.sharePrecision, feeMode: ladder.feeMode, feeValue: activeLadderFee(ladder).value }); ladder.levelCount = Math.min(20, ladder.levels.length); syncLadderTransactions(scenario); touchScenario(scenario); render(); });
    document.querySelector<HTMLButtonElement>('#clearLadder')?.addEventListener('click', () => { scenario.transactions = scenario.transactions.filter((transaction) => !transaction.ladderLevelId); scenario.ladder = null; touchScenario(scenario); notice = t('ladderCleared'); render(); });
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
    document.querySelector<HTMLButtonElement>('#addStressPrice')?.addEventListener('click', () => { const value = window.prompt(t('stressPricePrompt')); if (value === null) return; const price = parseLocalizedDecimal(value); if (price === null || price < 0) { notice = t('nonNegativePrice'); render(); return; } scenario.stressPrices.push({ id: createId(), kind: 'absolute', value: price }); touchScenario(scenario); render(); });
    document.querySelector<HTMLButtonElement>('#toggleStressSort')?.addEventListener('click', () => { stressAscending = !stressAscending; render(); });
    document.querySelectorAll<HTMLButtonElement>('[data-remove-stress]').forEach((button) => button.addEventListener('click', () => { scenario.stressPrices = scenario.stressPrices.filter((entry) => entry.id !== button.dataset.removeStress); touchScenario(scenario); render(); }));
    document.querySelector<HTMLButtonElement>('#toggleReverseSell')?.addEventListener('click', () => { reverseSellExpanded = !reverseSellExpanded; render(); });
    document.querySelectorAll<HTMLButtonElement>('[data-reverse-direction]').forEach((button) => button.addEventListener('click', () => { reverseDirection = button.dataset.reverseDirection === 'shares' ? 'shares' : 'price'; render(); }));
    document.querySelectorAll<HTMLButtonElement>('[data-reverse-mode]').forEach((button) => button.addEventListener('click', () => { const mode = button.dataset.reverseMode; reverseMode = mode === 'return' || mode === 'netProceeds' || mode === 'breakEven' ? mode : 'profit'; render(); }));
    document.querySelector<HTMLInputElement>('#reverseShares')?.addEventListener('change', (event) => { reverseShares = parseLocalizedDecimal((event.currentTarget as HTMLInputElement).value); render(); });
    document.querySelector<HTMLInputElement>('#reversePrice')?.addEventListener('change', (event) => { reversePrice = parseLocalizedDecimal((event.currentTarget as HTMLInputElement).value); render(); });
    document.querySelector<HTMLInputElement>('#reverseTarget')?.addEventListener('change', (event) => { reverseTarget = parseLocalizedDecimal((event.currentTarget as HTMLInputElement).value) ?? 0; render(); });
    document.querySelector<HTMLButtonElement>('#previewApplyExecuted')?.addEventListener('click', () => { pendingApplicationScenarioId = scenario.id; render(); });
    document.querySelector<HTMLButtonElement>('#cancelApplyExecuted')?.addEventListener('click', () => { pendingApplicationScenarioId = null; render(); });
    document.querySelector<HTMLButtonElement>('#confirmApplyExecuted')?.addEventListener('click', () => { const holding = activeHolding(); const preview = previewExecutionApplication({ shares: holding.baseShares, averagePrice: holding.baseAverage }, scenario); if (!preview.valid || !preview.candidates.length) { notice = t('noEligibleExecuted'); pendingApplicationScenarioId = null; render(); return; } if (!window.confirm(t('confirmApplyExecuted', { rows: executedTradePhrase(preview.candidates.length, 'accusative') }))) return; holding.baseShares = preview.finalPosition.shares; holding.baseAverage = preview.finalPosition.averagePrice; const appliedAt = new Date().toISOString(); const ids = new Set(preview.candidates.map((transaction) => transaction.id)); scenario.transactions.forEach((transaction) => { if (ids.has(transaction.id)) transaction.appliedAt = appliedAt; }); touchScenario(scenario); pendingApplicationScenarioId = null; notice = t('appliedExecuted', { rows: executedTradePhrase(preview.candidates.length), agreement: executedTradeAgreement(preview.candidates.length) }); render(); });
  }

  document.querySelector<HTMLButtonElement>('#resetHolding')?.addEventListener('click', () => {
    const current = activeHolding();
    const replacement = createHolding({ id: current.id, ticker: current.ticker });
    const index = store.holdings.findIndex((holding) => holding.id === current.id);
    store.holdings[index] = replacement;
    notice = t('holdingReset');
    saveStore();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-remove], [data-remove-mobile]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.remove ?? button.dataset.removeMobile;
      const holding = activeHolding();
      holding.transactions = holding.transactions.filter((transaction) => transaction.id !== id);
      notice = t('transactionRemoved');
      saveStore();
      render();
    });
  });
}

window.addEventListener('hashchange', () => {
  const route = helpRouteFromHash();
  render();
  if (!route && helpReturnContext) {
    const context = helpReturnContext;
    helpReturnContext = null;
    window.requestAnimationFrame(() => {
      const section = context.sectionId ? document.getElementById(context.sectionId) : null;
      if (section) {
        if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start' });
        const heading = section.querySelector<HTMLElement>('h2, h3');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      } else if (typeof window.scrollTo === 'function' && !navigator.userAgent.toLowerCase().includes('jsdom')) window.scrollTo({ top: context.scrollY });
    });
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && helpRouteFromHash()) backToCalculator();
});

render();
