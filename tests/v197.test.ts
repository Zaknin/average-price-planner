// @vitest-environment jsdom
import packageJson from '../package.json';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { backupImportMessage } from '../src/backup-errors';
import { APP_VERSION } from '../src/version';
import { BACKUP_SCHEMA_VERSION, BackupValidationError, createBackup, parseBackupJson } from '../src/data';
import { displayScenarioName } from '../src/scenario-display';
import { renderHelp } from '../src/help';
import { setLocale } from '../src/i18n';

const position = { id: 'p1', baseShares: 10, baseAverage: 20, transactions: [] };
const validBackup = () => createBackup([position], 'p1', 'all', '2026-07-19T00:00:00.000Z');

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BackupValidationError);
    return (error as BackupValidationError).code;
  }
  throw new Error('Expected backup validation to fail.');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  setLocale('en');
});

describe('v1.9.7 backup metadata and localized diagnostics', () => {
  it('uses the build-time package version while retaining backup schema v2 and old-backup compatibility', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION).toBe('1.9.7');
    const backup = validBackup();
    expect(backup.applicationVersion).toBe(APP_VERSION);
    expect(backup.backupSchemaVersion).toBe(2);
    expect(BACKUP_SCHEMA_VERSION).toBe(2);
    expect(parseBackupJson(JSON.stringify({ ...backup, applicationVersion: '1.6.0' })).applicationVersion).toBe('1.6.0');
  });

  it('returns stable validation codes for each detailed backup failure', () => {
    expect(errorCode(() => parseBackupJson('not json'))).toBe('backup.invalidJson');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ application: 'Other' })))).toBe('backup.invalidRoot');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), exportedAt: undefined })))).toBe('backup.metadataIncomplete');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), backupSchemaVersion: 99 })))).toBe('backup.unsupportedSchema');
    expect(errorCode(() => parseBackupJson('{"application":"Average Price Planner","backupSchemaVersion":2,"applicationVersion":"1.9.7","exportedAt":"now","scope":"all","__proto__":{},"positions":[]}'))).toBe('backup.unsafeObjectKey');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), positions: [{ ...position, id: '' }] })))).toBe('backup.invalidPosition');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), positions: [{ ...position, baseShares: -1 }] })))).toBe('backup.invalidNumericValue');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), scenarios: [{ id: 's1', holdingId: 'p1', name: 1, basePosition: { shares: 1, averagePrice: 1 } }] })))).toBe('backup.invalidScenario');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), positions: [{ ...position, transactions: [null] }] })))).toBe('backup.invalidTransaction');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), positions: [{ ...position, transactions: [{}] }] })))).toBe('backup.invalidTransactionType');
    expect(errorCode(() => parseBackupJson(JSON.stringify({ ...validBackup(), positions: [{ ...position, transactions: [{ type: 'buy', shares: -1, price: 1 }] }] })))).toBe('backup.invalidNumericValue');
    expect(errorCode(() => parseBackupJson('x'.repeat(5 * 1024 * 1024 + 1)))).toBe('backup.fileTooLarge');
  });

  it('renders specific English and Russian backup errors without raw codes or source text', () => {
    const typeError = new BackupValidationError('backup.invalidTransactionType', { index: 2 });
    expect(backupImportMessage(typeError)).toBe('Import rejected: transaction 2 has an unsupported type.');
    setLocale('ru');
    expect(backupImportMessage(typeError)).toBe('Импорт отклонён: у сделки 2 указан неподдерживаемый тип.');
    expect(backupImportMessage(new BackupValidationError('backup.invalidJson'))).toBe('Не удалось прочитать JSON-файл.');
    expect(backupImportMessage(new Error('Import rejected: unsafe object key.'))).toBe('Не удалось импортировать резервную копию.');
  });

  it('provides a localized message for every stable backup-validation code', () => {
    const cases: Array<[ConstructorParameters<typeof BackupValidationError>[0], string, string]> = [
      ['backup.invalidJson', 'The JSON file could not be read.', 'Не удалось прочитать JSON-файл.'],
      ['backup.invalidRoot', 'This file is not a valid application backup.', 'Файл не содержит корректную резервную копию приложения.'],
      ['backup.metadataIncomplete', 'The backup is missing required metadata.', 'В резервной копии отсутствуют обязательные служебные данные.'],
      ['backup.unsupportedSchema', 'This backup schema version is not supported.', 'Эта версия схемы резервной копии не поддерживается.'],
      ['backup.unsafeObjectKey', 'Import rejected: the file contains an unsafe property name.', 'Импорт отклонён: файл содержит недопустимое имя свойства.'],
      ['backup.invalidPosition', 'Import rejected: one position contains invalid data.', 'Импорт отклонён: одна из позиций содержит некорректные данные.'],
      ['backup.invalidScenario', 'Import rejected: one scenario contains invalid data.', 'Импорт отклонён: один из сценариев содержит некорректные данные.'],
      ['backup.invalidTransaction', 'Import rejected: one transaction contains invalid data.', 'Импорт отклонён: одна из сделок содержит некорректные данные.'],
      ['backup.invalidTransactionType', 'Import rejected: transaction {index} has an unsupported type.', 'Импорт отклонён: у сделки {index} указан неподдерживаемый тип.'],
      ['backup.invalidNumericValue', 'Import rejected: the file contains an invalid numeric value.', 'Импорт отклонён: файл содержит некорректное числовое значение.'],
      ['backup.fileTooLarge', 'The backup file is too large.', 'Файл резервной копии слишком большой.'],
    ];
    for (const [code, english, russian] of cases) {
      expect(backupImportMessage(new BackupValidationError(code, { index: 2 }))).toBe(english.replace('{index}', '2'));
      setLocale('ru');
      const localized = backupImportMessage(new BackupValidationError(code, { index: 2 }));
      expect(localized).toBe(russian.replace('{index}', '2'));
      expect(localized).not.toContain(code);
      setLocale('en');
    }
  });
});

describe('v1.9.7 scenario fallback and language-selector accessibility', () => {
  it('localizes only an empty scenario display name without changing user data', () => {
    const emptyName = '';
    const userName = 'Untitled scenario';
    expect(displayScenarioName(emptyName)).toBe('Untitled scenario');
    expect(displayScenarioName(userName)).toBe(userName);
    setLocale('ru');
    expect(displayScenarioName(emptyName)).toBe('Сценарий без названия');
    expect(displayScenarioName(userName)).toBe(userName);
    expect(emptyName).toBe('');
  });

  it('renders the shared version and selected language state in the Help header', () => {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    const changeLocale = (locale: 'en' | 'ru'): void => { setLocale(locale); renderHelp(app, 'home', { backToCalculator: vi.fn(), changeLocale }); };
    renderHelp(app, 'home', { backToCalculator: vi.fn(), changeLocale });
    expect(app.querySelector('.release-tag')?.textContent).toBe(`v${APP_VERSION}`);
    expect(app.querySelector('.locale-control')?.getAttribute('aria-label')).toBe('Language / Язык');
    expect(app.querySelector('[data-locale="en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(app.querySelector('[data-locale="ru"]')?.getAttribute('aria-pressed')).toBe('false');
    const russian = app.querySelector<HTMLButtonElement>('[data-locale="ru"]')!;
    russian.focus();
    russian.click();
    expect(document.documentElement.lang).toBe('ru');
    expect(app.querySelector('[data-locale="en"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(app.querySelector('[data-locale="ru"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(app.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });
});
