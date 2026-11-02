/**
 * Minimal client for the Garage admin API v2 (3.20), used by the control plane to form object-store generations:
 * node ids, peering, layout, keys and buckets. Talks to the holders over the overlay only.
 */
export class GarageAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface GarageNodeStatus {
  id: string;
  addr: string | null;
  isUp: boolean;
  role: { zone: string; capacity: number | null; tags: string[] } | null;
  draining: boolean;
}

export interface GarageLayout {
  version: number;
  roles: { id: string; zone: string; capacity: number | null; tags: string[] }[];
  stagedRoleChanges: { id: string; remove?: boolean; zone?: string; capacity?: number | null; tags?: string[] }[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

export class GarageAdminClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const error = json as { code?: string; message?: string } | null;

      throw new GarageAdminError(`garage ${path}: ${error?.message ?? res.status}`, res.status, error?.code);
    }

    return json as T;
  }

  async selfId(): Promise<string> {
    const info = await this.call<{ success: Record<string, { nodeId: string }> }>('GET', 'GetNodeInfo?node=self');
    const first = Object.values(info.success ?? {})[0];

    if (!first) throw new GarageAdminError('garage did not report its node id', 500);

    return first.nodeId;
  }

  async status(): Promise<{ layoutVersion: number; nodes: GarageNodeStatus[] }> {
    return await this.call('GET', 'GetClusterStatus');
  }

  /** `id@host:port` peers; returns the ones that failed. */
  async connect(peers: string[]): Promise<string[]> {
    if (peers.length === 0) return [];

    const results = await this.call<{ success: boolean; error?: string | null }[]>(
      'POST',
      'ConnectClusterNodes',
      peers,
    );

    return peers.filter((_, i) => !results[i]?.success);
  }

  async layout(): Promise<GarageLayout> {
    return await this.call('GET', 'GetClusterLayout');
  }

  async stageLayout(
    roles: { id: string; zone: string; capacity: number; tags: string[] }[],
    remove: string[],
  ): Promise<void> {
    await this.call('POST', 'UpdateClusterLayout', {
      roles: [...roles, ...remove.map((id) => ({ id, remove: true }))],
    });
  }

  async applyLayout(version: number): Promise<void> {
    await this.call('POST', 'ApplyClusterLayout', { version });
  }

  /** Whether all layout versions are synced, i.e. data moved to where the current layout wants it. */
  async layoutSynced(): Promise<boolean> {
    const history = await this.call<{
      currentVersion: number;
      minAck: number;
      versions: { version: number; status: string }[];
    }>('GET', 'GetClusterLayoutHistory');

    return (
      history.versions.filter((v) => v.status !== 'Historical').length <= 1 && history.minAck >= history.currentVersion
    );
  }

  /** Imports a key with a fixed id and secret; idempotent. */
  async ensureKey(accessKeyId: string, secretAccessKey: string, name: string): Promise<void> {
    try {
      await this.call('POST', 'ImportKey', { accessKeyId, secretAccessKey, name });
    } catch (error) {
      if (!(error instanceof GarageAdminError && error.code === 'KeyAlreadyExists')) throw error;
    }
  }

  /** Creates the bucket if needed and grants the key read / write; idempotent. */
  async ensureBucket(alias: string, accessKeyId: string): Promise<string> {
    let id: string;

    try {
      id = (await this.call<{ id: string }>('POST', 'CreateBucket', { globalAlias: alias })).id;
    } catch (error) {
      if (!(error instanceof GarageAdminError && error.code === 'BucketAlreadyExists')) throw error;

      id = (await this.call<{ id: string }>('GET', `GetBucketInfo?globalAlias=${encodeURIComponent(alias)}`)).id;
    }

    await this.call('POST', 'AllowBucketKey', {
      bucketId: id,
      accessKeyId,
      permissions: { read: true, write: true, owner: false },
    });

    return id;
  }
}
