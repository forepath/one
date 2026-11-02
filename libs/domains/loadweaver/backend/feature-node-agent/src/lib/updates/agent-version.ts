/** Baked in at build time (webpack DefinePlugin: the release's `VERSION`); undefined in tests and `tsc` builds. */
declare const LOADWEAVER_AGENT_BUILD_VERSION: string | undefined;

/**
 * This agent's version (3.26): the release it was built for. The environment may override it for development; the
 * update rollout compares it with the release manifest's `node-agent` version.
 */
export const AGENT_VERSION =
  process.env['LOADWEAVER_AGENT_VERSION'] ||
  (typeof LOADWEAVER_AGENT_BUILD_VERSION === 'string' ? LOADWEAVER_AGENT_BUILD_VERSION : '0.0.0');
