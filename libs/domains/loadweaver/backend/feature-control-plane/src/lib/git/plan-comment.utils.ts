import type { PlanResourceChange, PlanStatus } from '../entities/plan.entity';

/** Identifies the bot's sticky comment on a pull / merge request (3.30). */
export const PLAN_COMMENT_MARKER = '<!-- loadweaver:plan -->';

/** GitHub allows 65,536 characters per comment; GitLab more. Stay below with room for the truncation note. */
export const MAX_COMMENT_LENGTH = 60_000;

/** Per list: entries shown before "… and N more". */
const LIST_LIMIT = 25;

export interface CommentPlan {
  id: string;
  status: PlanStatus;
  changes: readonly PlanResourceChange[];
  networkChanges: readonly Record<string, unknown>[];
  workloadChanges: readonly Record<string, unknown>[];
  warnings: readonly Record<string, unknown>[];
  failureAnalysis: Record<string, unknown> | null;
  risk: Record<string, string[]>;
  error: string | null;
}

export interface PlanCommentInput {
  /** `cluster` or the project of the connection. */
  scope: string;
  headSha: string;
  /** null: no plan (no changes, or it couldn't be created: `failure`). */
  plan: CommentPlan | null;
  /** Why no plan could be made (validation, secret scanning, quota, ...). */
  failure?: string | null;
  /** `loadweaver plan <project|path>`: only this part was planned. */
  limitedTo?: string | null;
  /** Projects that still need an approval, and who approved. */
  approvals?: { needed: string[]; given: { project: string; userId: string }[] };
  /** Locks other pull requests / plans hold on resources this plan touches. */
  locksByOthers?: { scope: string; holder: string }[];
  /** Whether this pull request holds the locks of its plan. */
  locked?: boolean;
  /** "Default branch ahead of cluster" (3.29) of this scope. */
  ahead?: { commit: string; state: string; planId: string | null; reason: string | null }[];
  /** Failed rollbacks touching these resources; `planId` null = a change of another scope (no details shown). */
  inconsistent?: { planId: string | null; error: string | null }[];
  /** The last command's outcome (apply result, merge, refusal), shown on top. */
  result?: string | null;
  /** Console base URL (links to the plan and the map overlay); omitted without one. */
  consoleUrl?: string | null;
}

/** Text from plans / providers in Markdown: no HTML, no table breaks, no mentions, one line. */
export function md(text: unknown, max = 300): string {
  const value = String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/@(?=\w)/g, '@​')
    .trim();

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

function capped<T>(
  items: readonly T[],
  render: (item: T) => string,
  limit = LIST_LIMIT,
  more = 'see the plan',
): string[] {
  const lines = items.slice(0, limit).map(render);

  if (items.length > limit) lines.push(`- … and ${items.length - limit} more (${more})`);

  return lines;
}

/** Which layer a resource kind belongs to (the plan's sections, 3.8). */
export function layerOf(kind: string): string {
  if (/^(Deployment|Volume|Job|CronJob|Backup)/.test(kind)) return 'Deployments';

  if (/^Dns/.test(kind)) return 'DNS';

  if (/^Bgp/.test(kind)) return 'BGP';

  if (/(Pool|Address|Ipam)/.test(kind)) return 'IPAM';

  if (/(Policy|Group)$/.test(kind)) return 'Policies and groups';

  if (/^(Cluster|Site|Node|Project)$/.test(kind)) return 'Cluster, sites, nodes and projects';

  return 'Other';
}

const LAYER_ORDER = [
  'Deployments',
  'Policies and groups',
  'DNS',
  'BGP',
  'IPAM',
  'Cluster, sites, nodes and projects',
  'Other',
];

const ACTION_SYMBOL: Record<string, string> = { create: '+', update: '~', delete: '-' };

