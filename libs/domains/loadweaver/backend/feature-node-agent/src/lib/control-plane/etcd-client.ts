/** etcd v3 cluster API through its JSON gateway (no extra dependency). */

export interface EtcdMember {
  ID: string;
  name?: string;
  peerURLs?: string[];
  clientURLs?: string[];
}

async function call<T>(clientUrl: string, path: string, body: unknown, timeoutMs = 3_000): Promise<T> {
  const res = await fetch(`${clientUrl}/v3/cluster/member/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`etcd ${path} failed with HTTP ${res.status}`);

  return (await res.json()) as T;
}

export async function listMembers(clientUrl: string): Promise<EtcdMember[]> {
  return (await call<{ members?: EtcdMember[] }>(clientUrl, 'list', {})).members ?? [];
}

export async function addMember(clientUrl: string, peerUrl: string): Promise<EtcdMember[]> {
  return (await call<{ members?: EtcdMember[] }>(clientUrl, 'add', { peerURLs: [peerUrl] })).members ?? [];
}

export async function removeMember(clientUrl: string, id: string): Promise<void> {
  await call(clientUrl, 'remove', { ID: id });
}

export async function updateMemberPeerUrl(clientUrl: string, id: string, peerUrl: string): Promise<void> {
  await call(clientUrl, 'update', { ID: id, peerURLs: [peerUrl] });
}

/** `initial-cluster` value for a node joining an existing cluster (members incl. the new one, by name). */
export function initialClusterFrom(members: EtcdMember[], self: { name: string; peerUrl: string }): string {
  const entries = members.filter((m) => m.name && m.peerURLs?.length).map((m) => `${m.name}=${m.peerURLs?.[0]}`);

  if (!entries.some((e) => e.startsWith(`${self.name}=`))) entries.push(`${self.name}=${self.peerUrl}`);

  return entries.sort().join(',');
}
