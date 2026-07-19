import { planOperationCountPhrase, positionCountPhrase, scenarioCountPhrase, t } from './i18n';

export function formatBackupExportNotice(positionCount: number, scenarioCount: number): string {
  return t('exportedBackup', {
    positions: positionCountPhrase(positionCount),
    scenarios: scenarioCountPhrase(scenarioCount),
  });
}

export function formatPlanCsvExportNotice(operationCount: number): string {
  return t('exportedPlanCsv', { rows: planOperationCountPhrase(operationCount) });
}

export function formatImportCompletionNotice(positionCount: number, transactionCount: number, scenarioCount: number): string {
  return t('importedData', {
    positions: positionCountPhrase(positionCount),
    transactions: planOperationCountPhrase(transactionCount),
    scenarios: scenarioCountPhrase(scenarioCount),
  });
}
