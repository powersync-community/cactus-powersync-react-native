const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

const parseEnvFile = (content) => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key.length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});
};

const readEnvFile = (filename) => {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
};

module.exports = () => {
  const env = {
    ...readEnvFile('.env'),
    ...readEnvFile('.env.local'),
    ...process.env
  };

  const baseExpo = appJson.expo ?? {};

  return {
    ...appJson,
    expo: {
      ...baseExpo,
      extra: {
        ...baseExpo.extra,
        powersyncUrl: env.POWERSYNC_URL ?? env.EXPO_PUBLIC_POWERSYNC_URL ?? '',
        cactusApiKey: env.CACTUS_API_KEY ?? env.EXPO_PUBLIC_CACTUS_API_KEY ?? '',
        supabaseUrl: env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '',
        supabaseAnonKey: env.SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        supabaseBucket: env.SUPABASE_BUCKET ?? env.EXPO_PUBLIC_SUPABASE_BUCKET ?? 'files'
      }
    }
  };
};
