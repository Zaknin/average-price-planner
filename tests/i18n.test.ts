// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, getLocale, initializeLocale, parseLocalizedDecimal, plural, setLocale, t } from '../src/i18n';

beforeEach(() => {
  localStorage.clear();
  setLocale('en');
});

describe('localization preferences and formatting', () => {
  it('defaults invalid or missing preferences to English without touching portfolio data', () => {
    localStorage.setItem('average-down-optimizer:v2', '{"version":4}');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'unsupported');
    expect(initializeLocale()).toBe(DEFAULT_LOCALE);
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem('average-down-optimizer:v2')).toBe('{"version":4}');
  });

  it('persists Russian separately and updates document metadata', () => {
    setLocale('ru');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Планировщик средней цены');
    expect(t('helpCenter')).toBe('Справочный центр');
  });

  it('uses Intl formatting and Russian plural forms', () => {
    setLocale('ru');
    expect(formatNumber(1234.5)).toMatch(/1[\s\u00a0\u202f]234,5/);
    expect(formatCurrency(12.5, 'USD')).toContain('$');
    expect(formatPercent(12.5)).toContain('%');
    expect(formatDate('2026-07-18')).toBeTruthy();
    expect(formatDateTime('2026-07-18T12:34:00Z')).toBeTruthy();
    expect(plural(1, 'строка', 'строки', 'строк')).toBe('строка');
    expect(plural(2, 'строка', 'строки', 'строк')).toBe('строки');
    expect(plural(5, 'строка', 'строки', 'строк')).toBe('строк');
  });

  it('accepts a Russian decimal comma without accepting ambiguous separators', () => {
    setLocale('ru');
    expect(parseLocalizedDecimal('0,2')).toBe(0.2);
    expect(parseLocalizedDecimal('0.2')).toBe(0.2);
    expect(parseLocalizedDecimal('1,2,3')).toBeNull();
    expect(parseLocalizedDecimal('1.2.3')).toBeNull();
    expect(parseLocalizedDecimal('1,000.50')).toBeNull();
    expect(parseLocalizedDecimal('1.000,50')).toBeNull();
  });
});
