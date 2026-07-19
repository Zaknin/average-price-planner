import { en, type TranslationKey } from './locales/en';
import { ru } from './locales/ru';

export type Locale = 'en' | 'ru';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'average-price-planner:locale';

const messages: Record<Locale, Record<TranslationKey, string>> = { en, ru };
let locale: Locale = DEFAULT_LOCALE;

function validLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
  return locale;
}

export function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return validLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function applyDocumentLocale(): void {
  document.documentElement.lang = locale;
  document.title = t('documentTitle');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('documentDescription'));
}

export function setLocale(nextLocale: Locale): void {
  locale = validLocale(nextLocale) ? nextLocale : DEFAULT_LOCALE;
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Preference persistence is optional. */ }
  applyDocumentLocale();
}

export function initializeLocale(): Locale {
  locale = readLocale();
  applyDocumentLocale();
  return locale;
}

export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  const template = messages[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export function plural(count: number, one: string, few: string, many: string): string {
  const category = new Intl.PluralRules(locale).select(Math.abs(count));
  if (category === 'one') return one;
  if (category === 'few') return few;
  return many;
}

export function countPhrase(value: number, one: string, few: string, many: string, fractional = few): string {
  const formatted = formatNumber(value);
  return `${formatted} ${Number.isInteger(value) ? plural(value, one, few, many) : fractional}`;
}

export function positionCountPhrase(value: number): string {
  return locale === 'ru'
    ? countPhrase(value, 'позиция', 'позиции', 'позиций')
    : countPhrase(value, 'position', 'positions', 'positions');
}

export function planOperationCountPhrase(value: number): string {
  return locale === 'ru'
    ? countPhrase(value, 'операция плана', 'операции плана', 'операций плана')
    : countPhrase(value, 'plan transaction', 'plan transactions', 'plan transactions');
}

export function scenarioCountPhrase(value: number): string {
  return locale === 'ru'
    ? countPhrase(value, 'сценарий', 'сценария', 'сценариев')
    : countPhrase(value, 'scenario', 'scenarios', 'scenarios');
}

export function formatNumber(value: number, maximumFractionDigits = 4): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value) : '—';
}

export function formatQuantity(value: number, maximumFractionDigits = 4): string {
  return formatNumber(value, maximumFractionDigits);
}

export function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—';
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 4 }).format(value); }
  catch { return `${currency || '$'} ${value.toFixed(4)}`; }
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: fractionDigits }).format(value / 100) : '—';
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** Parses user-entered decimal values without introducing locale formatting into stored data. */
export function parseLocalizedDecimal(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  const normalized = locale === 'ru' && /^[-+]?\d+(?:,\d+)?$/.test(value)
    ? value.replace(',', '.')
    : value;
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
