import * as fs from 'fs';

export type EnvValues = Record<string, string>;

/**
 * Parses a dotenv-style file (the format Nx loads for `.start-containers.env`).
 * Supports comments, `export` prefixes and single/double quoted values.
 */
export function parseEnvFile(content: string): EnvValues {
  const values: EnvValues = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = withoutExport.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    let value = withoutExport.slice(separatorIndex + 1).trim();
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);

      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } else {
      // Unquoted values may carry trailing inline comments (`KEY=value # comment`).
      value = value.replace(/\s+#.*$/, '');
    }

    values[key] = value;
  }

  return values;
}

/**
 * Loads an env file; returns an empty object when the file does not exist so that compose
 * defaults (passed as `defaults`) still apply.
 */
export function loadEnvFile(filePath: string, defaults: EnvValues = {}): EnvValues {
  if (!fs.existsSync(filePath)) {
    return { ...defaults };
  }

  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  const merged: EnvValues = { ...defaults };

  for (const [key, value] of Object.entries(parsed)) {
    // Compose uses `${VAR:-default}`: an empty value falls back to the default.
    if (value !== '' || !(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

export function readBooleanEnv(env: EnvValues, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  return value === 'true' || value === '1' || value === 'yes';
}

export function readListEnv(env: EnvValues, key: string): string[] {
  return (env[key] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
