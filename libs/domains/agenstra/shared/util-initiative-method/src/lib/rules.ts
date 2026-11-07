import {
  INITIATIVE_STEPS,
  LOCKED_WORK_ITEM_STATUSES,
  type InitiativeArtifactType,
  type InitiativePath,
  type InitiativePrerequisiteSatisfiedAt,
  type InitiativeStepDefinition,
  type InitiativeStepKey,
  type InitiativeStepNeed,
  type RetrospectiveVerdict,
  type WorkItemKind,
  type WorkItemStatus,
} from './catalog';

/** Ticket statuses of the Agenstra ticket board (kept as strings: this lib has no backend dependency). */
export type LinkedTicketStatus = 'draft' | 'todo' | 'in_progress' | 'prototype' | 'done' | 'closed';

/**
 * Work item status of an item linked to a ticket: the ticket is the source of truth once transferred
 * (ticket automation finishing with `prototype` means the story is built).
 */
export function workItemStatusFromTicketStatus(status: string): WorkItemStatus {
  switch (status as LinkedTicketStatus) {
    case 'todo':
      return 'ready-for-dev';
    case 'in_progress':
      return 'in-progress';
    case 'prototype':
      return 'built';
    case 'done':
      return 'done';
    case 'closed':
      return 'dropped';
    case 'draft':
    default:
      return 'draft';
  }
}

/** Ticket status matching a work item status (used when a human marks an item done or drops it on the page). */
export function ticketStatusForWorkItemStatus(status: WorkItemStatus): LinkedTicketStatus | undefined {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'ready-for-dev':
      return 'todo';
    case 'in-progress':
      return 'in_progress';
    case 'built':
      return 'prototype';
    case 'done':
      return 'done';
    case 'dropped':
      return 'closed';
    default:
      return undefined;
  }
}

export function isLockedWorkItemStatus(status: WorkItemStatus): boolean {
  return LOCKED_WORK_ITEM_STATUSES.includes(status);
}

/** Minimal view of a work item for the rules (effective status already resolved). */
export interface RuleWorkItem {
  id: string;
  key: string;
  kind: WorkItemKind;
  parentId: string | null;
  status: WorkItemStatus;
  sortOrder: number;
  refined?: boolean;
  /** Dependents of a done-checkpoint item wait for `done`, whatever the initiative setting says. */
  doneCheckpoint?: boolean;
  /** Linked ticket id, when transferred. */
  ticketId?: string | null;
}

export interface RuleDependency {
  workItemId: string;
  prerequisiteId: string;
}

export interface ReadinessSettings {
  prerequisiteSatisfiedAt: InitiativePrerequisiteSatisfiedAt;
  /** Latest retrospective verdict per epic id (missing: no retrospective yet). */
  retrospectiveVerdicts?: Record<string, RetrospectiveVerdict | undefined>;
}

export interface WorkItemReadiness {
  /** All prerequisites satisfied (the item may be released to `todo`). */
  ready: boolean;
  /** Keys of the prerequisites that are not satisfied yet. */
  blockedBy: string[];
  /** The item itself counts as satisfied for its dependents. */
  satisfied: boolean;
}

function itemSatisfied(item: RuleWorkItem, settings: ReadinessSettings): boolean {
  if (item.status === 'done') {
    return true;
  }

  if (item.status === 'dropped') {
    // Dropped work no longer blocks anything.
    return true;
  }

  return item.status === 'built' && settings.prerequisiteSatisfiedAt === 'built' && !item.doneCheckpoint;
}

/**
 * Readiness of every item: an item is ready when each prerequisite is satisfied. A story prerequisite is satisfied
 * when it is done (or built, when the initiative allows it and the story has no done checkpoint). An epic
 * prerequisite is satisfied when it has items and all of them are satisfied, and its latest retrospective did not
 * reject it (BMad: the verdict gates the next epic).
 */
