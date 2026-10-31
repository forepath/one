import { PATRONI_PORT, urlHost } from '../control-plane/control-plane-containers';

/**
 * Patroni on this member (3.26: replicas first, then a switchover, then the old leader). The REST API listens on the
 * member's overlay address, reachable only by members (built-in quorum policy).
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PostgresRole = 'leader' | 'replica' | 'unknown';

export async function patroniRole(address: string, fetchImpl: FetchLike = fetch): Promise<PostgresRole> {
  try {
    const res = await fetchImpl(`http://${urlHost(address)}:${PATRONI_PORT}/patroni`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!res.ok && res.status !== 503) return 'unknown';

    const role = ((await res.json()) as { role?: string }).role;

    return role === 'master' || role === 'primary'
      ? 'leader'
      : role === 'replica' || role === 'standby_leader'
        ? 'replica'
        : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Replication lag (bytes) of this member as Patroni's `/cluster` reports it; undefined when unknown or the leader. */
export async function patroniLag(address: string, fetchImpl: FetchLike = fetch): Promise<number | undefined> {
  try {
    const res = await fetchImpl(`http://${urlHost(address)}:${PATRONI_PORT}/cluster`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!res.ok) return undefined;

    const members = ((await res.json()) as { members?: { host?: string; role?: string; lag?: unknown }[] }).members;
    const self = members?.find((m) => m.host === address);

    return typeof self?.lag === 'number' && Number.isFinite(self.lag) && self.lag >= 0
      ? Math.round(self.lag)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hands the leader role to the member at `candidate` (its overlay address) and waits until this member is a replica.
 * Nothing to do when this member is a replica. An unknown role (Patroni not answering) is retried and then an error:
 * the caller must never update a member's database container on a role it couldn't establish (M6 review M2).
 */
export async function patroniSwitchover(
  address: string,
  candidate: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 60_000,
  retryDelayMs = 2_000,
): Promise<void> {
  let role = await patroniRole(address, fetchImpl);

  for (let attempt = 1; role === 'unknown' && attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    role = await patroniRole(address, fetchImpl);
  }

  if (role === 'unknown') throw new Error('the Patroni role of this member is unknown (Patroni does not answer)');

  if (role !== 'leader') return;

  const base = `http://${urlHost(address)}:${PATRONI_PORT}`;
  const cluster = (await (await fetchImpl(`${base}/cluster`, { signal: AbortSignal.timeout(5_000) })).json()) as {
    members?: { name: string; host?: string; role?: string }[];
  };
  const members = cluster.members ?? [];
  const leader = members.find((m) => m.role === 'leader' || m.role === 'master' || m.role === 'primary');
  const target = members.find((m) => m.host === candidate);

  if (!leader || !target) throw new Error(`switchover candidate ${candidate} is not a Patroni member`);

  const res = await fetchImpl(`${base}/switchover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leader: leader.name, candidate: target.name }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Patroni refused the switchover (${res.status}): ${(await res.text()).slice(0, 300)}`);

  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 1_000)))
    if ((await patroniRole(address, fetchImpl)) === 'replica') return;

  throw new Error('this member is still the leader after the switchover');
}
