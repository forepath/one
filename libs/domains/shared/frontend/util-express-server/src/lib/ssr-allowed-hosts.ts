const LOCAL_DEV_HOSTS = ['localhost', '127.0.0.1'] as const;

/**
 * Builds the hostname allowlist for Angular SSR {@link CommonEngine}.
 * Includes local dev hosts plus each apex domain and its subdomains (`*.example.com`).
 */
export function buildSsrAllowedHosts(apexDomains: readonly string[]): string[] {
  const hosts = new Set<string>(LOCAL_DEV_HOSTS);

  for (const domain of apexDomains) {
    hosts.add(domain);
    hosts.add(`*.${domain}`);
  }

  return [...hosts];
}