function statusLine(plan: CommentPlan | null, input: PlanCommentInput): string {
  if (!plan)
    return input.failure
      ? ':x: **No plan**: the pull request cannot be planned'
      : ':white_check_mark: **No changes**: the cluster already matches this pull request';

  switch (plan.status) {
    case 'pending': {
      const needed = input.approvals?.needed ?? [];

      return needed.length > 0
        ? `:hourglass: **Plan pending**: needs an approval for ${needed.map((p) => `\`${p}\``).join(', ')}, then \`loadweaver apply\``
        : ':hourglass: **Plan pending**: ready for `loadweaver apply`';
    }
    case 'applying':
    case 'rolling-back':
      return `:gear: **${plan.status === 'applying' ? 'Applying' : 'Rolling back'}**`;
    case 'applied':
      return ':rocket: **Applied**';
    case 'discarded':
      return ':wastebasket: **Discarded**';
    case 'rolled-back':
      return ':leftwards_arrow_with_hook: **Apply failed and was rolled back**';
    default:
      return `:x: **${plan.status}**`;
  }
}

function changesSection(plan: CommentPlan): string[] {
  const touched = plan.changes.filter((c) => c.action !== 'unchanged');

  if (touched.length === 0) return ['#### Changes', '', 'No resource changes.'];

  const out = [`#### Changes (${touched.length})`];
  const byLayer = new Map<string, PlanResourceChange[]>();

  for (const change of touched)
    byLayer.set(layerOf(change.kind), [...(byLayer.get(layerOf(change.kind)) ?? []), change]);

  for (const layer of LAYER_ORDER.filter((l) => byLayer.has(l))) {
    const changes = byLayer.get(layer) as PlanResourceChange[];

    out.push('', `**${layer}**`, '');
    out.push(
      ...capped(
        changes,
        (c) =>
          `- \`${ACTION_SYMBOL[c.action] ?? c.action}\` ${c.action} ${c.kind} \`${c.project ? `${c.project}/` : ''}${c.name}\``,
      ),
    );
  }

  return out;
}

