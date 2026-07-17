import type { FeeMode, TransactionType } from './calculator';

export const BACKUP_SCHEMA_VERSION = 2;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const APP_VERSION = '1.7.0';

export type BackupScope = 'all' | 'active';
export type BackupPosition = Record<string, unknown>;

export interface BackupDocument {
  application: 'Average Price Planner';
  backupSchemaVersion: number;
  applicationVersion: string;
  exportedAt: string;
  scope: BackupScope;
  activeHoldingId?: string;
  positions: BackupPosition[];
  scenarios: BackupPosition[];
  comparisonScenarioIds: string[];
}

const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const finiteNonNegativeFields = [
  'baseShares', 'baseAverage', 'transactionPrice', 'transactionShares', 'budget', 'shareStep',
  'efficiencyFloor', 'budgetBenefitTarget', 'currentMarketPrice', 'targetAverage',
  'targetBuyPrice', 'targetSellShares', 'targetSellValue',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeClone);
  if (!isRecord(value)) return value;
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (blockedKeys.has(key)) throw new Error('Import rejected: unsafe object key.');
    clone[key] = safeClone(item);
  }
  return clone;
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validFee(value: unknown): boolean {
  return isRecord(value)
    && (value.mode === 'percent' || value.mode === 'fixed')
    && isFiniteNonNegative(value.value);
}

