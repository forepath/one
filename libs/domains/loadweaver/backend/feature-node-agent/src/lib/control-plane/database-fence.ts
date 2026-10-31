import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ControlPlaneRole, Heartbeat } from '@forepath/loadweaver/shared/util-agent-protocol';

import { writeScopeMarker } from './postgres-cutover';

/**
 * Fencing of a member's Postgres data after a takeover by the built-in control plane (3.43, user decision 2026-10-31).
 *
 * Every takeover and every handover increments the cluster's database epoch. The epoch of a member's data is the
 * `lw_database_handover.epoch` in its own database; the epoch the cluster is at comes from the control plane
 * (`controlPlane.databaseFence`), from the fence settings the control plane writes into an old primary
 * (`loadweaver.fenced_epoch`, replicated to its replicas), and from the highest epoch this agent has seen (persisted).
 * Data of an older epoch must not act as primary: the agent stops the API replica, exports the rows written there
 * after the takeover (NDJSON per table, never merged), stops Spilo, moves the data directory aside (never deleted) and
 * starts empty in the Patroni scope chosen at the takeover; the next handover re-seeds it.
 */

export type FenceReport = NonNullable<Heartbeat['databaseFence']>;

/** `<state>/database-fence.json`: the highest epoch seen and the last fence report (0600). */
export const FENCE_STATE_FILE = 'database-fence.json';

export interface FenceState {
  seenEpoch: number;
  lastReport: FenceReport | null;
}

/** What `FENCE_PROBE_COMMAND` found in the member's Postgres. */
export interface FenceProbe {
  recovery: boolean | null;
  /** `DB_DATABASE` exists. */
  database: boolean;
  /** Its handover row's epoch (0 before the epoch column; null: no row / no table). */
  epoch: number | null;
  /** Fence settings the control plane wrote into this data (database-level, replicated). */
  fencedEpoch: number | null;
  fencedAt: string | null;
  fencedScope: string | null;
}

const SCOPE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseFenceState(raw: string | null): FenceState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<FenceState>) : null;

    return {
      seenEpoch: int(v?.seenEpoch) ?? 0,
      lastReport: v?.lastReport && typeof v.lastReport === 'object' ? v.lastReport : null,
    };
  } catch {
    return { seenEpoch: 0, lastReport: null };
  }
}

export function parseFenceProbe(raw: string | null): FenceProbe | null {
  if (!raw) return null;

  try {
    const v = JSON.parse(raw) as Record<string, unknown>;

    if (!v || typeof v !== 'object' || typeof v['database'] !== 'boolean') return null;

    return {
      recovery: typeof v['recovery'] === 'boolean' ? v['recovery'] : null,
      database: v['database'],
      epoch: int(v['epoch']),
      fencedEpoch: int(v['fencedEpoch']),
      fencedAt: typeof v['fencedAt'] === 'string' && v['fencedAt'] ? v['fencedAt'] : null,
      fencedScope: typeof v['fencedScope'] === 'string' && SCOPE.test(v['fencedScope']) ? v['fencedScope'] : null,
    };
  } catch {
    return null;
  }
}

/** The highest epoch known: what was seen before, the role's, and the fence settings found in the data. */
export function seenEpoch(previous: number, role: Pick<ControlPlaneRole, 'databaseFence'>, probe: FenceProbe | null) {
  return Math.max(previous, role.databaseFence?.epoch ?? 0, probe?.fencedEpoch ?? 0);
}

/**
 * A role with a lower epoch than one this agent has seen comes from a control plane on stale data (a member replica
 * that came back on fenced data): its control-plane role is not applied (nothing is started, removed or re-created).
 */
export function staleRole(role: Pick<ControlPlaneRole, 'databaseFence'>, seen: number): boolean {
  return !!role.databaseFence && role.databaseFence.epoch < seen;
}

export type FenceDecision =
  | { kind: 'none' }
  | { kind: 'fence'; epoch: number; dataEpoch: number; takenOverAt: string | null; scope: string }
  /** Fenced data, but no scope to start empty in is known (the old scope's etcd keys belong to the old data). */
  | { kind: 'refuse'; reason: string };

/**
 * Whether the member's data must be fenced: its database exists with an epoch older than `seen`. The scope to start
 * empty in comes from the role (when it is at that epoch), else from the fence settings, else the role's database
 * scope; the takeover time (the export's cut-off) likewise.
 */
