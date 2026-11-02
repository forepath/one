import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import type { DataSource } from 'typeorm';

import { OPENSEARCH_REPOSITORY } from './platform-backups.utils';

/**
 * Runs a shell command on the current Patroni leader, inside its Spilo container, through
 * `COPY … FROM PROGRAM` as the database superuser the control plane already connects with (3.20): base backups and
 * WAL-G retention need WAL-G's environment and the data directory, both only there. The connection goes through
 * the member's leader proxy, so the command always runs where the primary is. Commands are built from constants and
 * validated values only (`walgCommand`), never from user input.
 */
export async function runOnLeader(dataSource: DataSource, command: string): Promise<string[]> {
  const runner = dataSource.createQueryRunner();

  await runner.connect();

  try {
    await runner.query('SET statement_timeout = 0');
    await runner.query('CREATE TEMP TABLE IF NOT EXISTS lw_program_output (line text)');
    await runner.query('TRUNCATE lw_program_output');
    // One line per row: delimiter and quote are control characters the output never contains.
    await runner.query(
      `COPY lw_program_output FROM PROGRAM '${command.replace(/'/g, "''")}' WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')`,
    );

    const rows: { line: string | null }[] = await runner.query('SELECT line FROM lw_program_output');

    return rows.map((r) => r.line ?? '');
  } finally {
    await runner.query('DROP TABLE IF EXISTS lw_program_output').catch(() => undefined);
    await runner.release();
  }
}

export class OpenSearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Minimal OpenSearch REST client for snapshots (the log store on the member, no security plugin, 3.14). */
export class OpenSearchSnapshots {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const reason = (json as { error?: { reason?: string; type?: string } } | null)?.error;

      throw new OpenSearchError(
        `opensearch ${method} ${path}: ${reason?.reason ?? reason?.type ?? res.status}`,
        res.status,
      );
    }

    return json as T;
  }

  async hasRepositoryPlugin(): Promise<boolean> {
    const plugins = await this.call<{ component: string }[]>('GET', '_cat/plugins?format=json');

    return plugins.some((p) => p.component === 'repository-s3');
  }

  /** Registers (or corrects) the repository without verification: verification deletes, which the gateway refuses. */
  async ensureRepository(bucket: string, basePath: string): Promise<void> {
    const current = await this.call<Record<string, { type: string; settings: Record<string, string> }>>(
      'GET',
      `_snapshot/${OPENSEARCH_REPOSITORY}`,
    ).catch((error: unknown) => {
      if (error instanceof OpenSearchError && error.status === 404) return null;

      throw error;
    });
    const settings = current?.[OPENSEARCH_REPOSITORY]?.settings;

    if (settings?.bucket === bucket && settings?.base_path === basePath && settings?.client === 'default') return;

    await this.call('PUT', `_snapshot/${OPENSEARCH_REPOSITORY}?verify=false`, {
      type: 's3',
      settings: { bucket, base_path: basePath, client: 'default' },
    });
  }

  /** Snapshot of all regular indices (system / hidden ones excluded), waits for completion. */
  async snapshot(
    name: string,
    timeoutMs: number,
  ): Promise<{ state: string; failures: unknown[]; shards: { failed: number; total: number } }> {
    const result = await this.call<{
      snapshot: { state: string; failures?: unknown[]; shards?: { failed: number; total: number } };
    }>(
      'PUT',
      `_snapshot/${OPENSEARCH_REPOSITORY}/${encodeURIComponent(name)}?wait_for_completion=true`,
      { indices: '*,-.*', include_global_state: false, ignore_unavailable: true },
      timeoutMs,
    );

    return {
      state: result.snapshot.state,
      failures: result.snapshot.failures ?? [],
      shards: result.snapshot.shards ?? { failed: 0, total: 0 },
    };
  }

  async sizes(name: string): Promise<{ total: number; incremental: number }> {
    const status = await this.call<{
      snapshots: { stats?: { total?: { size_in_bytes?: number }; incremental?: { size_in_bytes?: number } } }[];
    }>('GET', `_snapshot/${OPENSEARCH_REPOSITORY}/${encodeURIComponent(name)}/_status`);
    const stats = status.snapshots[0]?.stats;

    return { total: stats?.total?.size_in_bytes ?? 0, incremental: stats?.incremental?.size_in_bytes ?? 0 };
  }

  async list(): Promise<{ name: string; startedAt: Date; state: string; indices: string[] }[]> {
    const result = await this.call<{
      snapshots: { snapshot: string; start_time_in_millis: number; state: string; indices: string[] }[];
    }>('GET', `_snapshot/${OPENSEARCH_REPOSITORY}/_all`);

    return result.snapshots.map((s) => ({
      name: s.snapshot,
      startedAt: new Date(s.start_time_in_millis),
      state: s.state,
      indices: s.indices,
    }));
  }

  async delete(names: string[], timeoutMs: number): Promise<void> {
    if (names.length === 0) return;

    await this.call(
      'DELETE',
      `_snapshot/${OPENSEARCH_REPOSITORY}/${names.map(encodeURIComponent).join(',')}`,
      undefined,
      timeoutMs,
    );
  }

  /** Index-level restore; restored indices get a prefix unless the caller replaces closed / deleted ones. */
  async restore(
    name: string,
    indices: string[],
    renamePrefix: string,
    timeoutMs: number,
  ): Promise<{ indices: string[]; shards: { failed: number; total: number } }> {
    const result = await this.call<{ snapshot?: { indices: string[]; shards: { failed: number; total: number } } }>(
      'POST',
      `_snapshot/${OPENSEARCH_REPOSITORY}/${encodeURIComponent(name)}/_restore?wait_for_completion=true`,
      {
        indices: indices.join(','),
        include_global_state: false,
        include_aliases: false,
        ...(renamePrefix ? { rename_pattern: '(.+)', rename_replacement: `${renamePrefix}$1` } : {}),
      },
      timeoutMs,
    );

    return { indices: result.snapshot?.indices ?? [], shards: result.snapshot?.shards ?? { failed: 0, total: 0 } };
  }
}

