import {
  FINDING_SEVERITIES,
  INITIATIVE_LIMITS,
  RETROSPECTIVE_VERDICTS,
  UNKNOWN_RESOLUTIONS,
  isFindingSeverity,
  isInitiativeArtifactType,
  isRetrospectiveVerdict,
  isUnknownResolution,
  type FindingSeverity,
  type InitiativeArtifactType,
  type RetrospectiveVerdict,
  type UnknownResolution,
  type WorkItemKind,
} from './catalog';

/** Status the agent reports at the end of every step-session turn. */
export const INITIATIVE_TURN_STATUSES = ['needs_input', 'drafting', 'ready'] as const;
export type InitiativeTurnStatusValue = (typeof INITIATIVE_TURN_STATUSES)[number];

export interface InitiativeTurnUnknown {
  question: string;
  resolution: UnknownResolution;
}

/** A work item proposed in a turn. `key` is a placeholder (e.g. `N1`) or an existing key on updates. */
export interface InitiativeTurnWorkItem {
  key: string;
  kind: Exclude<WorkItemKind, 'epic'> | 'epic';
  title: string;
  requirements?: string;
  verify?: string;
  doneWhen?: string;
  /** Keys (placeholders of this turn or existing keys) this item comes after. */
  after: string[];
  unknowns: InitiativeTurnUnknown[];
}

export interface InitiativeTurnFinding {
  severity: FindingSeverity;
  body: string;
  /** Work item key the finding is about (optional). */
  itemKey?: string;
  evidence: string[];
}

export interface InitiativeTurnDecision {
  title: string;
  body: string;
}

export interface InitiativeTurnArtifactChange {
  type: InitiativeArtifactType;
  title?: string;
  content: string;
}

/** Work-item operation of a change proposal (correct course). */
export type InitiativeWorkItemOperation =
  | { op: 'add'; item: InitiativeTurnWorkItem; parentKey?: string }
  | {
      op: 'update';
      key: string;
      title?: string;
      requirements?: string;
      verify?: string;
      doneWhen?: string;
      after?: string[];
    }
  | { op: 'drop'; key: string }
  | { op: 'move'; key: string; beforeKey?: string };

export interface InitiativeTurnProposal {
  title: string;
  rationale: string;
  artifacts: InitiativeTurnArtifactChange[];
  workItems: InitiativeWorkItemOperation[];
  decisions: InitiativeTurnDecision[];
}

export interface InitiativeTurnStatus {
  status: InitiativeTurnStatusValue;
  message?: string;
  summary?: string;
  draftMarkdown?: string;
  workItems: InitiativeTurnWorkItem[];
  epic?: { requirements: string; doneWhen?: string; unknowns: InitiativeTurnUnknown[] };
  findings: InitiativeTurnFinding[];
  decisions: InitiativeTurnDecision[];
  verdict?: RetrospectiveVerdict;
  proposal?: InitiativeTurnProposal;
}

const PLACEHOLDER_OR_KEY = /^(?:[A-Za-z][A-Za-z0-9]{0,7}|E\d{1,4}(?:\.S\d{1,4})?)$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  // Bounded, never rejected: the agent's output is clipped instead of failing the whole turn.
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function list(value: unknown, max: number = INITIATIVE_LIMITS.itemsPerTurnMax): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function keyList(value: unknown): string[] {
  return [
    ...new Set(
      list(value, INITIATIVE_LIMITS.dependenciesPerItemMax)
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => PLACEHOLDER_OR_KEY.test(entry)),
    ),
  ];
}

function parseUnknowns(value: unknown): InitiativeTurnUnknown[] {
  const result: InitiativeTurnUnknown[] = [];

  for (const entry of list(value, INITIATIVE_LIMITS.unknownsPerItemMax)) {
    const raw = record(entry);
    const question = text(raw?.['question'] ?? entry, INITIATIVE_LIMITS.shortTextMaxLength);

    if (question) {
      result.push({
        question,
        resolution: isUnknownResolution(raw?.['resolution']) ? raw['resolution'] : 'settle_now',
      });
    }
  }

  return result;
}