export function fenceDecision(input: {
  probe: FenceProbe | null;
  seen: number;
  role: Pick<ControlPlaneRole, 'databaseFence' | 'postgresScope'>;
}): FenceDecision {
  const { probe, seen, role } = input;

  if (!probe?.database || probe.epoch === null || probe.epoch >= seen) return { kind: 'none' };

  const current = role.databaseFence && role.databaseFence.epoch >= seen ? role.databaseFence : null;
  // A stale role's database scope may be the fenced data's own: never used.
  const scope = current?.scope ?? probe.fencedScope ?? (current ? (role.postgresScope ?? null) : null);

  if (!scope)
    return {
      kind: 'refuse',
      reason: `data of epoch ${probe.epoch} is older than ${seen}, but no Patroni scope to start empty in is known yet`,
    };

  return {
    kind: 'fence',
    epoch: seen,
    dataEpoch: probe.epoch,
    takenOverAt: current?.takenOverAt ?? probe.fencedAt ?? null,
    scope,
  };
}

/** `20261031T120000Z` */
export function fenceStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** Where the old data directory goes (next to it, never deleted). */
export function fencedDataDirName(dataEpoch: number, at: Date): string {
  return `postgres.fenced-e${dataEpoch}-${fenceStamp(at)}`;
}

/** Where the export of rows written after the takeover goes (the member's state directory). */
export function divergedDirName(at: Date): string {
  return `database-diverged-${fenceStamp(at)}`;
}

/** Columns that mark a row as written after the takeover (timestamp types only). */
export const FENCE_EXPORT_COLUMNS = ['created_at', 'updated_at', 'time'] as const;
/** Time series aren't exported (agents re-send them; huge), nor the migration bookkeeping. */
export const FENCE_EXPORT_SKIPPED = /^(lw_metrics|lw_flows)|^(migrations|typeorm_metadata)$/;
/** Rows per table at most (the export is for review, not a backup). */
export const FENCE_EXPORT_MAX_ROWS = 200_000;

/** The member's data volume inside Spilo (`<state>/postgres` on the host, see `postgresSpec`). */
const PGDATA = '/home/postgres/pgdata';
export const FENCE_PROBE_FILE = 'lw-fence-probe.json';

const PY_DRIVER = ['try:', '    import psycopg2 as pg', 'except ImportError:', '    import psycopg as pg'];
const PY_CONNECT = "pg.connect(host='/var/run/postgresql', port=5432, dbname=%s, connect_timeout=5)";

/**
 * Reads the epoch of the member's data and the fence settings (python in Spilo, as `postgres` over the local socket,
 * like the role-password check); writes JSON to `LW_OUT` in the data volume. Exit 0 or a failure (Postgres not up).
 */
export const FENCE_PROBE_COMMAND: string[] = [
  'python3',
  '-c',
  [
    'import json, os, sys',
    ...PY_DRIVER,
    "db, out = os.environ['LW_DATABASE'], os.environ['LW_OUT']",
    "res = {'recovery': None, 'database': False, 'epoch': None, 'fencedEpoch': None, 'fencedAt': None, 'fencedScope': None}",
    "keys = {'loadweaver.fenced_epoch': 'fencedEpoch', 'loadweaver.fenced_at': 'fencedAt', 'loadweaver.fenced_scope': 'fencedScope'}",
    'try:',
    `    conn = ${PY_CONNECT.replace('%s', "'postgres'")}`,
    '    conn.autocommit = True',
    '    cur = conn.cursor()',
    "    cur.execute('SELECT pg_is_in_recovery()')",
    "    res['recovery'] = bool(cur.fetchone()[0])",
    "    cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (db,))",
    "    res['database'] = cur.fetchone() is not None",
    "    cur.execute('SELECT unnest(s.setconfig) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = %s AND s.setrole = 0', (db,))",
    '    for (item,) in cur.fetchall():',
    "        key, _, value = item.partition('=')",
    '        if key in keys:',
    "            res[keys[key]] = int(value) if key == 'loadweaver.fenced_epoch' else value",
    '    conn.close()',
    "    if res['database']:",
    `        conn = ${PY_CONNECT.replace('%s', 'db')}`,
    '        conn.autocommit = True',
    '        cur = conn.cursor()',
    '        cur.execute("SELECT to_regclass(\'public.lw_database_handover\') IS NOT NULL")',
    '        if cur.fetchone()[0]:',
    "            cur.execute(\"SELECT COALESCE((to_jsonb(h)->>'epoch')::int, 0) FROM public.lw_database_handover h WHERE h.id = 'cluster'\")",
    '            row = cur.fetchone()',
    "            res['epoch'] = None if row is None else int(row[0])",
    '        conn.close()',
    'except Exception:',
    '    sys.exit(1)',
    "tmp = out + '.tmp'",
    "with open(tmp, 'w') as f:",
    '    json.dump(res, f)',
    'os.replace(tmp, out)',
  ].join('\n'),
];