function networkSection(plan: CommentPlan): string[] {
  if (plan.networkChanges.length === 0 && plan.workloadChanges.length === 0) return [];

  const out = ['', '<details><summary>Effects per layer</summary>', ''];
  const byLayer = new Map<string, Record<string, unknown>[]>();

  for (const change of plan.networkChanges) {
    const layer = String(change['layer'] ?? 'other');

    byLayer.set(layer, [...(byLayer.get(layer) ?? []), change]);
  }

  for (const [layer, changes] of [...byLayer.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`**${md(layer, 40)}** (${changes.length})`, '');
    out.push(
      ...capped(
        changes,
        (c) => `- ${c['node'] ? `\`${md(c['node'], 63)}\`: ` : ''}${md(c['summary'] ?? c['message'] ?? c['action'])}`,
        10,
      ),
      '',
    );
  }

  if (plan.workloadChanges.length > 0) {
    const count = (action: string) => plan.workloadChanges.filter((w) => w['action'] === action).length;

    out.push(
      `**replicas**: ${count('start')} start, ${count('stop')} stop, ${count('move')} move${count('copy') ? `; **volume copies added**: ${count('copy')}` : ''}`,
      '',
      ...capped(
        plan.workloadChanges,
        (w) =>
          w['action'] === 'copy'
            ? `- volume \`${md(w['volume'], 120)}\`: copy added on \`${md(w['to'], 63)}\``
            : `- ${md(w['action'], 10)} \`${md(w['replica'], 120)}\`${w['from'] ? ` from \`${md(w['from'], 63)}\`` : ''}${w['to'] ? ` to \`${md(w['to'], 63)}\`` : ''}${w['methodLabel'] || w['method'] ? ` (${md(w['methodLabel'] ?? w['method'], 200)})` : ''}`,
        15,
      ),
      '',
    );
  }

  out.push('</details>');

  return out;
}

function isImageWarning(w: Record<string, unknown>): boolean {
  return /image/i.test(String(w['path'] ?? '')) || /signature|vulnerab|cosign|digest/i.test(String(w['message'] ?? ''));
}

function warningLine(w: Record<string, unknown>): string {
  const where = [w['project'], w['deployment']].filter(Boolean).join('/');
  const level = w['level'] === 'error' ? ':x:' : w['level'] === 'info' ? ':information_source:' : ':warning:';

  return `- ${level} ${where ? `\`${md(where, 130)}\` ` : ''}${md(w['message'])}`;
}

function warningsSections(plan: CommentPlan): string[] {
  const out: string[] = [];
  const pins = plan.warnings.filter((w) => w['pin'] === true || /^unacknowledged/i.test(String(w['message'] ?? '')));
  const images = plan.warnings.filter((w) => !pins.includes(w) && isImageWarning(w));
  const conflicts = plan.warnings.filter((w) => w['path'] === 'git-conflict');
  const others = plan.warnings.filter((w) => !pins.includes(w) && !images.includes(w) && !conflicts.includes(w));
  const findings = (
    (plan.failureAnalysis?.['findings'] as
      | { scope?: { kind?: string; name?: string }; kind?: string; subject?: string; reason?: string }[]
      | undefined) ?? []
  ).filter((f) => f && typeof f === 'object');
  const capacity = findings.filter((f) => f.kind === 'capacity');
  const spof = findings.filter((f) => f.kind !== 'capacity');
  const nPlusOne = plan.failureAnalysis?.['nPlusOne'];
  const risky = Object.entries(plan.risk ?? {}).filter(([, reasons]) => reasons.length > 0);

  if (pins.length > 0)
    out.push(
      '',
      `#### Pins (${pins.length})`,
      '',
      ...capped(pins, warningLine),
      '',
      'Unacknowledged pins need `loadweaver apply --confirm` (or `x-loadweaver.pinned` in the deployment).',
    );

  if (spof.length > 0)
    out.push(
      '',
      `#### Failure analysis (${spof.length})`,
      '',
      ...capped(
        spof,
        (f) =>
          `- :warning: losing ${md(f.scope?.kind, 10)} \`${md(f.scope?.name, 63)}\`: ${md(f.subject, 120)}: ${md(f.reason)}`,
      ),
    );

  if (capacity.length > 0 || nPlusOne === false || risky.length > 0)
    out.push(
      '',
      '#### Quota and capacity',
      '',
      ...(nPlusOne === false ? ['- :warning: the cluster can no longer absorb the loss of any single node (N+1)'] : []),
      ...capped(capacity, (f) => `- :warning: \`${md(f.subject, 120)}\`: ${md(f.reason)}`),
      ...risky.map(
        ([project, reasons]) => `- \`${md(project, 63)}\` is risky: ${reasons.map((r) => md(r, 120)).join('; ')}`,
      ),
    );

  if (images.length > 0)
    out.push('', `#### Image scan and policies (${images.length})`, '', ...capped(images, warningLine));

  if (others.length > 0) out.push('', `#### Other warnings (${others.length})`, '', ...capped(others, warningLine));

  return out;
}

function driftSection(plan: CommentPlan | null, input: PlanCommentInput): string[] {
  const conflicts = (plan?.warnings ?? []).filter((w) => w['path'] === 'git-conflict');
  const ahead = input.ahead ?? [];
  const inconsistent = input.inconsistent ?? [];

  if (conflicts.length === 0 && ahead.length === 0 && inconsistent.length === 0) return [];

  return [
    '',
    '#### Drift',
    '',
    ...ahead.map(
      (a) =>
        `- :warning: **default branch ahead of cluster**: \`${short(a.commit)}\` is ${md(a.state, 20)}${a.planId ? ` (plan \`${short(a.planId)}\`)` : ''}${a.reason ? `: ${md(a.reason, 200)}` : ''}. This pull request's plan includes what the default branch has and the cluster doesn't.`,
    ),
    ...capped(conflicts, (w) => `- :warning: ${md(w['message'])}`),
    ...inconsistent.map((i) =>
      i.planId
        ? `- :x: plan \`${short(i.planId)}\` failed to roll back${i.error ? ` (${md(i.error, 200)})` : ''}: configuration and reality may differ`
        : '- :x: a change in another scope failed to roll back: configuration and reality may differ',
    ),
  ];
}

