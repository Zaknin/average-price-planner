import packageJson from '../package.json';

/** Build-time application version shared by UI and backup metadata. */
export const APP_VERSION: string = packageJson.version;
