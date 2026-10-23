import { Resolver } from 'node:dns/promises';

/** Answers of one authoritative server for a name (A and AAAA), or null when it doesn't answer. */
export type AuthoritativeQuery = (server: string, host: string) => Promise<string[] | null>;

export const queryAuthoritative: AuthoritativeQuery = async (server, host) => {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });

  resolver.setServers([server]);

  const [v4, v6] = await Promise.all([
    resolver.resolve4(host).catch(() => [] as string[]),
    resolver.resolve6(host).catch(() => [] as string[]),
  ]);

  return v4.length + v6.length > 0 ? [...v4, ...v6].sort() : null;
};

/**
 * Whether every authoritative server answers the expected addresses (3.28: a switch counts as done only then).
 * Retries until the deadline; returns the servers still lagging.
 */
export async function verifyPropagation(
  host: string,
  expected: readonly string[],
  servers: readonly string[],
  query: AuthoritativeQuery = queryAuthoritative,
  options: { timeoutMs?: number; intervalMs?: number; subset?: boolean } = {},
): Promise<{ done: boolean; lagging: string[] }> {
  const want = [...expected].sort().join(',');
  // Steered answers differ per client: then any non-empty part of the expected set is right.
  const matches = (answer: string[] | null | undefined) =>
    options.subset ? !!answer?.length && answer.every((a) => expected.includes(a)) : answer?.join(',') === want;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let lagging = [...servers];

  for (;;) {
    const results = await Promise.all(
      lagging.map(async (s) => ({ s, answer: await query(s, host).catch(() => null) })),
    );

    lagging = results.filter((r) => !matches(r.answer)).map((r) => r.s);

    if (lagging.length === 0 || Date.now() >= deadline) return { done: lagging.length === 0, lagging };

    await new Promise((r) => setTimeout(r, options.intervalMs ?? 10_000));
  }
}

/** A server's SOA serial for a zone, or null when it doesn't answer for it. */
export type SoaQuery = (server: string, zone: string) => Promise<number | null>;

export const querySoaSerial: SoaQuery = async (server, zone) => {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });

  resolver.setServers([server]);

  return (await resolver.resolveSoa(zone).catch(() => null))?.serial ?? null;
};

/** RFC 1982: whether serial a is behind b. */
export function serialBehind(a: number, b: number): boolean {
  const diff = (b - a + 2 ** 32) % 2 ** 32;

  return diff !== 0 && diff < 2 ** 31;
}

/**
 * How far secondaries are behind their primary (3.15: the plan warns when a secondary drifted): null when every one
 * answers the primary's serial (or a newer one, mid-transfer), else which are behind or silent.
 */
export async function secondaryDrift(
  zone: string,
  primaries: readonly string[],
  secondaries: readonly string[],
  query: SoaQuery = querySoaSerial,
): Promise<string | null> {
  const reference = (await Promise.all(primaries.map((s) => query(s, zone).catch(() => null)))).filter(
    (s): s is number => s !== null,
  );

  if (reference.length === 0) return `no primary answered for ${zone}`;

  const newest = reference.reduce((a, b) => (serialBehind(a, b) ? b : a));
  const lagging: string[] = [];

  for (const server of secondaries) {
    const serial = await query(server, zone).catch(() => null);

    if (serial === null) lagging.push(`${server} does not answer`);
    else if (serialBehind(serial, newest)) lagging.push(`${server} at serial ${serial}, primary at ${newest}`);
  }

  return lagging.length > 0 ? lagging.join('; ') : null;
}
