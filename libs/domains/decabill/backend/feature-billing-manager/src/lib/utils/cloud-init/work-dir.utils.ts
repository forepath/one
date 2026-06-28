export const CLOUD_INIT_WORK_DIR_PATTERN = /^\/opt\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export const DEFAULT_CLOUD_INIT_WORK_DIR = '/opt/custom-app';

export function normalizeCloudInitWorkDir(workDir?: string | null): string {
  const trimmed = workDir?.trim();

  return trimmed || DEFAULT_CLOUD_INIT_WORK_DIR;
}

export function validateCloudInitWorkDir(workDir?: string | null): string {
  const normalized = normalizeCloudInitWorkDir(workDir);

  if (!CLOUD_INIT_WORK_DIR_PATTERN.test(normalized)) {
    throw new Error(
      `workDir must be an absolute path under /opt with alphanumeric segments (pattern: ${CLOUD_INIT_WORK_DIR_PATTERN.source})`,
    );
  }

  return normalized;
}

export function quoteShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
