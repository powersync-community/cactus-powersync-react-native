import * as FileSystem from 'expo-file-system/legacy';
import { createClient } from '@supabase/supabase-js';
import { AppEnv } from '../config/env';

const storageDir = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}supabase-auth/`
  : null;

const ensureStorageDir = async () => {
  if (storageDir) {
    await FileSystem.makeDirectoryAsync(storageDir, { intermediates: true }).catch(() => {});
  }
};

const fileSystemStorage = {
  async getItem(key) {
    if (!storageDir) return null;
    const path = `${storageDir}${encodeURIComponent(key)}`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(path);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    if (!storageDir) return;
    await ensureStorageDir();
    const path = `${storageDir}${encodeURIComponent(key)}`;
    await FileSystem.writeAsStringAsync(path, value);
  },
  async removeItem(key) {
    if (!storageDir) return;
    const path = `${storageDir}${encodeURIComponent(key)}`;
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
};

export const createSupabaseClient = (env = AppEnv) => {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: fileSystemStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
};
