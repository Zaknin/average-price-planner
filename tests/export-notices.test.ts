// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { formatBackupExportNotice, formatImportCompletionNotice, formatPlanCsvExportNotice } from '../src/notices';

afterEach(() => setLocale('en'));

describe('export and import completion notices', () => {
  it('formats complete Russian backup count phrases without repeated headings', () => {
    setLocale('ru');
    for (const [positions, scenarios, expected] of [
      [0, 0, 'Резервная копия сохранена в JSON-файл. Содержимое: 0 позиций; 0 сценариев.'],
      [1, 1, 'Резервная копия сохранена в JSON-файл. Содержимое: 1 позиция; 1 сценарий.'],
      [2, 2, 'Резервная копия сохранена в JSON-файл. Содержимое: 2 позиции; 2 сценария.'],
      [5, 5, 'Резервная копия сохранена в JSON-файл. Содержимое: 5 позиций; 5 сценариев.'],
      [21, 21, 'Резервная копия сохранена в JSON-файл. Содержимое: 21 позиция; 21 сценарий.'],
      [1, 5, 'Резервная копия сохранена в JSON-файл. Содержимое: 1 позиция; 5 сценариев.'],
      [21, 2, 'Резервная копия сохранена в JSON-файл. Содержимое: 21 позиция; 2 сценария.'],
    ] as Array<[number, number, string]>) {
      const notice = formatBackupExportNotice(positions, scenarios);
      expect(notice).toBe(expected);
      expect(notice).not.toMatch(/позиций:|сценариев:/);
    }
  });

  it('formats Russian plan CSV completion with one complete operation phrase', () => {
    setLocale('ru');
    expect(formatPlanCsvExportNotice(1)).toBe('План экспортирован в CSV. Экспортировано: 1 операция плана.');
    expect(formatPlanCsvExportNotice(2)).toBe('План экспортирован в CSV. Экспортировано: 2 операции плана.');
    expect(formatPlanCsvExportNotice(5)).toBe('План экспортирован в CSV. Экспортировано: 5 операций плана.');
    expect(formatPlanCsvExportNotice(21)).toBe('План экспортирован в CSV. Экспортировано: 21 операция плана.');
    expect(formatPlanCsvExportNotice(21)).not.toContain('операций плана:');
    expect(formatPlanCsvExportNotice(21)).not.toContain('Экспортировано запланированных операций');
  });

  it('formats Russian import completion for zero, matching, and mixed counts', () => {
    setLocale('ru');
    for (const [positions, transactions, scenarios, expected] of [
      [0, 0, 0, 'Импорт завершён: 0 позиций; 0 операций плана; 0 сценариев.'],
      [1, 1, 1, 'Импорт завершён: 1 позиция; 1 операция плана; 1 сценарий.'],
      [2, 2, 2, 'Импорт завершён: 2 позиции; 2 операции плана; 2 сценария.'],
      [5, 5, 5, 'Импорт завершён: 5 позиций; 5 операций плана; 5 сценариев.'],
      [21, 21, 21, 'Импорт завершён: 21 позиция; 21 операция плана; 21 сценарий.'],
      [1, 5, 21, 'Импорт завершён: 1 позиция; 5 операций плана; 21 сценарий.'],
      [21, 1, 2, 'Импорт завершён: 21 позиция; 1 операция плана; 2 сценария.'],
    ] as Array<[number, number, number, string]>) {
      const notice = formatImportCompletionNotice(positions, transactions, scenarios);
      expect(notice).toBe(expected);
      expect(notice).not.toMatch(/Импортировано позиций:|операций плана:|сценариев:/);
    }
  });

  it('keeps English completion notices natural for singular and plural counts', () => {
    setLocale('en');
    expect(formatBackupExportNotice(1, 2)).toBe('Saved a JSON backup file with 1 position and 2 scenarios.');
    expect(formatPlanCsvExportNotice(1)).toBe('Exported 1 plan transaction as CSV.');
    expect(formatPlanCsvExportNotice(2)).toBe('Exported 2 plan transactions as CSV.');
    expect(formatImportCompletionNotice(1, 2, 1)).toBe('Imported 1 position, 2 plan transactions, and 1 scenario.');
  });
});