/**
 * `etcdctl snapshot save` without etcdctl: etcd's JSON gateway streams `Maintenance.Snapshot` as newline-delimited
 * JSON (`{"result":{"remaining_bytes":…,"blob":"<base64>"}}`); the concatenated blobs are the same file etcdctl
 * writes (database + SHA-256 trailer), restorable with `etcdutl snapshot restore`. Written to `file`; returns bytes.
 */
export async function etcdSnapshotToFile(
  endpoint: string,
  file: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${endpoint.replace(/\/$/, '')}/v3/maintenance/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok || !res.body) throw new Error(`etcd snapshot failed with HTTP ${res.status}`);

  const out = createWriteStream(file, { mode: 0o600 });
  const decoder = new TextDecoder();
  let pending = '';
  let bytes = 0;
  let finished = false;
  const write = async (line: string) => {
    if (!line.trim()) return;

    const parsed = JSON.parse(line) as {
      result?: { blob?: string; remaining_bytes?: string | number };
      error?: { message?: string };
    };

    if (parsed.error) throw new Error(`etcd snapshot: ${parsed.error.message ?? 'error'}`);

    const blob = Buffer.from(parsed.result?.blob ?? '', 'base64');

    bytes += blob.length;

    if (!out.write(blob)) await once(out, 'drain');

    // proto3 JSON omits zero values: the last message has no (or a zero) `remaining_bytes`.
    if (parsed.result && Number(parsed.result.remaining_bytes ?? 0) === 0) finished = true;
  };

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });

      let newline = pending.indexOf('\n');

      while (newline >= 0) {
        await write(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    }

    await write(pending);
  } finally {
    out.end();
    await once(out, 'close');
  }

  if (!finished || bytes === 0) throw new Error('etcd snapshot stream ended early');

  return bytes;
}
