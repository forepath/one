/**
 * Initiatives: workspace planning that follows the BMad Method (https://docs.bmad-method.org/, MIT licensed; see
 * NOTICE.md). This file is the single vocabulary shared by the controller, the console and the agent prompts.
 */

/** Delivery loop stages (BMad: Clarify → Plan → Build & verify → Learn & adjust). */
export const INITIATIVE_PHASES = ['clarify', 'plan', 'build', 'learn'] as const;
export type InitiativePhase = (typeof INITIATIVE_PHASES)[number];

/** Planning path sized to the work (BMad "Choose a Planning Path"; the trivial path needs no initiative). */
export const INITIATIVE_PATHS = ['session', 'epic', 'project'] as const;
export type InitiativePath = (typeof INITIATIVE_PATHS)[number];

export const INITIATIVE_STATES = ['active', 'paused', 'completed', 'archived'] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];

/** When a prerequisite counts as satisfied for the stories that come after it. */
export const INITIATIVE_PREREQUISITE_SATISFIED_AT = ['built', 'done'] as const;
export type InitiativePrerequisiteSatisfiedAt = (typeof INITIATIVE_PREREQUISITE_SATISFIED_AT)[number];

/** Roles of the method (named by role, not by persona). */
export const INITIATIVE_ROLES = [
  'analyst',
  'product_manager',
  'ux_designer',
  'architect',
  'product_owner',
  'developer',
] as const;
export type InitiativeRole = (typeof INITIATIVE_ROLES)[number];

export const INITIATIVE_ROLE_LABELS: Record<InitiativeRole, string> = {
  analyst: 'Analyst',
  product_manager: 'Product Manager',
  ux_designer: 'UX Designer',
  architect: 'Architect',
  product_owner: 'Product Owner',
  developer: 'Developer',
};

/** Planning documents of an initiative (one current version each, full history kept). */
export const INITIATIVE_ARTIFACT_TYPES = [
  'brainstorm',
  'forge-report',
  'research',
  'product-brief',
  'prfaq',
  'prd',
  'ux',
  'architecture',
  'project-context',
  'retrospective',
  'note',
] as const;
export type InitiativeArtifactType = (typeof INITIATIVE_ARTIFACT_TYPES)[number];

export const INITIATIVE_ARTIFACT_TYPE_LABELS: Record<InitiativeArtifactType, string> = {
  brainstorm: 'Brainstorm',
  'forge-report': 'Forge report',
  research: 'Research',
  'product-brief': 'Product brief',
  prfaq: 'PRFAQ',
  prd: 'PRD',
  ux: 'UX design',
  architecture: 'Architecture',
  'project-context': 'Project context',
  retrospective: 'Retrospective',
  note: 'Note',
};

/** Shared contracts every epic must stay consistent with (accepted versions are pre-granted to step sessions). */
export const INITIATIVE_CONTRACT_ARTIFACT_TYPES: readonly InitiativeArtifactType[] = [
  'product-brief',
  'prfaq',
  'prd',
  'ux',
  'architecture',
  'project-context',
];

export const INITIATIVE_ARTIFACT_STATUSES = ['draft', 'accepted'] as const;
export type InitiativeArtifactStatus = (typeof INITIATIVE_ARTIFACT_STATUSES)[number];

export const WORK_ITEM_KINDS = ['epic', 'story', 'spike', 'bug'] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

