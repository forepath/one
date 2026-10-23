/** `8080` or `15432:5432` → local and remote port. */
export function parsePortMapping(value: string): { local: number; remote: number } {
  const match = /^(?:(\d{1,5}):)?(\d{1,5})$/.exec(value);
  const remote = Number(match?.[2]);
  const local = match?.[1] ? Number(match[1]) : remote;

  if (!match || remote < 1 || remote > 65535 || local < 1 || local > 65535)
    throw new Error(`invalid port mapping ${value}`);

  return { local, remote };
}

/** `project/deployment/service` (first replica) or a replica id `project/deployment/service/2`. */
export function parseReplica(value: string): string {
  if (/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/.test(value)) return value;

  if (/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/.test(value)) return `${value}/0`;

  throw new Error(`expected project/deployment/service[/replica], got ${value}`);
}

/** One progress line for `--watch` (Agenstra's step + %). */
export function progressLine(plan: {
  id: string;
  status: string;
  progress?: { step?: string; percent?: number } | null;
}): string {
  const percent = plan.progress?.percent;

  return `${plan.id.slice(0, 8)}  ${plan.status.padEnd(15)} ${percent !== undefined ? `${String(percent).padStart(3)} %  ` : ''}${plan.progress?.step ?? ''}`.trimEnd();
}

export const FINAL_STATUSES = new Set(['applied', 'failed', 'rolled-back', 'rollback-failed', 'discarded']);

/** The wg-quick configuration with the device's private key, which never left the device. */
export function withPrivateKey(config: string, privateKey: string): string {
  if (!/^\[Interface\]/m.test(config)) throw new Error('unexpected VPN configuration');

  return config.replace(/^\[Interface\]\s*$/m, `[Interface]\nPrivateKey = ${privateKey}`);
}

/**
 * Whether a bearer token is a personal access token: an app-signed JWT whose `amr` claim includes `pat`. The
 * control plane's sockets refuse those (interactive sessions only).
 */
export function isPersonalAccessToken(token: string): boolean {
  const payload = token.split('.')[1];

  if (!payload) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { amr?: unknown };

    return Array.isArray(claims.amr) && claims.amr.includes('pat');
  } catch {
    return false;
  }
}

/** The identity backend's 401 when the account needs a second factor: `{ message, code: 'LOGIN_2FA_REQUIRED', method }`. */
export const LOGIN_2FA_REQUIRED_CODE = 'LOGIN_2FA_REQUIRED';

export function isLogin2faRequired(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === LOGIN_2FA_REQUIRED_CODE;
}