/**
 * Exports rows written after `LW_SINCE` (any of `FENCE_EXPORT_COLUMNS` later) from every table of `public` that has
 * such a column, as NDJSON (`row_to_json`) per table into `LW_OUT_DIR`, plus `manifest.json` (rows per table, whether
 * truncated). Read-only, one snapshot per table, server-side cursors. Exit 0 or a failure.
 */
export const FENCE_EXPORT_COMMAND: string[] = [
  'python3',
  '-c',
  [
    'import json, os, re, sys',
    ...PY_DRIVER,
    "db, since, out = os.environ['LW_DATABASE'], os.environ['LW_SINCE'], os.environ['LW_OUT_DIR']",
    "limit = int(os.environ.get('LW_MAX_ROWS', '200000'))",
    `cols = [${FENCE_EXPORT_COLUMNS.map((c) => `'${c}'`).join(', ')}]`,
    `skip = re.compile(r'${FENCE_EXPORT_SKIPPED.source}')`,
    "q = lambda name: '\"' + name.replace('\"', '\"\"') + '\"'",
    'try:',
    '    os.makedirs(out, exist_ok=True)',
    `    conn = ${PY_CONNECT.replace('%s', 'db')}`,
    '    cur = conn.cursor()',
    "    cur.execute(\"SELECT c.table_name::text, array_agg(c.column_name::text ORDER BY c.column_name) FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = ANY(%s) AND c.data_type IN ('timestamp with time zone', 'timestamp without time zone') GROUP BY c.table_name ORDER BY c.table_name\", (cols,))",
    '    tables = cur.fetchall()',
    "    manifest = {'database': db, 'since': since, 'columns': cols, 'tables': {}}",
    '    for table, columns in tables:',
    '        if skip.search(table):',
    '            continue',
    "        where = ' OR '.join(q(c) + ' > %s::timestamptz' for c in columns)",
    "        rc = conn.cursor(name='lw_fence_export')",
    "        rc.execute('SELECT row_to_json(t)::text FROM public.' + q(table) + ' t WHERE ' + where, [since] * len(columns))",
    '        n, f, truncated = 0, None, False',
    '        while not truncated:',
    '            batch = rc.fetchmany(1000)',
    '            if not batch:',
    '                break',
    '            for (line,) in batch:',
    '                if n >= limit:',
    '                    truncated = True',
    '                    break',
    '                if f is None:',
    "                    f = open(os.path.join(out, re.sub(r'[^A-Za-z0-9_.-]', '_', table) + '.ndjson'), 'w')",
    "                f.write(line + '\\n')",
    '                n += 1',
    '        rc.close()',
    '        if f is not None:',
    '            f.close()',
    '        if n:',
    "            manifest['tables'][table] = {'rows': n, 'truncated': truncated}",
    '    conn.rollback()',
    '    conn.close()',
    "    with open(os.path.join(out, 'manifest.json'), 'w') as f:",
    '        json.dump(manifest, f, indent=2)',
    'except Exception as error:',
    '    sys.stderr.write(str(error)[:400])',
    '    sys.exit(1)',
  ].join('\n'),
];

/** The exec environment of the probe / export: the database and the superuser (secrets in the env, never args). */
export function fenceExecEnvironment(
  role: Pick<ControlPlaneRole, 'environment'>,
  extra: Record<string, string>,
): Record<string, string> {
  const env = role.environment ?? {};

  return {
    LW_DATABASE: env['DB_DATABASE'] || 'loadweaver',
    PGUSER: env['DB_USERNAME'] || 'postgres',
    PGPASSWORD: env['DB_PASSWORD'] ?? '',
    ...extra,
  };
}

export async function readFenceState(stateDir: string): Promise<FenceState> {
  return parseFenceState(await readFile(join(stateDir, FENCE_STATE_FILE), 'utf8').catch(() => null));
}