/** BMad build statuses. Linked items take theirs from the ticket (see `workItemStatusFromTicketStatus`). */
export const WORK_ITEM_STATUSES = [
  'draft',
  'ready-for-dev',
  'in-progress',
  'built',
  'done',
  'blocked',
  'dropped',
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Built or done items are never rewritten (BMad: "built work is not rewritten"); changes add new items instead. */
export const LOCKED_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['built', 'done'];

export const UNKNOWN_RESOLUTIONS = ['settle_now', 'spike', 'leave_to_stories'] as const;
export type UnknownResolution = (typeof UNKNOWN_RESOLUTIONS)[number];

export const FINDING_SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_SOURCES = ['run', 'retrospective', 'automation', 'chat', 'task', 'human'] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_STATUSES = ['open', 'converted', 'dismissed'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const RETROSPECTIVE_VERDICTS = ['accepted', 'accepted-with-open-items', 'rejected'] as const;
export type RetrospectiveVerdict = (typeof RETROSPECTIVE_VERDICTS)[number];

export const PROPOSAL_STATUSES = ['open', 'accepted', 'rejected', 'stale'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_ORIGINS = ['human', 'run', 'chat', 'task', 'automation'] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

export const RUN_STATUSES = [
  'pending',
  'working',
  'needs_input',
  'ready',
  'accepted',
  'discarded',
  'failed',
  'cancelled',
] as const;
export type InitiativeRunStatus = (typeof RUN_STATUSES)[number];

/** Runs that still hold their target (one active run per target). */
export const ACTIVE_RUN_STATUSES: readonly InitiativeRunStatus[] = ['pending', 'working', 'needs_input', 'ready'];
/** Runs that may receive a user message. */
export const ANSWERABLE_RUN_STATUSES: readonly InitiativeRunStatus[] = ['needs_input', 'ready'];

export const RUN_MODES = ['create', 'update', 'validate'] as const;
export type InitiativeRunMode = (typeof RUN_MODES)[number];

/** Coaching works section by section; fast drafts at once and tags guesses as [ASSUMPTION] (BMad PM modes). */
export const RUN_STYLES = ['coaching', 'fast'] as const;
export type InitiativeRunStyle = (typeof RUN_STYLES)[number];

/** What a step produces when its result is accepted. */
export type InitiativeStepOutput =
  | { kind: 'artifact'; artifactType: InitiativeArtifactType }
  | { kind: 'epics' }
  | { kind: 'epic-refinement' }
  | { kind: 'stories' }
  | { kind: 'review' }
  | { kind: 'retrospective' }
  | { kind: 'proposal' };

/** A requirement for starting a step (hard) or a recommendation (soft). */
export type InitiativeStepNeed =
  | { kind: 'intent' }
  | { kind: 'artifact'; artifactTypes: readonly InitiativeArtifactType[] }
  | { kind: 'target-epic' }
  | { kind: 'refined-epic' }
  | { kind: 'epic-with-stories' }
  | { kind: 'epics' };

export type InitiativeStepTarget = 'initiative' | 'epic';

export interface InitiativeStepDefinition {
  key: InitiativeStepKey;
  phase: InitiativePhase;
  /** Sub-section of the plan phase (BMad: define / design / slice). */
  section?: 'define' | 'design' | 'slice';
  role: InitiativeRole;
  title: string;
  summary: string;
  modes: readonly InitiativeRunMode[];
  target: InitiativeStepTarget;
  output: InitiativeStepOutput;
  hardNeeds: readonly InitiativeStepNeed[];
  softNeeds: readonly InitiativeStepNeed[];
  /** Paths for which "What's next" recommends the step. */
  recommendedFor: readonly InitiativePath[];
  /** Role-specific instructions for the step session (part of the fixed platform prompt). */
  instructions: string;
}

export const INITIATIVE_STEP_KEYS = [
  'brainstorm',
  'forge-idea',
  'research',
  'product-brief',
  'prfaq',
  'prd',
  'ux',
  'architecture',
  'project-context',
  'slice-epics',
  'refine-epic',
  'incept-stories',
  'readiness-review',
  'retrospective',
  'correct-course',
] as const;
export type InitiativeStepKey = (typeof INITIATIVE_STEP_KEYS)[number];

const INTENT: InitiativeStepNeed = { kind: 'intent' };
const ARTIFACT_STEP_MODES: readonly InitiativeRunMode[] = ['create', 'update', 'validate'];

export const INITIATIVE_STEPS: readonly InitiativeStepDefinition[] = [
  {
    key: 'brainstorm',
    phase: 'clarify',
    role: 'analyst',
    title: 'Brainstorm',
    summary: 'Generate many options around the intent before narrowing down.',
    modes: ['create', 'update'],
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'brainstorm' },
    hardNeeds: [INTENT],
    softNeeds: [],
    recommendedFor: [],
    instructions:
      'Facilitate a brainstorming session. Push for quantity first (many distinct ideas, grouped by theme), then help ' +
      'the user cluster, rank and shortlist. Use techniques such as "how might we", inversion, constraints removal and ' +
      'analogies. Do not converge too early. The document records themes, the long list, the shortlist with reasons ' +
      'and the open questions.',
  },
  {
    key: 'forge-idea',
    phase: 'clarify',
    role: 'analyst',
    title: 'Forge the idea',
    summary: 'Pressure-test a half-formed idea until it hardens, proves out, or dies cheaply.',
    modes: ['create', 'update'],
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'forge-report' },
    hardNeeds: [INTENT],
    softNeeds: [],
    recommendedFor: ['project'],
    instructions:
      'Pressure-test the intent through pointed questions: who has the problem, how do they solve it today, what must ' +
      'be true for the idea to work, what would kill it, and what is the smallest version worth building. Challenge ' +
      'vague answers. The report ends with a verdict (hardened / needs evidence / dropped), the hardened intent ' +
      '(what is true when done, what must not change, what is out of scope) and the riskiest assumptions.',
  },
  {
    key: 'research',
    phase: 'clarify',
    role: 'analyst',
    title: 'Research a decision',
    summary: 'Gather evidence for a decision; every claim is cited.',
    modes: ['create', 'update'],
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'research' },
    hardNeeds: [INTENT],
    softNeeds: [],
    recommendedFor: [],
    instructions:
      'Clarify the decision the research must support first. Then investigate: the repository (read-only tools) and, ' +
      'when web tools are available, external sources. Cite every claim (file path, URL or ref). Separate facts from ' +
      'interpretation, list options with trade-offs and end with a recommendation and its confidence.',
  },
  {
    key: 'product-brief',
    phase: 'plan',
    section: 'define',
    role: 'product_manager',
    title: 'Product brief',
    summary: 'A one- to two-page account of the product concept.',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'product-brief' },
    hardNeeds: [INTENT],
    softNeeds: [{ kind: 'artifact', artifactTypes: ['forge-report', 'research', 'brainstorm'] }],
    recommendedFor: [],
    instructions:
      'Write a short product brief sized to its purpose: problem, target users, the proposed solution, why now, ' +
      'success metrics and scope boundaries. Keep it to one or two pages.',
  },
  {
    key: 'prfaq',
    phase: 'plan',
    section: 'define',
    role: 'product_manager',
    title: 'PRFAQ',
    summary: 'Customer-first stress test working backwards from a press release.',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'prfaq' },
    hardNeeds: [INTENT],
    softNeeds: [],
    recommendedFor: [],
    instructions:
      'Work backwards: draft the press release announcing the finished product (headline, problem, solution, quote, ' +
      'how to get started), then the customer FAQ and the internal FAQ (cost, risks, dependencies). Use the FAQs to ' +
      'expose weak spots in the concept.',
  },
  {
    key: 'prd',
    phase: 'plan',
    section: 'define',
    role: 'product_manager',
    title: 'PRD',
    summary: 'What to build and why (not how), with stable requirement IDs.',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'prd' },
    hardNeeds: [INTENT],
    softNeeds: [{ kind: 'artifact', artifactTypes: ['product-brief', 'prfaq', 'forge-report', 'research'] }],
    recommendedFor: ['project'],
    instructions:
      'Write the PRD: what to build and why, never how. Group features; give every functional requirement a stable ' +
      'ID (FR-1, FR-2, …) and keep IDs stable on updates (never renumber, retire instead). Non-functional requirements ' +
      'go in their own section (NFR-1, …). User journeys use a named protagonist. On update, reconcile the PRD with ' +
      'the requested change and flag conflicts with earlier decisions before applying anything.',
  },
  {
    key: 'ux',
    phase: 'plan',
    section: 'design',
    role: 'ux_designer',
    title: 'UX design',
    summary: 'How the product looks and behaves.',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'ux' },
    hardNeeds: [INTENT],
    softNeeds: [{ kind: 'artifact', artifactTypes: ['prd'] }],
    recommendedFor: [],
    instructions:
      'Record the UX: principles, information architecture, key screens and states (empty, loading, error), ' +
      'interaction patterns, accessibility requirements and the experience of the main journeys. Reference the PRD ' +
      'requirement IDs each screen serves. Reuse the patterns that already exist in the repository.',
  },
  {
    key: 'architecture',
    phase: 'plan',
    section: 'design',
    role: 'architect',
    title: 'Architecture',
    summary: 'Technical decisions that keep separately built parts consistent.',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'architecture' },
    hardNeeds: [INTENT],
    softNeeds: [{ kind: 'artifact', artifactTypes: ['prd'] }],
    recommendedFor: ['project'],
    instructions:
      'Explore the repository with the read-only tools first. Record only the decisions that keep separately built ' +
      'parts consistent: components and their responsibilities, data model, interfaces and contracts, cross-cutting ' +
      'concerns (security, errors, observability), and the patterns to follow. For each decision give the options ' +
      'considered and the reason. Reference PRD requirement IDs and real file paths.',
  },
  {
    key: 'project-context',
    phase: 'learn',
    role: 'analyst',
    title: 'Project context',
    summary: 'The verified agent-instruction block for the repository (set up, refresh or audit).',
    modes: ARTIFACT_STEP_MODES,
    target: 'initiative',
    output: { kind: 'artifact', artifactType: 'project-context' },
    hardNeeds: [],
    softNeeds: [],
    recommendedFor: [],
    instructions:
      'Maintain a small, verified block of agent instructions for the repository. Keep only what agents cannot learn ' +
      'from the code: organisational policy, frozen or generated paths, branch rules, non-obvious command caveats, ' +
      'conventions that differ from ecosystem defaults, observed pitfalls, cross-component rules, required tool ' +
      'versions and pointers. Exclude overviews, directory trees and stack lists (they go stale). Verify every path ' +
      'you name with the read-only tools. On audit, the result is the same size or smaller. Applying the block to the ' +
      'repository is done later through a normal chat plan, not in this session.',
  },
  {
    key: 'slice-epics',
    phase: 'plan',
    section: 'slice',
    role: 'product_owner',
    title: 'Slice into epics',
    summary: 'Cut the initiative requirements into epics in build order.',
    modes: ['create', 'update'],
    target: 'initiative',
    output: { kind: 'epics' },
    hardNeeds: [INTENT],
    softNeeds: [{ kind: 'artifact', artifactTypes: ['prd', 'architecture'] }],
    recommendedFor: ['session', 'epic', 'project'],
    instructions:
      'Slice the initiative into epics, each one outcome that needs several build sessions (for the session path: ' +
      'exactly one epic). Every epic gets a title, its outcome, boundaries (in / out of scope) and done-when checks, ' +
      'and starts unrefined. Order the epics in build order and name dependencies between them ("after"). Requirements ' +
      'are cut from the shared contracts (PRD, architecture): reference their IDs. In update mode, propose only ' +
      'changes; epics that are built or done are never rewritten.',
  },
  {
    key: 'refine-epic',
    phase: 'plan',
    section: 'slice',
    role: 'product_owner',
    title: 'Refine epic',
    summary: 'Record settled points, resolve open points and write the epic requirements.',
    modes: ['create'],
    target: 'epic',
    output: { kind: 'epic-refinement' },
    hardNeeds: [{ kind: 'target-epic' }],
    softNeeds: [],
    recommendedFor: ['session', 'epic', 'project'],
    instructions:
      'Refine the target epic. Record what is settled, and give every open point a resolution: settle it now (ask the ' +
      'user), plan a spike, or leave it to the stories. Then write the epic requirements (functional and ' +
      'non-functional, with IDs referencing the shared contracts) and the done-when checks. Ask the user before ' +
      'settling anything that is a product decision.',
  },
  {
    key: 'incept-stories',
    phase: 'plan',
    section: 'slice',
    role: 'product_owner',
    title: 'Incept stories',
    summary: 'Propose the stories, spikes and bugs of an epic in build order with dependencies.',
    modes: ['create', 'update'],
    target: 'epic',
    output: { kind: 'stories' },
    hardNeeds: [{ kind: 'refined-epic' }],
    softNeeds: [],
    recommendedFor: ['session', 'epic', 'project'],
    instructions:
      'Slice the refined target epic into stories (one coherent build session each), spikes for open questions and ' +
      'bugs, in build order. Each item gets a title, requirements (with the requirement IDs it covers), a "Verify:" ' +
      'check, "done when" criteria, and "after" dependencies (keys of earlier items or other epics). Mark open ' +
      'questions as unknowns. Every epic requirement must be covered by at least one item; say which ones are not. ' +
      'In update mode, never rewrite items that are built or done.',
  },
  {
    key: 'readiness-review',
    phase: 'plan',
    section: 'slice',
    role: 'product_owner',
    title: 'Readiness review',
    summary: 'Check that an epic is ready to build: coverage, order, open unknowns.',
    modes: ['validate'],
    target: 'epic',
    output: { kind: 'review' },
    hardNeeds: [{ kind: 'epic-with-stories' }],
    softNeeds: [],
    recommendedFor: ['epic', 'project'],
    instructions:
      'Review the target epic and its items before building: are all requirements covered and traceable, is the order ' +
      'buildable (no item depends on a later one, no cycles), are verify checks concrete, are unknowns resolved or ' +
      'planned as spikes, and is anything inconsistent with the shared contracts? Report each gap as a finding with ' +
      'a severity, and end with a verdict: accepted (ready), accepted-with-open-items, or rejected (not ready).',
  },
  {
    key: 'retrospective',
    phase: 'learn',
    role: 'developer',
    title: 'Epic retrospective',
    summary: 'Judge the combined results of an epic against its requirements, from evidence.',
    modes: ['create'],
    target: 'epic',
    output: { kind: 'retrospective' },
    hardNeeds: [{ kind: 'epic-with-stories' }],
    softNeeds: [],
    recommendedFor: ['epic', 'project'],
    instructions:
      'Review the finished epic from evidence, not recollection: the epic and story requirements, the linked tickets ' +
      '(status, comments, automation results, branches and commits named there) and the repository (read-only ' +
      'tools). Look for aggregate defects, seams between stories, drift from the specification, runtime behaviour ' +
      'problems, whether the previous retrospective action items were done, and whether the epic met its done-when ' +
      'checks. Every finding cites its evidence (file, ticket, commit). Unfinished stories force the verdict ' +
      '"rejected". The report lists the evidence inventory, grouped findings, the verdict and proposed action items ' +
      '(fix now or new stories) and spec reconciliations; decisions are proposed, never assumed.',
  },
  {
    key: 'correct-course',
    phase: 'learn',
    role: 'product_owner',
    title: 'Correct course',
    summary: 'Turn findings or a change of direction into a change proposal.',
    modes: ['create'],
    target: 'initiative',
    output: { kind: 'proposal' },
    hardNeeds: [INTENT],
    softNeeds: [],
    recommendedFor: [],
    instructions:
      'Draft a change proposal from the selected findings or the user request. Update requirements first (in the ' +
      'shared contracts, keeping IDs stable), then re-slice only work that has not started: add, update, reorder or ' +
      'drop items, and adjust dependencies. Built or done items are never rewritten; add new items instead. Record ' +
      'each decision as a dated decision line with its reason.',
  },
];

