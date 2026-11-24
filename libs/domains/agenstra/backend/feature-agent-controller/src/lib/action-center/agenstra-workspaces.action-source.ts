import { ClientEntity } from '@forepath/identity/backend';
import {
  limitActionCenterSql,
  setupGroup,
  taskGroup,
  toCount,
  toIsoString,
  type ActionCenterCollectContext,
  type ActionCenterGroupDraft,
  type ActionCenterParams,
  type ActionCenterSource,
  type ActionCenterSqlRunner,
  type ActionCenterTaskDefinition,
} from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AGENSTRA_ACTION_TYPES as T } from './agenstra-action-center.types';

/** Failed handoffs / automation runs older than this are history. */
const RECENT_FAILURE_DAYS = 14;
/** Open ticket statuses (automation only matters for tickets that are not finished). */
const FINISHED_TICKET_STATUSES = `('done', 'closed')`;

interface Row {
  id: string;
  client_id: string | null;
  client_name: string | null;
  at: Date | string | null;
  total: string;
  [column: string]: unknown;
}

/**
 * Agenstra to-dos across all workspaces (admins and managers see every workspace in the console): environments that
 * need a human (isolation baseline, configuration sync, graph builds), automation approvals and failures, agent tasks
 * and handoffs, deployment workflows / runs and broken integrations.
 */
@Injectable()
export class AgenstraWorkspacesActionSource implements ActionCenterSource {
  readonly key = 'agenstra.workspaces';
  readonly types = Object.values(T);

  /** At most a few concurrent queries (see `limitActionCenterSql`). */
  private readonly sql: ActionCenterSqlRunner;

