import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export const AppEnv = {
  powersyncUrl: String(extra.powersyncUrl ?? '').trim(),
  cactusApiKey: String(extra.cactusApiKey ?? '').trim(),
  supabaseUrl: String(extra.supabaseUrl ?? '').trim(),
  supabaseAnonKey: String(extra.supabaseAnonKey ?? '').trim(),
  supabaseBucket: String(extra.supabaseBucket ?? 'files').trim() || 'files'
};

export const requiredEnvKeys = ['powersyncUrl', 'supabaseUrl', 'supabaseAnonKey'];

export const missingRequiredEnvKeys = requiredEnvKeys.filter((key) => !AppEnv[key]);
