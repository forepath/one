/**
 * Opt-in Express `trust proxy` for a TLS proxy on the same host (Loadweaver Cloud: nginx → 127.0.0.1:3400).
 * Without it, every client appears as `127.0.0.1` and shares one throttler bucket. Only `loopback` is accepted:
 * `X-Forwarded-For` is then honoured only from loopback peers, so remote clients cannot spoof their address.
 */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): 'loopback' | undefined {
  const value = env['LOADWEAVER_TRUST_PROXY']?.trim().toLowerCase();

  if (!value) return undefined;

  if (value !== 'loopback') {
    throw new Error(`LOADWEAVER_TRUST_PROXY must be 'loopback' or unset (got '${env['LOADWEAVER_TRUST_PROXY']}')`);
  }

  return 'loopback';
}
