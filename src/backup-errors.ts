import { isBackupValidationError, type BackupValidationErrorCode } from './data';
import { t } from './i18n';
import type { TranslationKey } from './locales/en';

const messageKeys: Record<BackupValidationErrorCode, TranslationKey> = {
  'backup.invalidJson': 'backupInvalidJson',
  'backup.invalidRoot': 'backupInvalidRoot',
  'backup.metadataIncomplete': 'backupMetadataIncomplete',
  'backup.unsupportedSchema': 'backupUnsupportedSchema',
  'backup.unsafeObjectKey': 'backupUnsafeObjectKey',
  'backup.invalidPosition': 'backupInvalidPosition',
  'backup.invalidScenario': 'backupInvalidScenario',
  'backup.invalidTransaction': 'backupInvalidTransaction',
  'backup.invalidTransactionType': 'backupInvalidTransactionType',
  'backup.invalidNumericValue': 'backupInvalidNumericValue',
  'backup.fileTooLarge': 'backupFileTooLarge',
};

/** Translates stable data-layer validation errors without exposing raw diagnostics. */
export function backupImportMessage(error: unknown): string {
  if (!isBackupValidationError(error)) return t('backupUnknown');
  return t(messageKeys[error.code], error.values);
}