  /** Any repository runs raw SQL on the controller database; the clients repository is always available here. */
  constructor(@InjectRepository(ClientEntity) clients: Repository<ClientEntity>) {
    this.sql = limitActionCenterSql(clients);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const since = new Date(context.now.getTime() - RECENT_FAILURE_DAYS * 86_400_000);
    const list = (
      definition: ActionCenterTaskDefinition,
      sql: string,
      params: (row: Row) => ActionCenterParams,
      extra: unknown[] = [],
    ) => this.list(definition, context, sql, params, extra);
    const groups = await Promise.all([
      this.firstWorkspace(),
      list(
        { type: T.isolationFailed, category: 'workspaces', severity: 'danger' },
        `SELECT s.client_id AS id, s.client_id, c.name AS client_name, s.standard_state AS state, s.checked_at AS at
           FROM client_isolation_snapshots s
           JOIN clients c ON c.id = s.client_id
          WHERE s.standard_state IN ('unsupported', 'installation-failed', 'probe-failed')`,
        (row) => ({ state: row['state'] as string }),
      ),
      list(
        { type: T.configSyncFailed, category: 'workspaces', severity: 'warning' },
        `SELECT q.client_id || ':' || q.agent_id AS id, q.client_id, c.name AS client_name, q.agent_id,
                MAX(q.last_error) AS error, MAX(q.updated_at) AS at
           FROM (
             SELECT client_id, agent_id, last_error, updated_at FROM opencode_config_sync_targets WHERE sync_status = 'failed'
             UNION ALL
             SELECT client_id, agent_id, last_error, updated_at FROM opencode_layer_file_sync_targets WHERE sync_status = 'failed'
           ) q
           JOIN clients c ON c.id = q.client_id
          GROUP BY q.client_id, q.agent_id, c.name`,
        (row) => ({ agentId: row['agent_id'] as string, error: shortError(row['error']) }),
      ),
      list(
        { type: T.graphFailed, category: 'workspaces', severity: 'info' },
        `SELECT g.id, g.client_id, c.name AS client_name, g.error, g.updated_at AS at
           FROM workspace_graph_snapshots g
           JOIN clients c ON c.id = g.client_id
          WHERE g.status = 'failed'
            AND NOT EXISTS (
              SELECT 1 FROM workspace_graph_snapshots later
               WHERE later.client_id = g.client_id AND later.created_at > g.created_at
            )`,
        (row) => ({ error: shortError(row['error']) }),
      ),
      list(
        { type: T.automationApproval, category: 'tickets', severity: 'warning' },
        `SELECT t.id, t.client_id, c.name AS client_name, t.title, t.priority, a.updated_at AS at
           FROM ticket_automation a
           JOIN tickets t ON t.id = a.ticket_id
           JOIN clients c ON c.id = t.client_id
          WHERE a.eligible = true AND a.requires_approval = true AND a.approved_at IS NULL
            AND t.status NOT IN ${FINISHED_TICKET_STATUSES}`,
        (row) => ({ title: row['title'] as string, priority: row['priority'] as string }),
      ),
      list(
        { type: T.automationAttention, category: 'tickets', severity: 'danger' },
        `SELECT r.ticket_id AS id, r.client_id, c.name AS client_name, t.title, r.status, r.failure_code,
                COALESCE(r.finished_at, r.updated_at) AS at
           FROM ticket_automation_run r
           JOIN tickets t ON t.id = r.ticket_id
           JOIN clients c ON c.id = r.client_id
          WHERE r.status IN ('failed', 'timed_out', 'escalated')
            AND COALESCE(r.finished_at, r.updated_at) >= $2
            AND t.status NOT IN ${FINISHED_TICKET_STATUSES}
            AND NOT EXISTS (
              SELECT 1 FROM ticket_automation_run later
               WHERE later.ticket_id = r.ticket_id AND later.started_at > r.started_at
            )`,
        (row) => ({
          title: row['title'] as string,
          status: row['status'] as string,
          failureCode: (row['failure_code'] as string | null) ?? null,
        }),
        [since],
      ),
      list(
        { type: T.tasksApproval, category: 'automation', severity: 'warning' },
        `SELECT k.id, k.client_id, c.name AS client_name, k.title, k.agent_id, k.updated_at AS at
           FROM agent_tasks k
           JOIN clients c ON c.id = k.client_id
          WHERE k.approved_at IS NULL`,
        (row) => ({ title: row['title'] as string, agentId: row['agent_id'] as string }),
      ),
      list(
        { type: T.tasksFailed, category: 'automation', severity: 'warning' },
        `SELECT k.id, k.client_id, c.name AS client_name, k.title, k.agent_id, k.last_run_at AS at
           FROM agent_tasks k
           JOIN clients c ON c.id = k.client_id
          WHERE k.enabled = true AND k.approved_at IS NOT NULL AND k.last_run_status = 'failed'`,
        (row) => ({ title: row['title'] as string, agentId: row['agent_id'] as string }),
      ),
      list(
        { type: T.handoffsFailed, category: 'automation', severity: 'info' },
        `SELECT h.id, h.client_id, c.name AS client_name, h.title, h.source_agent_name, h.target_agent_name,
                COALESCE(h.delivery_failure_message, h.failure_message) AS error, h.updated_at AS at
           FROM agent_handoffs h
           JOIN clients c ON c.id = h.client_id
          WHERE (h.status = 'failed' OR h.delivery_failure_message IS NOT NULL) AND h.updated_at >= $2`,
        (row) => ({
          title: row['title'] as string,
          source: row['source_agent_name'] as string,
          target: row['target_agent_name'] as string,
          error: shortError(row['error']),
        }),
        [since],
      ),
      list(
        { type: T.deploymentsApproval, category: 'deployments', severity: 'warning' },
        `SELECT w.id, w.client_id, c.name AS client_name, w.name, w.repository, w.updated_at AS at
           FROM deployment_workflows w
           JOIN clients c ON c.id = w.client_id
          WHERE w.approved_at IS NULL`,
        (row) => ({ name: row['name'] as string, repository: row['repository'] as string }),
      ),
      list(
        { type: T.deploymentsFailed, category: 'deployments', severity: 'danger' },
        `SELECT w.id, w.client_id, c.name AS client_name, w.name, w.last_run_conclusion AS conclusion,
                w.last_run_at AS at
           FROM deployment_workflows w
           JOIN clients c ON c.id = w.client_id
          WHERE w.enabled = true AND w.last_run_conclusion IN ('failure', 'timed_out') AND w.last_run_at >= $2`,
        (row) => ({ name: row['name'] as string, conclusion: row['conclusion'] as string }),
        [since],
      ),
      list(
        { type: T.connectionsFailed, category: 'integrations', severity: 'warning' },
        `SELECT q.id, NULL::uuid AS client_id, NULL AS client_name, q.kind, q.label, q.message, q.at FROM (
           SELECT d.id, 'deployment' AS kind, d.label, d.last_test_message AS message, d.last_tested_at AS at
             FROM deployment_connections d WHERE d.last_test_status = 'failed'
           UNION ALL
           SELECT a.id, 'atlassian' AS kind, a.label, a.last_test_message AS message, a.last_tested_at AS at
             FROM atlassian_site_connections a WHERE a.last_test_status = 'failed'
         ) q`,
        (row) => ({ kind: row['kind'] as string, label: row['label'] as string, error: shortError(row['message']) }),
      ),
      list(
        { type: T.importsFailed, category: 'integrations', severity: 'warning' },
        `SELECT i.id, i.client_id, c.name AS client_name, i.provider, i.import_kind, i.last_error AS error,
                i.last_run_at AS at
           FROM external_import_configs i
           LEFT JOIN clients c ON c.id = i.client_id
          WHERE i.enabled = true AND i.last_error IS NOT NULL`,
        (row) => ({
          provider: row['provider'] as string,
          importKind: row['import_kind'] as string,
          error: shortError(row['error']),
        }),
      ),
    ]);

    return groups.flat();
  }

  private async firstWorkspace(): Promise<ActionCenterGroupDraft[]> {
    const [row]: Array<{ count: string }> = await this.sql.query(`SELECT COUNT(*) AS count FROM clients`);

    return setupGroup({ type: T.setupFirstWorkspace, category: 'setup', severity: 'info' }, toCount(row?.count) === 0);
  }

  /** Runs `sql` (aliases `id`, `client_id`, `client_name`, `at`) newest first, capped at the item limit. */
  private async list(
    definition: ActionCenterTaskDefinition,
    context: ActionCenterCollectContext,
    sql: string,
    params: (row: Row) => ActionCenterParams,
    extra: unknown[],
  ): Promise<ActionCenterGroupDraft[]> {
    // One instance, no scope filter: `$1` is the limit, `$2`… are the query's own values.
    const rows: Row[] = await this.sql.query(
      `SELECT q.*, COUNT(*) OVER () AS total FROM (${sql}) q ORDER BY q.at DESC NULLS LAST LIMIT $1`,
      [context.itemLimit, ...extra],
    );

    return taskGroup(
      definition,
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: String(row.id),
        occurredAt: toIsoString(row.at as Date | string | null),
        params: { clientId: row.client_id, clientName: row.client_name, ...params(row) },
      })),
    );
  }
}

function shortError(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, 200) : null;
}