export function findInitiativeStep(key: unknown): InitiativeStepDefinition | undefined {
  return INITIATIVE_STEPS.find((step) => step.key === key);
}

export function isInitiativeStepKey(value: unknown): value is InitiativeStepKey {
  return typeof value === 'string' && (INITIATIVE_STEP_KEYS as readonly string[]).includes(value);
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isInitiativePath = (value: unknown): value is InitiativePath => includes(INITIATIVE_PATHS, value);
export const isInitiativePhase = (value: unknown): value is InitiativePhase => includes(INITIATIVE_PHASES, value);
export const isInitiativeState = (value: unknown): value is InitiativeState => includes(INITIATIVE_STATES, value);
export const isInitiativeArtifactType = (value: unknown): value is InitiativeArtifactType =>
  includes(INITIATIVE_ARTIFACT_TYPES, value);
export const isWorkItemKind = (value: unknown): value is WorkItemKind => includes(WORK_ITEM_KINDS, value);
export const isWorkItemStatus = (value: unknown): value is WorkItemStatus => includes(WORK_ITEM_STATUSES, value);
export const isFindingSeverity = (value: unknown): value is FindingSeverity => includes(FINDING_SEVERITIES, value);
export const isUnknownResolution = (value: unknown): value is UnknownResolution => includes(UNKNOWN_RESOLUTIONS, value);
export const isRetrospectiveVerdict = (value: unknown): value is RetrospectiveVerdict =>
  includes(RETROSPECTIVE_VERDICTS, value);
export const isInitiativeRunMode = (value: unknown): value is InitiativeRunMode => includes(RUN_MODES, value);
export const isInitiativeRunStyle = (value: unknown): value is InitiativeRunStyle => includes(RUN_STYLES, value);

/** Input bounds shared by the API, the turn-status parser and the console. */
export const INITIATIVE_LIMITS = {
  titleMaxLength: 500,
  intentMaxLength: 50_000,
  contentMaxLength: 200_000,
  requirementsMaxLength: 50_000,
  shortTextMaxLength: 4_000,
  messageMaxLength: 32_000,
  findingMaxLength: 8_000,
  /** Work items, findings and decisions one turn / proposal may carry. */
  itemsPerTurnMax: 200,
  dependenciesPerItemMax: 50,
  unknownsPerItemMax: 50,
  evidenceRefsMax: 20,
  workItemsPerInitiativeMax: 2_000,
  listDefaultLimit: 50,
  listMaxLimit: 200,
  /** Active (pending / working / needs input / ready) runs per workspace. */
  activeRunsPerClientDefault: 3,
} as const;
