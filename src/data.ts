import type { FeeMode, TransactionType } from './calculator';

export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const APP_VERSION = '1.6.0';

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

export function createBackup(positions: BackupPosition[], activeHoldingId: string | undefined, scope: BackupScope, exportedAt = new Date().toISOString()): BackupDocument {
  return {
    application: 'Average Price Planner',
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    applicationVersion: APP_VERSION,
    exportedAt,
    scope,
    ...(scope === 'all' && activeHoldingId ? { activeHoldingId } : {}),
    positions: positions.map((position) => validateBackupPosition(position)),
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
  const legacySchema = document.backupSchemaVersion === 0;
  if (document.backupSchemaVersion !== BACKUP_SCHEMA_VERSION && !legacySchema) throw new Error('Import rejected: unsupported backup schema version.');
  const applicationVersion = typeof document.applicationVersion === 'string'
    ? document.applicationVersion
    : legacySchema && typeof document.version === 'string' ? document.version : null;
  if (!applicationVersion || typeof document.exportedAt !== 'string') throw new Error('Import rejected: backup metadata is incomplete.');
  const scope = document.scope === 'all' || document.scope === 'active' ? document.scope : legacySchema ? 'all' : null;
  if (!scope) throw new Error('Import rejected: backup scope is invalid.');
  if (!Array.isArray(document.positions)) throw new Error('Import rejected: positions must be a list.');
  const positions = document.positions.map(validateBackupPosition);
  if (document.activeHoldingId !== undefined && typeof document.activeHoldingId !== 'string') throw new Error('Import rejected: active position identifier is invalid.');
  return {
    application: 'Average Price Planner',
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    applicationVersion,
    exportedAt: document.exportedAt,
    scope,
    ...(typeof document.activeHoldingId === 'string' ? { activeHoldingId: document.activeHoldingId } : {}),
    positions,
  };
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