function validTransaction(value: unknown, index: number): value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Import rejected: transaction ${index + 1} is not an object.`);
  if (value.type !== 'buy' && value.type !== 'sell') throw new Error(`Import rejected: transaction ${index + 1} has an invalid type.`);
  if (!(typeof value.shares === 'number' && Number.isFinite(value.shares) && value.shares > 0)) throw new Error(`Import rejected: transaction ${index + 1} contains a negative or invalid share quantity.`);
  if (!(typeof value.price === 'number' && Number.isFinite(value.price) && value.price > 0)) throw new Error(`Import rejected: transaction ${index + 1} contains an invalid price.`);
  if (value.feeMode !== undefined && value.feeMode !== 'percent' && value.feeMode !== 'fixed') throw new Error(`Import rejected: transaction ${index + 1} has an invalid fee mode.`);
  if (value.feeValue !== undefined && !isFiniteNonNegative(value.feeValue)) throw new Error(`Import rejected: transaction ${index + 1} has an invalid fee value.`);
  return true;
}

export function validateBackupPosition(value: unknown): BackupPosition {
  const position = safeClone(value);
  if (!isRecord(position) || typeof position.id !== 'string' || !position.id) throw new Error('Import rejected: every position needs an identifier.');
  if (position.ticker !== undefined && typeof position.ticker !== 'string') throw new Error('Import rejected: a ticker must be text.');
  if (position.currency !== undefined && typeof position.currency !== 'string') throw new Error('Import rejected: a currency must be text.');
  for (const key of finiteNonNegativeFields) {
    if (position[key] !== undefined && !isFiniteNonNegative(position[key])) throw new Error(`Import rejected: ${key} must be a finite value of zero or greater.`);
  }
  if (position.shareStep !== undefined && Number(position.shareStep) <= 0) throw new Error('Import rejected: shareStep must be greater than zero.');
  if (position.buyFee !== undefined && !validFee(position.buyFee)) throw new Error('Import rejected: buy fee is invalid.');
  if (position.sellFee !== undefined && !validFee(position.sellFee)) throw new Error('Import rejected: sell fee is invalid.');
  if (position.transactions !== undefined) {
    if (!Array.isArray(position.transactions)) throw new Error('Import rejected: transactions must be a list.');
    position.transactions.forEach(validTransaction);
  }
  return position;
}

export function validateBackupScenario(value: unknown): BackupPosition {
  const scenario = safeClone(value);
  if (!isRecord(scenario) || typeof scenario.id !== 'string' || !scenario.id || typeof scenario.holdingId !== 'string' || !scenario.holdingId) {
    throw new Error('Import rejected: every scenario needs an identifier and holding identifier.');
  }
  if (scenario.name !== undefined && typeof scenario.name !== 'string') throw new Error('Import rejected: a scenario name must be text.');
  if (scenario.status !== undefined && !['draft', 'active', 'completed', 'archived'].includes(String(scenario.status))) throw new Error('Import rejected: scenario status is invalid.');
  if (!isRecord(scenario.basePosition) || !isFiniteNonNegative(scenario.basePosition.shares) || !isFiniteNonNegative(scenario.basePosition.averagePrice)) {
    throw new Error('Import rejected: scenario base position is invalid.');
  }
  if (scenario.marketPrice !== undefined && !isFiniteNonNegative(scenario.marketPrice)) throw new Error('Import rejected: scenario market price is invalid.');
  if (scenario.transactions !== undefined) {
    if (!Array.isArray(scenario.transactions)) throw new Error('Import rejected: scenario transactions must be a list.');
    scenario.transactions.forEach((transaction, index) => {
      validTransaction(transaction, index);
      if (isRecord(transaction) && transaction.status !== undefined && !['planned', 'executed', 'cancelled'].includes(String(transaction.status))) throw new Error(`Import rejected: transaction ${index + 1} status is invalid.`);
      if (isRecord(transaction) && transaction.actualFee !== undefined && !isFiniteNonNegative(transaction.actualFee)) throw new Error(`Import rejected: transaction ${index + 1} actual fee is invalid.`);
    });
  }
  return scenario;
}

export function createBackup(positions: BackupPosition[], activeHoldingId: string | undefined, scope: BackupScope, exportedAt = new Date().toISOString(), scenarios: BackupPosition[] = [], comparisonScenarioIds: string[] = []): BackupDocument {
  return {
    application: 'Average Price Planner',
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    applicationVersion: APP_VERSION,
    exportedAt,
    scope,
    ...(scope === 'all' && activeHoldingId ? { activeHoldingId } : {}),
    positions: positions.map((position) => validateBackupPosition(position)),
    scenarios: scenarios.map((scenario) => validateBackupScenario(scenario)),
    comparisonScenarioIds: comparisonScenarioIds.filter((id): id is string => typeof id === 'string'),
  };
}

/** Parses and validates the entire backup before callers are allowed to mutate browser storage. */
export function parseBackupJson(raw: string): BackupDocument {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new Error('Import rejected: backup files must be 5 MB or smaller.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Import rejected: the selected file is not valid JSON.');
  }
  const document = safeClone(parsed);
  if (!isRecord(document) || document.application !== 'Average Price Planner') throw new Error('Import rejected: this is not an Average Price Planner backup.');
  const legacySchema = document.backupSchemaVersion === 0 || document.backupSchemaVersion === 1;
  if (document.backupSchemaVersion !== BACKUP_SCHEMA_VERSION && !legacySchema) throw new Error('Import rejected: unsupported backup schema version.');
  const applicationVersion = typeof document.applicationVersion === 'string'
    ? document.applicationVersion
    : legacySchema && typeof document.version === 'string' ? document.version : null;
  if (!applicationVersion || typeof document.exportedAt !== 'string') throw new Error('Import rejected: backup metadata is incomplete.');
  const scope = document.scope === 'all' || document.scope === 'active' ? document.scope : legacySchema ? 'all' : null;
  if (!scope) throw new Error('Import rejected: backup scope is invalid.');
  if (!Array.isArray(document.positions)) throw new Error('Import rejected: positions must be a list.');
  const positions = document.positions.map(validateBackupPosition);
  const scenarios = Array.isArray(document.scenarios) ? document.scenarios.map(validateBackupScenario) : [];
  const comparisonScenarioIds = Array.isArray(document.comparisonScenarioIds)
    ? document.comparisonScenarioIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (document.activeHoldingId !== undefined && typeof document.activeHoldingId !== 'string') throw new Error('Import rejected: active position identifier is invalid.');
  return {
    application: 'Average Price Planner',
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    applicationVersion,
    exportedAt: document.exportedAt,
    scope,
    ...(typeof document.activeHoldingId === 'string' ? { activeHoldingId: document.activeHoldingId } : {}),
    positions,
    scenarios,
    comparisonScenarioIds,
  };
}

export function mergeBackupScenarios(current: BackupPosition[], imported: BackupPosition[], newId: () => string): BackupPosition[] {
  const used = new Set(current.map((scenario) => String(scenario.id)));
  const usedTransactionIds = new Set(current.flatMap((scenario) => Array.isArray(scenario.transactions)
    ? scenario.transactions.filter(isRecord).map((transaction) => String(transaction.id))
    : []));
  const merged = current.map((scenario) => safeClone(scenario) as BackupPosition);
  for (const source of imported) {
    const scenario = validateBackupScenario(source);
    let id = String(scenario.id);
    while (used.has(id)) id = newId();
    used.add(id);
    const transactions = Array.isArray(scenario.transactions)
      ? scenario.transactions.map((item) => {
          const transaction = safeClone(item) as BackupPosition;
          let transactionId = String(transaction.id);
          while (usedTransactionIds.has(transactionId)) transactionId = newId();
          usedTransactionIds.add(transactionId);
          return { ...transaction, id: transactionId };
        })
      : [];
    merged.push({ ...scenario, id, transactions });
  }
  return merged;
}

export function mergeBackupPositions(current: BackupPosition[], imported: BackupPosition[], newId: () => string): BackupPosition[] {
  const used = new Set(current.map((position) => String(position.id)));
  const merged = current.map((position) => safeClone(position) as BackupPosition);
  for (const source of imported) {
    const position = validateBackupPosition(source);
    let id = String(position.id);
    while (used.has(id)) id = newId();
    used.add(id);
    merged.push({ ...position, id });
  }
  return merged;
}

export function csvSafeCell(value: string | number): string {
  const raw = String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
}

export interface CsvPlanRow {
  sequence: number;
  type: TransactionType;
  price: number;
  shares: number;
  grossAmount: number;
  feeMode: FeeMode;
  feeValue: number;
  feeAmount: number;
  totalPaid: number;
  netReceived: number;
  sharesAfter: number;
  averageAfter: number;
  averageChange: number;
  realizedProfitLoss: number;
  currency: string;
}

export function planCsv(rows: CsvPlanRow[]): string {
  const headers = ['Sequence', 'Type', 'Price', 'Shares', 'Gross value', 'Fee mode', 'Fee input', 'Fee amount', 'Total paid', 'Net received', 'Shares after', 'Average after', 'Average change', 'Realized profit/loss', 'Currency'];
  const body = rows.map((row) => [row.sequence, row.type, row.price, row.shares, row.grossAmount, row.feeMode, row.feeValue, row.feeAmount, row.totalPaid, row.netReceived, row.sharesAfter, row.averageAfter, row.averageChange, row.realizedProfitLoss, row.currency].map(csvSafeCell).join(','));
  return `\uFEFF${headers.map(csvSafeCell).join(',')}\r\n${body.join('\r\n')}${body.length ? '\r\n' : ''}`;
}

export interface ScenarioCsvRow extends CsvPlanRow {
  scenarioName: string;
  scenarioStatus: string;
  transactionStatus: string;
  date: string;
  note: string;
  brokerLabel: string;
  applied: string;
}

export function scenarioCsv(rows: ScenarioCsvRow[]): string {
  const headers = ['Scenario name', 'Scenario status', 'Transaction status', 'Type', 'Planned/executed date', 'Quantity', 'Price', 'Fee mode', 'Fee value', 'Gross value', 'Net value', 'Note', 'Broker/account', 'Applied status', 'Currency'];
  const body = rows.map((row) => [row.scenarioName, row.scenarioStatus, row.transactionStatus, row.type, row.date, row.shares, row.price, row.feeMode, row.feeValue, row.grossAmount, row.netReceived || row.totalPaid, row.note, row.brokerLabel, row.applied, row.currency].map(csvSafeCell).join(','));
  return `\uFEFF${headers.map(csvSafeCell).join(',')}\r\n${body.join('\r\n')}${body.length ? '\r\n' : ''}`;
}

export interface LadderCsvRow {
  level: number;
  price: number;
  shares: number;
  grossAmount: number;
  feeMode: FeeMode;
  feeValue: number;
  feeAmount: number;
  totalAmount: number;
  cumulativeShares: number;
  cumulativeBasis: number;
  cumulativeAverage: number;
  currency: string;
}

export function ladderCsv(rows: LadderCsvRow[]): string {
  const headers = ['Level', 'Buy price', 'Quantity', 'Gross purchase value', 'Fee mode', 'Fee value', 'Fee', 'Total cash required', 'Cumulative quantity', 'Cumulative cost basis', 'Cumulative average price', 'Currency'];
  const body = rows.map((row) => [row.level, row.price, row.shares, row.grossAmount, row.feeMode, row.feeValue, row.feeAmount, row.totalAmount, row.cumulativeShares, row.cumulativeBasis, row.cumulativeAverage, row.currency].map(csvSafeCell).join(','));
  return `\uFEFF${headers.map(csvSafeCell).join(',')}\r\n${body.join('\r\n')}${body.length ? '\r\n' : ''}`;
}
