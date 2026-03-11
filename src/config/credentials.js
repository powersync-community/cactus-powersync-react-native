/**
 * Runtime credential storage — persists Supabase / PowerSync credentials
 * entered by the user so the app can connect without a baked-in .env.local.
 */
import * as FileSystem from 'expo-file-system/legacy';

const CREDS_FILE = `${FileSystem.documentDirectory}runtime-credentials.json`;

/**
 * Load previously-saved runtime credentials.
 * Returns null if none have been saved yet.
 */
export const loadCredentials = async () => {
  try {
    const info = await FileSystem.getInfoAsync(CREDS_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(CREDS_FILE);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Persist credentials to the device file system.
 * @param {{ supabaseUrl, supabaseAnonKey, powersyncUrl, cactusApiKey? }} creds
 */
export const saveCredentials = async (creds) => {
  await FileSystem.writeAsStringAsync(CREDS_FILE, JSON.stringify(creds));
};

/** Remove saved credentials (forces the settings screen on next launch). */
export const clearCredentials = async () => {
  await FileSystem.deleteAsync(CREDS_FILE, { idempotent: true }).catch(() => {});
};

// ---------------------------------------------------------------------------
// Model preferences
// ---------------------------------------------------------------------------

const PREFS_FILE = `${FileSystem.documentDirectory}model-preferences.json`;

/** Load persisted model selection. Returns null if none saved yet. */
export const loadModelPrefs = async () => {
  try {
    const info = await FileSystem.getInfoAsync(PREFS_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(PREFS_FILE);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Persist model selection to the device file system. */
export const saveModelPrefs = async ({ llmModel, sttModel }) => {
  await FileSystem.writeAsStringAsync(PREFS_FILE, JSON.stringify({ llmModel, sttModel }));
};