export function parseInitiativeTurnWorkItem(value: unknown): InitiativeTurnWorkItem | undefined {
  const raw = record(value);
  const key = typeof raw?.['key'] === 'string' ? raw['key'].trim() : '';
  const title = text(raw?.['title'], INITIATIVE_LIMITS.titleMaxLength);
  const kind = raw?.['kind'];

  if (!raw || !PLACEHOLDER_OR_KEY.test(key) || !title) {
    return undefined;
  }

  return {
    key,
    kind: kind === 'epic' || kind === 'spike' || kind === 'bug' ? kind : 'story',
    title,
    requirements: text(raw['requirements'], INITIATIVE_LIMITS.requirementsMaxLength),
    verify: text(raw['verify'], INITIATIVE_LIMITS.shortTextMaxLength),
    doneWhen: text(raw['doneWhen'], INITIATIVE_LIMITS.shortTextMaxLength),
    after: keyList(raw['after']),
    unknowns: parseUnknowns(raw['unknowns']),
  };
}

export function parseInitiativeTurnFinding(value: unknown): InitiativeTurnFinding | undefined {
  const raw = record(value);
  const body = text(
    raw?.['body'] ?? (typeof value === 'string' ? value : undefined),
    INITIATIVE_LIMITS.findingMaxLength,
  );

  if (!body) {
    return undefined;
  }

  const itemKey =
    typeof raw?.['itemKey'] === 'string' && PLACEHOLDER_OR_KEY.test(raw['itemKey'].trim())
      ? raw['itemKey'].trim()
      : undefined;

  return {
    severity: isFindingSeverity(raw?.['severity']) ? raw['severity'] : 'minor',
    body,
    ...(itemKey ? { itemKey } : {}),
    evidence: list(raw?.['evidence'], INITIATIVE_LIMITS.evidenceRefsMax)
      .map((entry) => text(entry, 500))
      .filter((entry): entry is string => !!entry),
  };
}

function parseDecisions(value: unknown): InitiativeTurnDecision[] {
  const result: InitiativeTurnDecision[] = [];

  for (const entry of list(value)) {
    const raw = record(entry);
    const title = text(raw?.['title'], INITIATIVE_LIMITS.titleMaxLength);
    const body = text(raw?.['body'], INITIATIVE_LIMITS.shortTextMaxLength) ?? '';

    if (title) {
      result.push({ title, body });
    }
  }

  return result;
}

function parseWorkItemOperation(value: unknown): InitiativeWorkItemOperation | undefined {
  const raw = record(value);
  const key = typeof raw?.['key'] === 'string' ? raw['key'].trim() : '';

  switch (raw?.['op']) {
    case 'add': {
      const item = parseInitiativeTurnWorkItem(raw['item'] ?? raw);
      const parentKey = typeof raw['parentKey'] === 'string' ? raw['parentKey'].trim() : undefined;

      return item
        ? { op: 'add', item, ...(parentKey && PLACEHOLDER_OR_KEY.test(parentKey) ? { parentKey } : {}) }
        : undefined;
    }
    case 'update': {
      if (!PLACEHOLDER_OR_KEY.test(key)) {
        return undefined;
      }

      const title = text(raw['title'], INITIATIVE_LIMITS.titleMaxLength);
      const requirements = text(raw['requirements'], INITIATIVE_LIMITS.requirementsMaxLength);
      const verify = text(raw['verify'], INITIATIVE_LIMITS.shortTextMaxLength);
      const doneWhen = text(raw['doneWhen'], INITIATIVE_LIMITS.shortTextMaxLength);

      return {
        op: 'update',
        key,
        ...(title ? { title } : {}),
        ...(requirements ? { requirements } : {}),
        ...(verify ? { verify } : {}),
        ...(doneWhen ? { doneWhen } : {}),
        ...(Array.isArray(raw['after']) ? { after: keyList(raw['after']) } : {}),
      };
    }
    case 'drop':
      return PLACEHOLDER_OR_KEY.test(key) ? { op: 'drop', key } : undefined;
    case 'move': {
      const beforeKey = typeof raw['beforeKey'] === 'string' ? raw['beforeKey'].trim() : undefined;

      return PLACEHOLDER_OR_KEY.test(key)
        ? { op: 'move', key, ...(beforeKey && PLACEHOLDER_OR_KEY.test(beforeKey) ? { beforeKey } : {}) }
        : undefined;
    }
    default:
      return undefined;
  }
}