export async function writeFenceState(stateDir: string, state: FenceState): Promise<void> {
  const path = join(stateDir, FENCE_STATE_FILE);

  await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

/** The last fence report for the heartbeat (only for a week: the control plane recorded it by then). */
export async function recentFenceReport(stateDir: string, now: number): Promise<FenceReport | null> {
  const report = (await readFenceState(stateDir)).lastReport;
  const at = report ? Date.parse(report.at) : NaN;

  return report && Number.isFinite(at) && now - at < 7 * 24 * 3600_000 ? report : null;
}

/** Side effects of the probe / fence (fakes in specs). */
export interface FenceDeps {
  stateDir: string;
  /** Runs a command in the member's Spilo as `postgres` (exit code). */
  exec(cmd: string[], env: Record<string, string>): Promise<number>;
  removeContainer(name: string): Promise<boolean>;
  ownBySpilo(path: string): Promise<void>;
  log(line: string): void;
  now(): Date;
}

/** The member's data epoch / fence settings; null when Postgres can't be asked (not running, starting). */
export async function probeDatabaseFence(
  deps: Pick<FenceDeps, 'stateDir' | 'exec'>,
  role: Pick<ControlPlaneRole, 'environment'>,
): Promise<FenceProbe | null> {
  const host = join(deps.stateDir, 'postgres', FENCE_PROBE_FILE);

  try {
    await rm(host, { force: true });

    const code = await deps.exec(
      FENCE_PROBE_COMMAND,
      fenceExecEnvironment(role, { LW_OUT: `${PGDATA}/${FENCE_PROBE_FILE}` }),
    );

    if (code !== 0) return null;

    return parseFenceProbe(await readFile(host, 'utf8').catch(() => null));
  } catch {
    return null;
  } finally {
    await rm(host, { force: true }).catch(() => undefined);
  }
}

async function dirSize(path: string): Promise<number> {
  let total = 0;

  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const full = join(path, entry.name);

    total += entry.isDirectory()
      ? await dirSize(full)
      : await stat(full).then(
          (s) => s.size,
          () => 0,
        );
  }

  return total;
}

async function exportRows(dir: string): Promise<number> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
      tables?: Record<string, { rows?: number }>;
    };

    return Object.values(manifest.tables ?? {}).reduce((sum, t) => sum + (Number(t.rows) || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Fences the member's data (see the module comment): API replica stopped, rows written after the takeover exported
 * (while Spilo still runs), Spilo stopped, the export moved to `<state>/database-diverged-<time>`, the data directory
 * moved to `<state>/postgres.fenced-e<epoch>-<time>`, an empty data directory and the new scope marker in place. The
 * caller then starts Spilo again (empty, in the new scope). Returns the report for the control plane.
 */
export async function fenceDatabase(
  deps: FenceDeps,
  role: Pick<ControlPlaneRole, 'environment'>,
  decision: Extract<FenceDecision, { kind: 'fence' }>,
  containers: { api: string; postgres: string },
): Promise<FenceReport> {
  const at = deps.now();
  const stamp = fenceStamp(at);
  const dataDir = join(deps.stateDir, 'postgres');
  const exportInData = `lw-diverged-${stamp}`;
  const exportDir = join(deps.stateDir, divergedDirName(at));
  const fencedDir = join(deps.stateDir, fencedDataDirName(decision.dataEpoch, at));
  let exportError: string | undefined;

  deps.log(
    `Postgres data of epoch ${decision.dataEpoch} is older than the cluster's database (epoch ${decision.epoch}): fencing it`,
  );
  await deps.removeContainer(containers.api);

  if (!decision.takenOverAt) exportError = 'the takeover time is unknown';
  else {
    const code = await deps
      .exec(
        FENCE_EXPORT_COMMAND,
        fenceExecEnvironment(role, {
          LW_SINCE: decision.takenOverAt,
          LW_OUT_DIR: `${PGDATA}/${exportInData}`,
          LW_MAX_ROWS: String(FENCE_EXPORT_MAX_ROWS),
        }),
      )
      .catch(() => -1);

    if (code !== 0) exportError = `the export failed (exit ${code}); the rows stay in the moved-aside data directory`;
  }

  await deps.removeContainer(containers.postgres);

  let exportBytes: number | undefined;
  let exportRowsTotal: number | undefined;

  if (!exportError) {
    await rename(join(dataDir, exportInData), exportDir);
    exportBytes = await dirSize(exportDir);
    exportRowsTotal = await exportRows(exportDir);
  }

  await rename(dataDir, fencedDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await deps.ownBySpilo(dataDir);
  await writeScopeMarker(deps.stateDir, decision.scope);

  const report: FenceReport = {
    epoch: decision.epoch,
    dataEpoch: decision.dataEpoch,
    at: at.toISOString(),
    dataDir: fencedDir,
    ...(exportError ? { exportError } : { exportDir, exportBytes: exportBytes ?? 0, exportRows: exportRowsTotal ?? 0 }),
  };

  deps.log(
    exportError
      ? `Postgres data moved aside to ${fencedDir} (${exportError}); starting empty in scope ${decision.scope}`
      : `Postgres data moved aside to ${fencedDir}; ${report.exportRows} row(s) written after the takeover exported to ${exportDir}; starting empty in scope ${decision.scope}`,
  );

  return report;
}