export function evaluateReadiness(
  items: readonly RuleWorkItem[],
  dependencies: readonly RuleDependency[],
  settings: ReadinessSettings,
): Map<string, WorkItemReadiness> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenByEpic = new Map<string, RuleWorkItem[]>();

  for (const item of items) {
    if (item.parentId) {
      const list = childrenByEpic.get(item.parentId) ?? [];

      list.push(item);
      childrenByEpic.set(item.parentId, list);
    }
  }

  const satisfied = new Map<string, boolean>();
  const isSatisfied = (item: RuleWorkItem): boolean => {
    const cached = satisfied.get(item.id);

    if (cached !== undefined) {
      return cached;
    }

    let result: boolean;

    if (item.kind === 'epic') {
      const children = (childrenByEpic.get(item.id) ?? []).filter((child) => child.status !== 'dropped');

      result =
        item.status === 'dropped' ||
        (children.length > 0 &&
          children.every((child) => itemSatisfied(child, settings)) &&
          settings.retrospectiveVerdicts?.[item.id] !== 'rejected');
    } else {
      result = itemSatisfied(item, settings);
    }

    satisfied.set(item.id, result);

    return result;
  };

  const prerequisitesOf = new Map<string, string[]>();

  for (const dependency of dependencies) {
    const list = prerequisitesOf.get(dependency.workItemId) ?? [];

    list.push(dependency.prerequisiteId);
    prerequisitesOf.set(dependency.workItemId, list);
  }

  const result = new Map<string, WorkItemReadiness>();

  for (const item of items) {
    // Dependencies of the parent epic apply to its items too.
    const own = prerequisitesOf.get(item.id) ?? [];
    const inherited = item.parentId ? (prerequisitesOf.get(item.parentId) ?? []) : [];
    const blockedBy: string[] = [];

    for (const prerequisiteId of [...new Set([...own, ...inherited])]) {
      const prerequisite = byId.get(prerequisiteId);

      if (prerequisite && prerequisite.id !== item.id && !isSatisfied(prerequisite)) {
        blockedBy.push(prerequisite.key);
      }
    }

    result.set(item.id, { ready: blockedBy.length === 0, blockedBy: blockedBy.sort(), satisfied: isSatisfied(item) });
  }

  return result;
}

/**
 * Edges that would close a cycle when added (returns the first offending dependency, or null).
 *
 * With `parentOf` (item id → epic id) the implicit links of the tree count too, because they block just like explicit
 * ones: an epic is satisfied only when its items are (epic → item), and items inherit their epic's prerequisites
 * (item → prerequisite of its epic). Without them `E1.S2 after E1` would pass and never become ready.
 */
export function findDependencyCycle(
  dependencies: readonly RuleDependency[],
  added: readonly RuleDependency[] = [],
  parentOf?: ReadonlyMap<string, string | null>,
): RuleDependency | null {
  const current = [...dependencies];

  for (const dependency of added) {
    if (dependency.workItemId === dependency.prerequisiteId || hasCycle([...current, dependency], parentOf)) {
      return dependency;
    }

    current.push(dependency);
  }

  // Validate the existing graph too when nothing was added (callers pass the full set).
  if (added.length === 0 && hasCycle(dependencies, parentOf)) {
    for (const dependency of dependencies) {
      const others = dependencies.filter((other) => other !== dependency);

      if (!hasCycle(others, parentOf)) {
        return dependency;
      }
    }

    return dependencies[0] ?? null;
  }

  return null;
}

function hasCycle(dependencies: readonly RuleDependency[], parentOf?: ReadonlyMap<string, string | null>): boolean {
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (from === to) {
      return;
    }

    const set = edges.get(from) ?? new Set<string>();

    set.add(to);
    edges.set(from, set);
  };
  const childrenOf = new Map<string, string[]>();

  for (const [child, epic] of parentOf ?? []) {
    if (epic) {
      childrenOf.set(epic, [...(childrenOf.get(epic) ?? []), child]);
      addEdge(epic, child);
    }
  }

  for (const dependency of dependencies) {
    if (dependency.workItemId === dependency.prerequisiteId) {
      return true;
    }

    addEdge(dependency.workItemId, dependency.prerequisiteId);

    for (const child of childrenOf.get(dependency.workItemId) ?? []) {
      addEdge(child, dependency.prerequisiteId);
    }
  }

  const state = new Map<string, 1 | 2>();
  const visit = (node: string): boolean => {
    state.set(node, 1);

    for (const next of edges.get(node) ?? []) {
      const seen = state.get(next);

      if (seen === 1 || (seen === undefined && visit(next))) {
        return true;
      }
    }

    state.set(node, 2);

    return false;
  };

  for (const node of edges.keys()) {
    if (!state.has(node) && visit(node)) {
      return true;
    }
  }

  return false;
}

