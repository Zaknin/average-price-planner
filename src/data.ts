import type { FeeMode, TransactionType } from './calculator';
import { APP_VERSION } from './version';

export const BACKUP_SCHEMA_VERSION = 2;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export type BackupScope = 'all' | 'active';
export type BackupPosition = Record<string, unknown>;

export type BackupValidationErrorCode =
  | 'backup.invalidJson'
  | 'backup.invalidRoot'
  | 'backup.metadataIncomplete'
  | 'backup.unsupportedSchema'
  | 'backup.unsafeObjectKey'
  | 'backup.invalidPosition'
  | 'backup.invalidScenario'
  | 'backup.invalidTransaction'
  | 'backup.invalidTransactionType'
  | 'backup.invalidNumericValue'
  | 'backup.fileTooLarge';

export class BackupValidationError extends Error {
  readonly code: BackupValidationErrorCode;
  readonly values?: Record<string, string | number>;

  constructor(code: BackupValidationErrorCode, values?: Record<string, string | number>) {
    super(code);
    this.name = 'BackupValidationError';
    this.code = code;
    this.values = values;
  }
}

export function isBackupValidationError(error: unknown): error is BackupValidationError {
  return error instanceof BackupValidationError;
}

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
    if (blockedKeys.has(key)) throw new BackupValidationError('backup.unsafeObjectKey');
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
  if (!isRecord(value)) throw new BackupValidationError('backup.invalidTransaction', { index: index + 1 });
  if (value.type !== 'buy' && value.type !== 'sell') throw new BackupValidationError('backup.invalidTransactionType', { index: index + 1 });
  if (!(typeof value.shares === 'number' && Number.isFinite(value.shares) && value.shares > 0)) throw new BackupValidationError('backup.invalidNumericValue', { index: index + 1 });
  if (!(typeof value.price === 'number' && Number.isFinite(value.price) && value.price > 0)) throw new BackupValidationError('backup.invalidNumericValue', { index: index + 1 });
  if (value.feeMode !== undefined && value.feeMode !== 'percent' && value.feeMode !== 'fixed') throw new BackupValidationError('backup.invalidTransaction', { index: index + 1 });
  if (value.feeValue !== undefined && !isFiniteNonNegative(value.feeValue)) throw new BackupValidationError('backup.invalidNumericValue', { index: index + 1 });
  return true;
}

export function validateBackupPosition(value: unknown): BackupPosition {
  const position = safeClone(value);
  if (!isRecord(position) || typeof position.id !== 'string' || !position.id) throw new BackupValidationError('backup.invalidPosition');
  if (position.ticker !== undefined && typeof position.ticker !== 'string') throw new BackupValidationError('backup.invalidPosition');
  if (position.currency !== undefined && typeof position.currency !== 'string') throw new BackupValidationError('backup.invalidPosition');
  for (const key of finiteNonNegativeFields) {
    if (position[key] !== undefined && !isFiniteNonNegative(position[key])) throw new BackupValidationError('backup.invalidNumericValue');
  }
  if (position.shareStep !== undefined && Number(position.shareStep) <= 0) throw new BackupValidationError('backup.invalidNumericValue');
  if (position.buyFee !== undefined && !validFee(position.buyFee)) throw new BackupValidationError('backup.invalidPosition');
  if (position.sellFee !== undefined && !validFee(position.sellFee)) throw new BackupValidationError('backup.invalidPosition');
  if (position.transactions !== undefined) {
    if (!Array.isArray(position.transactions)) throw new BackupValidationError('backup.invalidTransaction');
    position.transactions.forEach(validTransaction);
  }
  return position;
}

export function validateBackupScenario(value: unknown): BackupPosition {
  const scenario = safeClone(value);
  if (!isRecord(scenario) || typeof scenario.id !== 'string' || !scenario.id || typeof scenario.holdingId !== 'string' || !scenario.holdingId) {
    throw new BackupValidationError('backup.invalidScenario');
  }
  if (scenario.name !== undefined && typeof scenario.name !== 'string') throw new BackupValidationError('backup.invalidScenario');
  if (scenario.status !== undefined && !['draft', 'active', 'completed', 'archived'].includes(String(scenario.status))) throw new BackupValidationError('backup.invalidScenario');
  if (!isRecord(scenario.basePosition) || !isFiniteNonNegative(scenario.basePosition.shares) || !isFiniteNonNegative(scenario.basePosition.averagePrice)) {
    throw new BackupValidationError('backup.invalidScenario');
  }
  if (scenario.marketPrice !== undefined && !isFiniteNonNegative(scenario.marketPrice)) throw new BackupValidationError('backup.invalidNumericValue');
  if (scenario.transactions !== undefined) {
    if (!Array.isArray(scenario.transactions)) throw new BackupValidationError('backup.invalidTransaction');
    scenario.transactions.forEach((transaction, index) => {
      validTransaction(transaction, index);
      if (isRecord(transaction) && transaction.status !== undefined && !['planned', 'executed', 'cancelled'].includes(String(transaction.status))) throw new BackupValidationError('backup.invalidTransaction', { index: index + 1 });
      if (isRecord(transaction) && transaction.actualFee !== undefined && !isFiniteNonNegative(transaction.actualFee)) throw new BackupValidationError('backup.invalidNumericValue', { index: index + 1 });
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
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new BackupValidationError('backup.fileTooLarge');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupValidationError('backup.invalidJson');
  }
  const document = safeClone(parsed);
  if (!isRecord(document) || document.application !== 'Average Price Planner') throw new BackupValidationError('backup.invalidRoot');
  const legacySchema = document.backupSchemaVersion === 0 || document.backupSchemaVersion === 1;
  if (document.backupSchemaVersion !== BACKUP_SCHEMA_VERSION && !legacySchema) throw new BackupValidationError('backup.unsupportedSchema');
  const applicationVersion = typeof document.applicationVersion === 'string'
    ? document.applicationVersion
    : legacySchema && typeof document.version === 'string' ? document.version : null;
  if (!applicationVersion || typeof document.exportedAt !== 'string') throw new BackupValidationError('backup.metadataIncomplete');
  const scope = document.scope === 'all' || document.scope === 'active' ? document.scope : legacySchema ? 'all' : null;
  if (!scope) throw new BackupValidationError('backup.invalidRoot');
  if (!Array.isArray(document.positions)) throw new BackupValidationError('backup.invalidRoot');
  const positions = document.positions.map(validateBackupPosition);
  const scenarios = Array.isArray(document.scenarios) ? document.scenarios.map(validateBackupScenario) : [];
  const comparisonScenarioIds = Array.isArray(document.comparisonScenarioIds)
    ? document.comparisonScenarioIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (document.activeHoldingId !== undefined && typeof document.activeHoldingId !== 'string') throw new BackupValidationError('backup.invalidRoot');
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