export function parseInitiativeProposal(value: unknown): InitiativeTurnProposal | undefined {
  const raw = record(value);
  const title = text(raw?.['title'], INITIATIVE_LIMITS.titleMaxLength);

  if (!raw || !title) {
    return undefined;
  }

  const artifacts: InitiativeTurnArtifactChange[] = [];

  for (const entry of list(raw['artifacts'], 20)) {
    const artifact = record(entry);
    const content = typeof artifact?.['content'] === 'string' ? artifact['content'] : undefined;

    if (artifact && isInitiativeArtifactType(artifact['type']) && content?.trim()) {
      artifacts.push({
        type: artifact['type'],
        ...(text(artifact['title'], INITIATIVE_LIMITS.titleMaxLength)
          ? { title: text(artifact['title'], INITIATIVE_LIMITS.titleMaxLength) }
          : {}),
        content: content.slice(0, INITIATIVE_LIMITS.contentMaxLength),
      });
    }
  }

  return {
    title,
    rationale: text(raw['rationale'], INITIATIVE_LIMITS.shortTextMaxLength) ?? '',
    artifacts,
    workItems: list(raw['workItems'])
      .map(parseWorkItemOperation)
      .filter((op): op is InitiativeWorkItemOperation => !!op),
    decisions: parseDecisions(raw['decisions']),
  };
}

/** Normalize a structured turn status (clipped and filtered; never throws). */
export function normalizeInitiativeTurnStatus(value: unknown): InitiativeTurnStatus | undefined {
  const raw = record(value);
  const status = raw?.['status'];

  if (!raw || !(INITIATIVE_TURN_STATUSES as readonly unknown[]).includes(status)) {
    return undefined;
  }

  const epic = record(raw['epic']);
  const epicRequirements = text(epic?.['requirements'], INITIATIVE_LIMITS.requirementsMaxLength);
  const draftMarkdown =
    typeof raw['draftMarkdown'] === 'string' && raw['draftMarkdown'].trim()
      ? raw['draftMarkdown'].slice(0, INITIATIVE_LIMITS.contentMaxLength)
      : undefined;

  return {
    status: status as InitiativeTurnStatusValue,
    message: text(raw['message'], INITIATIVE_LIMITS.messageMaxLength),
    summary: text(raw['summary'], 512),
    ...(draftMarkdown ? { draftMarkdown } : {}),
    workItems: list(raw['workItems'])
      .map(parseInitiativeTurnWorkItem)
      .filter((item): item is InitiativeTurnWorkItem => !!item),
    ...(epicRequirements
      ? {
          epic: {
            requirements: epicRequirements,
            doneWhen: text(epic?.['doneWhen'], INITIATIVE_LIMITS.shortTextMaxLength),
            unknowns: parseUnknowns(epic?.['unknowns']),
          },
        }
      : {}),
    findings: list(raw['findings'])
      .map(parseInitiativeTurnFinding)
      .filter((finding): finding is InitiativeTurnFinding => !!finding),
    decisions: parseDecisions(raw['decisions']),
    ...(isRetrospectiveVerdict(raw['verdict']) ? { verdict: raw['verdict'] } : {}),
    ...(raw['proposal'] !== undefined && parseInitiativeProposal(raw['proposal'])
      ? { proposal: parseInitiativeProposal(raw['proposal']) }
      : {}),
  };
}

/**
 * Extract the turn status from the agent's final text: the last fenced ```json block, or the whole text when it is a
 * JSON object. Returns undefined when nothing usable is found.
 */
export function parseInitiativeTurnStatusFromText(value: string): InitiativeTurnStatus | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const candidates: string[] = [];
  // Documents in the block (`draftMarkdown`) may contain code fences themselves, which end a lazy match early. The
  // status block is the last one: try every ```json opener (last first) up to the final closing fence.
  const closing = trimmed.lastIndexOf('```');
  const opener = /```json[^\S\n]*\n?/gi;
  const openers: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = opener.exec(trimmed)) !== null) {
    if (match.index + match[0].length <= closing) {
      openers.push(match.index + match[0].length);
    }
  }

  for (const from of openers.reverse()) {
    candidates.push(trimmed.slice(from, closing).trim());
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  const lazy: string[] = [];

  while ((match = fence.exec(trimmed)) !== null) {
    lazy.push(match[1].trim());
  }

  candidates.push(...lazy.reverse());
  candidates.push(trimmed);

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = normalizeInitiativeTurnStatus(JSON.parse(candidate) as unknown);

      if (parsed) {
        return parsed;
      }
    } catch {
      // try the next candidate
    }
  }

  return undefined;
}

/** Text of a turn without its trailing status block (shown when the agent wrote no `message`). */
export function stripInitiativeTurnStatusBlock(value: string): string {
  return value.replace(/```(?:json)?\s*\{[\s\S]*?"status"[\s\S]*?```\s*$/i, '').trim();
}

export const INITIATIVE_TURN_STATUS_DOC = {
  statuses: INITIATIVE_TURN_STATUSES,
  severities: FINDING_SEVERITIES,
  verdicts: RETROSPECTIVE_VERDICTS,
  resolutions: UNKNOWN_RESOLUTIONS,
} as const;
