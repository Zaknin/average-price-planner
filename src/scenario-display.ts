import { t } from './i18n';

/** Leaves stored user data untouched and localizes only an empty display name. */
export function displayScenarioName(name: string): string {
  return name.trim() || t('untitledScenario');
}
