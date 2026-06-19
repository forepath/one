export function readExtensionsFromEnv(envKey: string, defaults: readonly string[]): string[] {
  const raw = process.env[envKey];

  if (!raw || raw.trim().length === 0) {
    return [...defaults];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