const EPIC_KEY = /^E(\d+)$/;
const ITEM_KEY = /^E(\d+)\.S(\d+)$/;

/** Next free epic key (`E1`, `E2`, …); keys are never reused, so the maximum ever used counts. */
export function nextEpicKey(existingKeys: Iterable<string>): string {
  let max = 0;

  for (const key of existingKeys) {
    const match = EPIC_KEY.exec(key) ?? ITEM_KEY.exec(key);

    if (match) {
      max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }

  return `E${max + 1}`;
}

/** Next free item key below an epic (`E1.S1`, `E1.S2`, …). */
export function nextItemKey(epicKey: string, existingKeys: Iterable<string>): string {
  const epic = EPIC_KEY.exec(epicKey);

  if (!epic) {
    throw new Error(`Invalid epic key ${epicKey}`);
  }

  let max = 0;

  for (const key of existingKeys) {
    const match = ITEM_KEY.exec(key);

    if (match && match[1] === epic[1]) {
      max = Math.max(max, Number.parseInt(match[2], 10));
    }
  }

  return `E${epic[1]}.S${max + 1}`;
}

export function isWorkItemKey(value: unknown): value is string {
  return typeof value === 'string' && (EPIC_KEY.test(value) || ITEM_KEY.test(value));
}

/** Snapshot of an initiative used to decide which steps are available and what comes next. */
export interface InitiativeSnapshot {
  path: InitiativePath;
  hasIntent: boolean;
  /** Artifact types that have an accepted version. */
  acceptedArtifactTypes: ReadonlySet<InitiativeArtifactType>;
  epics: ReadonlyArray<{
    id: string;
    key: string;
    title: string;
    refined: boolean;
    status: WorkItemStatus;
    /** Items below the epic that are not dropped. */
    items: ReadonlyArray<{ status: WorkItemStatus; transferred: boolean }>;
    hasRetrospective: boolean;
  }>;
  openFindings: number;
  openProposals: number;
}

export interface StepAvailability {
  available: boolean;
  /** Human-readable reasons for missing hard needs. */
  missing: string[];
  /** Recommendations that are not met (the step can still run). */
  warnings: string[];
  /** The same as structured needs (`missing` / `warnings` are their English texts): UIs render their own labels. */
  missingNeeds: InitiativeStepNeed[];
  warningNeeds: InitiativeStepNeed[];
}

function describeNeed(need: InitiativeStepNeed, required = false): string {
  switch (need.kind) {
    case 'intent':
      return 'The initiative needs an intent.';
    case 'artifact':
      return `An accepted ${need.artifactTypes.join(' or ')} document is ${required ? 'needed' : 'recommended'}.`;
    case 'target-epic':
      return 'Choose an epic.';
    case 'refined-epic':
      return 'The epic must be refined first.';
    case 'epic-with-stories':
      return 'The epic needs at least one story.';
    case 'epics':
      return 'The initiative needs epics.';
  }
}

function needMet(
  need: InitiativeStepNeed,
  snapshot: InitiativeSnapshot,
  epic: InitiativeSnapshot['epics'][number] | undefined,
): boolean {
  switch (need.kind) {
    case 'intent':
      return snapshot.hasIntent;
    case 'artifact':
      return need.artifactTypes.some((type) => snapshot.acceptedArtifactTypes.has(type));
    case 'target-epic':
      return !!epic;
    case 'refined-epic':
      return !!epic?.refined;
    case 'epic-with-stories':
      return !!epic && epic.items.length > 0;
    case 'epics':
      return snapshot.epics.length > 0;
  }
}

/** Whether a step can start (hard needs) and which recommendations are not met (soft needs). */
export function stepAvailability(
  step: InitiativeStepDefinition,
  snapshot: InitiativeSnapshot,
  epicId?: string | null,
): StepAvailability {
  const epic = epicId ? snapshot.epics.find((candidate) => candidate.id === epicId) : undefined;
  const missingNeeds: InitiativeStepNeed[] = [];

  if (step.target === 'epic' && !epic) {
    missingNeeds.push({ kind: 'target-epic' });
  }

  for (const need of step.hardNeeds) {
    if (
      !needMet(need, snapshot, epic) &&
      !missingNeeds.some((known) => known.kind === need.kind && known.kind !== 'artifact')
    ) {
      missingNeeds.push(need);
    }
  }

  const warningNeeds = step.softNeeds.filter((need) => !needMet(need, snapshot, epic));

  return {
    available: missingNeeds.length === 0,
    missing: missingNeeds.map((need) => describeNeed(need, true)),
    warnings: warningNeeds.map((need) => describeNeed(need)),
    missingNeeds,
    warningNeeds,
  };
}

export interface NextAction {
  /** A step to run, or a platform action without an agent. */
  kind: 'step' | 'transfer' | 'build' | 'proposals' | 'findings';
  step?: InitiativeStepKey;
  epicId?: string;
  title: string;
  reason: string;
}

/**
 * "What's next" (BMad ordering): define the intent, the shared contracts the path calls for, slice into epics, then per
 * epic refine → incept → (readiness) → transfer → build → retrospective. Open proposals and findings come first.
 */
export function whatsNext(snapshot: InitiativeSnapshot, limit = 5): NextAction[] {
  const actions: NextAction[] = [];
  const step = (key: InitiativeStepKey) =>
    INITIATIVE_STEPS.find((candidate) => candidate.key === key) as InitiativeStepDefinition;

  if (snapshot.openProposals > 0) {
    actions.push({
      kind: 'proposals',
      title: 'Decide open change proposals',
      reason: `${snapshot.openProposals} proposal(s) wait for a decision.`,
    });
  }

  if (snapshot.openFindings > 0) {
    actions.push({
      kind: 'findings',
      title: 'Triage open findings',
      reason: `${snapshot.openFindings} finding(s) are open: convert them into proposals or new items, or dismiss them.`,
    });
  }

  if (!snapshot.hasIntent) {
    actions.push({
      kind: 'step',
      step: 'forge-idea',
      title: 'Describe the intent',
      reason: 'Every path starts with a clear intent.',
    });

    return actions.slice(0, limit);
  }

  for (const key of ['forge-idea', 'prd', 'architecture'] as const) {
    const definition = step(key);
    const output = definition.output;

    if (
      definition.recommendedFor.includes(snapshot.path) &&
      output.kind === 'artifact' &&
      !snapshot.acceptedArtifactTypes.has(output.artifactType) &&
      snapshot.epics.length === 0
    ) {
      actions.push({ kind: 'step', step: key, title: definition.title, reason: definition.summary });
    }
  }

  if (snapshot.epics.length === 0) {
    actions.push({
      kind: 'step',
      step: 'slice-epics',
      title: step('slice-epics').title,
      reason: 'Cut the initiative into epics in build order.',
    });

    return actions.slice(0, limit);
  }

  for (const epic of snapshot.epics) {
    if (epic.status === 'dropped') {
      continue;
    }

    const label = `${epic.key} ${epic.title}`;

    if (!epic.refined) {
      actions.push({
        kind: 'step',
        step: 'refine-epic',
        epicId: epic.id,
        title: `Refine ${label}`,
        reason: 'Settle open points and write the epic requirements.',
      });
      continue;
    }

    if (epic.items.length === 0) {
      actions.push({
        kind: 'step',
        step: 'incept-stories',
        epicId: epic.id,
        title: `Incept stories for ${label}`,
        reason: 'Slice the epic into stories in build order.',
      });
      continue;
    }

    if (epic.items.some((item) => !item.transferred)) {
      actions.push({
        kind: 'transfer',
        epicId: epic.id,
        title: `Transfer ${label} to tickets`,
        reason: 'Stories become tickets in build order.',
      });
      continue;
    }

    const finished = epic.items.every(
      (item) => item.status === 'built' || item.status === 'done' || item.status === 'dropped',
    );

    if (!finished) {
      actions.push({
        kind: 'build',
        epicId: epic.id,
        title: `Build ${label}`,
        reason: 'Release ready stories and build them (chat plans or ticket automation).',
      });
      continue;
    }

    if (!epic.hasRetrospective) {
      actions.push({
        kind: 'step',
        step: 'retrospective',
        epicId: epic.id,
        title: `Retrospective for ${label}`,
        reason: 'Judge the finished epic against its requirements.',
      });
    }
  }

  return actions.slice(0, limit);
}
