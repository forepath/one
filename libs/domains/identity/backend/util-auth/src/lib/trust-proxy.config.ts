/**
 * Express `trust proxy` setting from `TRUST_PROXY` (opt-in). Behind a reverse proxy, rate limits (login, SAML,
 * PAT exchange, …) otherwise key on the proxy's address, so one client can exhaust them for everybody.
 *
 * - unset / empty / `false` → not trusted (default; `X-Forwarded-For` is ignored)
 * - a number → number of trusted proxy hops (e.g. `1` for one nginx in front)
 * - anything else → passed to Express as is (e.g. `loopback`, `uniquelocal`, or a comma-separated list of addresses)
 *
 * Only enable it when the API is reachable exclusively through the proxy; otherwise clients can spoof their address.
 * Prefer address-based values (`uniquelocal`, the proxy's address / docker subnet) over hop counts when the API port
 * is also published directly: a hop count trusts whichever peer connects.
 */
export function resolveTrustProxySetting(
  raw: string | undefined = process.env.TRUST_PROXY,
): number | string | undefined {
  const value = raw?.trim();

  if (!value || value.toLowerCase() === 'false') {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  if (value.toLowerCase() === 'true') {
    // `true` would trust every hop (client controls the left-most X-Forwarded-For entry) — treat as one proxy hop.
    return 1;
  }

  return value;
}

/** Applies {@link resolveTrustProxySetting} to an Express instance (`app.getHttpAdapter().getInstance()`). */
export function configureTrustProxy(expressApp: { set(setting: string, value: unknown): unknown }): void {
  const setting = resolveTrustProxySetting();

  if (setting !== undefined) {
    expressApp.set('trust proxy', setting);
  }
}
