import type { PluginLogger } from '@forepath/loadweaver/backend/util-terraform-protocol';
import { stringifyResourceDocuments, type Resource } from '@forepath/loadweaver/shared/util-model';

import {
  apiErrorMessage,
  FINAL_PLAN_STATUSES,
  LoadweaverApiError,
  type LoadweaverClient,
  type PlanView,
  type ResourceRefInput,
} from './api-client';
import { attributeError, error, warning, type Diagnostic } from './diagnostics';
import type { ProviderSettings } from './provider-config';

export interface RunnerContext {
  client: LoadweaverClient;
  settings: ProviderSettings;
  logger: PluginLogger;
  /** Aborted by `StopProvider` (Ctrl-C in Terraform). */
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type PlanInput = { documents: string } | { delete: ResourceRefInput[] };

export function planInputFor(resource: Resource): PlanInput {
  return { documents: stringifyResourceDocuments([resource]) };
}

const LIST_LIMIT = 10;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('interrupted'));

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('interrupted'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function describeRef(change: { kind: string; name: string; project?: string | null }): string {
  return `${change.kind} ${change.project ? `${change.project}/` : ''}${change.name}`;
}

function limited(lines: string[], heading: string): string[] {
  if (lines.length === 0) return [];

  return [
    `${heading}:`,
    ...lines.slice(0, LIST_LIMIT).map((l) => `  - ${l}`),
    ...(lines.length > LIST_LIMIT ? [`  - ... and ${lines.length - LIST_LIMIT} more`] : []),
  ];
}

function message(entry: Record<string, unknown>): string {
  const text = typeof entry['message'] === 'string' ? entry['message'] : JSON.stringify(entry);
  const where = [entry['project'], entry['deployment'], entry['path'] ?? entry['policy']].filter(
    (v) => typeof v === 'string' && v,
  );

  return where.length ? `${where.join(' / ')}: ${text}` : text;
}

/**
 * What a Loadweaver plan does beyond the resource change Terraform already shows: network and workload effects,
 * warnings (pins), approval risk and compiler diagnostics. Empty if there is nothing beyond the change itself.
 */
export function summarizePlan(plan: PlanView): Diagnostic[] {
  const changes = plan.changes.filter((c) => c.action !== 'unchanged');
  const network = (plan.networkChanges ?? []).map(
    (n) => `${n.layer} ${n.action}${n.node ? ` on ${n.node}` : ''}${n.summary ? `: ${n.summary}` : ''}`,
  );
  const workloads = (plan.workloadChanges ?? []).map(
    (w) =>
      `${w.action} ${w.replica ?? w.volume ?? ''}${w.from ? ` from ${w.from}` : ''}${w.to ? ` to ${w.to}` : ''}${w.methodLabel ? ` (${w.methodLabel})` : ''}`,
  );
  const warnings = (plan.warnings ?? []).map(
    (w) => `${message(w)}${w['pin'] === true ? ' (pin: apply needs confirm_pins = true or x-loadweaver.pinned)' : ''}`,
  );
  const risk = Object.entries(plan.risk ?? {})
    .filter(([, reasons]) => reasons.length > 0)
    .map(([project, reasons]) => `${project}: ${reasons.join(', ')}`);
  const diagnostics = (plan.diagnostics ?? []).map((d) => `${d['level'] === 'error' ? 'error: ' : ''}${message(d)}`);
  const detail = [
    ...limited(network, 'Network changes'),
    ...limited(workloads, 'Workload changes'),
    ...limited(warnings, 'Warnings'),
    ...limited(risk, 'Risky for approval rules (an approval may be required)'),
    ...limited(diagnostics, 'Diagnostics'),
  ];

  if (detail.length === 0) return [];

  return [
    warning(
      `Loadweaver dry-run plan: ${changes.length ? changes.map((c) => `${c.action} ${describeRef(c)}`).join(', ') : 'no resource changes'}`,
      detail.join('\n'),
    ),
  ];
}

/** Diagnostics for a failed API call, issue paths mapped onto attributes where possible. */
export function apiDiagnostics(err: unknown, action: string, attributeFor: (path: string) => string): Diagnostic[] {
  if (!(err instanceof LoadweaverApiError)) {
    const text = err instanceof Error ? err.message : String(err);

    return [error(`Loadweaver ${action} failed`, text)];
  }

  if (err.status === 401)
    return [
      error('Loadweaver rejected the token', 'The personal access token is missing, invalid, expired or revoked.'),
    ];

  if (err.status === 403)
    return [
      error(
        `Not allowed to ${action}`,
        `${apiErrorMessage(err.body)}\n\nThe token needs the scopes resources:read, plans:create and plans:apply, and its user the role for the touched project (developer or higher; cluster resources need a cluster role).`,
      ),
    ];

  const body = err.body as { issues?: unknown } | null;

  if (err.status === 400 && body && Array.isArray(body.issues) && body.issues.length > 0)
    return body.issues.map((issue: unknown) => {
      if (issue && typeof issue === 'object') {
        const entry = issue as Record<string, unknown>;
        const path = typeof entry['path'] === 'string' ? entry['path'] : '';

        return attributeError(
          attributeFor(path),
          `Loadweaver refused the ${action}`,
          `${path ? `${path}: ` : ''}${typeof entry['message'] === 'string' ? entry['message'] : JSON.stringify(entry)}`,
        );
      }

      return error(`Loadweaver refused the ${action}`, String(issue));
    });

  return [error(`Loadweaver refused the ${action} (HTTP ${err.status})`, apiErrorMessage(err.body))];
}

/** `terraform plan`: a Loadweaver plan that is created for its diff and discarded right away. */
export async function dryRun(
  ctx: RunnerContext,
  input: PlanInput,
  attributeFor: (path: string) => string,
): Promise<Diagnostic[]> {
  let plan: PlanView;

  try {
    plan = await ctx.client.createPlan(input, ctx.signal);
  } catch (err) {
    return apiDiagnostics(err, 'dry-run plan', attributeFor);
  }

  try {
    return summarizePlan(plan);
  } finally {
    await ctx.client
      .discardPlan(plan.id)
      .catch((err: unknown) =>
        ctx.logger.log('warn', 'discarding the dry-run plan failed', { plan: plan.id, error: String(err) }),
      );
  }
}

export type ApplyOutcome =
  | { ok: true; plan: PlanView; changed: boolean; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[]; planId?: string };

function conflictKind(err: unknown): 'blockers' | 'locks' | 'other' | null {
  if (!(err instanceof LoadweaverApiError) || err.status !== 409) return null;

  const body = err.body as { blockers?: unknown; locks?: unknown } | null;

  if (body && Array.isArray(body.blockers)) return 'blockers';

  if (body && Array.isArray(body.locks)) return 'locks';

  return 'other';
}

function listOf(err: LoadweaverApiError, key: 'blockers' | 'locks'): string[] {
  return ((err.body as Record<string, unknown>)[key] as unknown[]).map(String);
}

/**
 * `terraform apply`: creates the Loadweaver plan, applies it and follows it until it settled. Approval rules
 * (3.17) answer the apply with `409` + `blockers`: the runner then waits (polling the apply) until an approver
 * approved the plan in the console / CLI, or `approval_timeout` passed; plans locked by another plan wait the same
 * way. Interrupts and timeouts discard the pending plan, so nothing is left half-way.
 */
export async function createAndApply(
  ctx: RunnerContext,
  input: PlanInput,
  attributeFor: (path: string) => string,
): Promise<ApplyOutcome> {
  const sleep = ctx.sleep ?? defaultSleep;
  const now = ctx.now ?? Date.now;
  let plan: PlanView;

  try {
    plan = await ctx.client.createPlan(input, ctx.signal);
  } catch (err) {
    return { ok: false, diagnostics: apiDiagnostics(err, 'plan', attributeFor) };
  }

  const discard = () =>
    ctx.client
      .discardPlan(plan.id)
      .catch((err: unknown) =>
        ctx.logger.log('warn', 'discarding the plan failed', { plan: plan.id, error: String(err) }),
      );

  if (plan.changes.every((c) => c.action === 'unchanged')) {
    await discard();

    return { ok: true, plan, changed: false, diagnostics: [] };
  }

  const approvalDeadline = now() + ctx.settings.approvalTimeoutMs;
  const diagnostics: Diagnostic[] = [];
  let waitedFor: string[] | null = null;
  let applied: PlanView | null = null;

  while (!applied) {
    try {
      applied = await ctx.client.applyPlan(plan.id, ctx.settings.confirmPins, ctx.signal);
    } catch (err) {
      const kind = conflictKind(err);

      if (ctx.signal.aborted) {
        await discard();

        return {
          ok: false,
          planId: plan.id,
          diagnostics: [error('Interrupted', `Loadweaver plan ${plan.id} was discarded.`)],
        };
      }

      if (kind !== 'blockers' && kind !== 'locks') {
        await discard();

        const pins = err instanceof LoadweaverApiError && /pins/.test(apiErrorMessage(err.body));

        return {
          ok: false,
          planId: plan.id,
          diagnostics: pins
            ? [
                error(
                  'The Loadweaver plan contains unacknowledged pins',
                  `${apiErrorMessage((err as LoadweaverApiError).body)}\n\nReview the pins of plan ${plan.id} (terraform plan lists them), then set confirm_pins = true in the provider block or acknowledge them with x-loadweaver.pinned.`,
                ),
              ]
            : apiDiagnostics(err, 'apply', attributeFor),
        };
      }

      const reasons = listOf(err as LoadweaverApiError, kind);

      if (now() >= approvalDeadline) {
        await discard();

        return {
          ok: false,
          planId: plan.id,
          diagnostics: [
            error(
              kind === 'blockers' ? 'Loadweaver plan not approved in time' : 'Loadweaver resources stayed locked',
              [
                `Plan ${plan.id} waited ${Math.round(ctx.settings.approvalTimeoutMs / 1000)} s (approval_timeout) and was discarded.`,
                kind === 'blockers' ? 'Missing approvals / acceptances:' : 'Locked by:',
                ...reasons.map((r) => `  - ${r}`),
                kind === 'blockers'
                  ? 'An operator or admin of the project (not the author of the change) approves the plan in the console (Plans) or with `POST /api/plans/{id}/approve` while terraform apply waits. Raise approval_timeout for slower approvals.'
                  : 'Another plan is applying the same resources; try again once it finished.',
              ].join('\n'),
            ),
          ],
        };
      }

      if (!waitedFor || waitedFor.join('\n') !== reasons.join('\n')) {
        waitedFor = reasons;
        ctx.logger.log(
          'info',
          kind === 'blockers'
            ? `Loadweaver plan ${plan.id} waits for approval: ${reasons.join('; ')}`
            : `Loadweaver plan ${plan.id} waits for locks: ${reasons.join('; ')}`,
          { plan: plan.id },
        );
      }

      try {
        await sleep(ctx.settings.pollIntervalMs, ctx.signal);
      } catch {
        await discard();

        return {
          ok: false,
          planId: plan.id,
          diagnostics: [error('Interrupted', `Loadweaver plan ${plan.id} was discarded.`)],
        };
      }
    }
  }

  if (waitedFor)
    diagnostics.push(
      warning(`Loadweaver plan ${plan.id} was approved`, `terraform apply waited for: ${waitedFor.join('; ')}`),
    );

  const applyDeadline = now() + ctx.settings.applyTimeoutMs;

  while (!FINAL_PLAN_STATUSES.has(applied.status)) {
    if (now() >= applyDeadline)
      return {
        ok: false,
        planId: plan.id,
        diagnostics: [
          ...diagnostics,
          error(
            'Loadweaver apply still running',
            `Plan ${plan.id} is still ${applied.status} after apply_timeout. It continues on the cluster (follow it in the console or with \`loadweaver watch\`); run terraform apply again afterwards.`,
          ),
        ],
      };

    try {
      await sleep(ctx.settings.pollIntervalMs, ctx.signal);
      applied = await ctx.client.getPlan(plan.id, ctx.signal);
    } catch (err) {
      return {
        ok: false,
        planId: plan.id,
        diagnostics: [
          ...diagnostics,
          ctx.signal.aborted
            ? error('Interrupted', `Plan ${plan.id} keeps applying on the cluster; it is no longer followed.`)
            : apiDiagnostics(err, 'apply progress check', attributeFor)[0],
        ],
      };
    }
  }

  if (applied.status !== 'applied')
    return {
      ok: false,
      planId: plan.id,
      diagnostics: [
        ...diagnostics,
        error(
          `Loadweaver plan ${plan.id} ${applied.status}`,
          `${applied.error ? `${applied.error}\n\n` : ''}The cluster ${applied.status === 'rolled-back' ? 'rolled the change back; nothing changed' : 'did not apply the change'}. Details in the console (Plans).`,
        ),
      ],
    };

  return { ok: true, plan: applied, changed: true, diagnostics };
}