function locksSection(input: PlanCommentInput): string[] {
  const others = input.locksByOthers ?? [];

  if (others.length === 0)
    return input.locked
      ? [
          '',
          ':lock: This pull request holds the locks of the resources it changes until it is applied, closed or unlocked.',
        ]
      : [];

  return [
    '',
    `#### Locked by others (${others.length})`,
    '',
    ...capped(others, (l) => `- :lock: \`${md(l.scope, 200)}\` by ${md(l.holder, 80)}`),
    '',
    'This plan cannot be applied until those locks are released.',
  ];
}

/**
 * The sticky plan comment (3.30), Markdown: status, links, changes per layer, effects, pins, failure analysis, quota /
 * capacity, image results, drift (incl. "default branch ahead"), locks. Capped at `maxLength` with a note.
 */
export function renderPlanComment(input: PlanCommentInput, maxLength = MAX_COMMENT_LENGTH): string {
  const plan = input.plan;
  const base = input.consoleUrl?.replace(/\/+$/, '');
  const links =
    plan && base
      ? `[Plan in the console](${base}/activity/plans/${plan.id}) · [Map overlay](${base}/observe/topology?mode=plan&plan=${plan.id})`
      : plan
        ? `Plan \`${plan.id}\``
        : '';
  const lines: string[] = [
    PLAN_COMMENT_MARKER,
    `### Loadweaver plan: \`${md(input.scope, 63)}\` at \`${short(input.headSha)}\``,
    '',
    statusLine(plan, input),
    ...(links ? ['', links] : []),
    ...(input.result ? ['', `> ${md(input.result, 1000)}`] : []),
    ...(input.limitedTo
      ? ['', `Planned only \`${md(input.limitedTo, 200)}\` (\`loadweaver plan\` plans everything again).`]
      : []),
  ];

  if (!plan && input.failure) lines.push('', '```', String(input.failure).replace(/```/g, "'''").slice(0, 4000), '```');

  if (plan) {
    lines.push('', ...changesSection(plan), ...networkSection(plan), ...warningsSections(plan));

    if (plan.error) lines.push('', `**Error**: ${md(plan.error, 1000)}`);

    const given = input.approvals?.given ?? [];

    if (given.length > 0)
      lines.push('', `Approved: ${given.map((g) => `\`${md(g.project, 63)}\` by \`${md(g.userId, 80)}\``).join(', ')}`);
  }

  lines.push(...driftSection(plan, input), ...locksSection(input));
  lines.push('', '<sub>Comment `loadweaver help` for the commands. Merging does not apply anything.</sub>');

  const text = lines.join('\n');

  if (text.length <= maxLength) return text;

  const note = `\n\n_… truncated: ${text.length - maxLength + 200} more characters. See the full plan in the console._`;
  const cut = text.slice(0, maxLength - note.length - 10);
  // Never leave a code block open.
  const open = (cut.match(/```/g) ?? []).length % 2 === 1;

  return `${cut}${open ? '\n```' : ''}${note}`;
}

/** A short reply to a command (`@login` mention, outcome, reasons). */
export function renderReply(login: string, command: string, outcome: string, reasons: readonly string[] = []): string {
  const mention = /^[A-Za-z0-9_.-]{1,100}$/.test(login) ? `@${login}` : 'You';

  return [
    `${mention} \`loadweaver ${md(command, 40)}\`: ${md(outcome, 500)}`,
    ...(reasons.length > 0 ? ['', ...capped(reasons, (r) => `- ${md(r, 500)}`, 20, 'more reasons')] : []),
  ].join('\n');
}
