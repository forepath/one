import { parseDocument } from 'yaml';

import { SCHEMA_STEP_LABELS } from './schema-form-labels';

/** One step of the resource wizard (3.37): its top-level spec keys, or the Kind / General / Review steps. */
export interface WizardStep {
  id: string;
  label: string;
  /** The spec keys this step edits (General: the ones no typed step claims). */
  keys: string[];
}

/** A typed step of a kind: the spec keys it edits (in order). */
interface StepRule {
  id: string;
  label: string;
  keys: readonly string[];
}

const L = {
  kind: $localize`:@@lwConsoleWizard-stepKind:Kind`,
  general: $localize`:@@lwConsoleWizard-stepGeneral:General`,
  source: $localize`:@@lwConsoleWizard-stepSource:Source image / import`,
  hardware: $localize`:@@lwConsoleWizard-stepHardware:Hardware`,
  placement: $localize`:@@lwConsoleWizard-stepPlacement:Placement`,
  network: $localize`:@@lwConsoleWizard-stepNetwork:Network`,
  workload: $localize`:@@lwConsoleWizard-stepWorkload:Workload`,
  spec: $localize`:@@lwConsoleWizard-stepSpec:Settings`,
  review: $localize`:@@lwConsoleWizard-stepReview:Review`,
  ...SCHEMA_STEP_LABELS,
};

const STEP_LABELS: Readonly<Record<string, string>> = L;
const rule = (id: string, keys: readonly string[]): StepRule => ({ id, label: STEP_LABELS[id] ?? id, keys });

/**
 * The typed steps of every published kind (2026-10-29, "full form coverage"): General carries name, project and the
 * keys no step claims (description, title, …); empty steps are skipped. Kinds without rules (few fields) are General
 * only; unknown kinds get one "Settings" step.
 */
const RULES: Record<string, readonly StepRule[]> = {
  Cluster: [
    rule('network', ['network', 'failureDomain', 'controlPlaneSize']),
    rule('access', ['nodeShellEnabled', 'terminalRecording', 'terminalRecordingRetentionDays', 'remoteAccess']),
    rule('services', ['registry', 'vmImages', 'ingress', 'git']),
    rule('operations', ['observability', 'egress', 'updates', 'backups']),
  ],
  Site: [rule('location', ['location'])],
  Node: [],
  NodeGroup: [rule('selection', ['selector'])],
  WorkloadGroup: [rule('selection', ['selector'])],
  Policy: [
    rule('peers', ['from', 'to']),
    rule('rules', ['rules']),
    rule('egress', [
      'egress',
      'egressMode',
      'denyUrlPatterns',
      'blockPrivateNetworks',
      'blockIpLiterals',
      'logAllowed',
    ]),
  ],
  Project: [rule('limits', ['defaults', 'quota', 'workloads']), rule('billing', ['billing'])],
  Deployment: [rule('workload', ['compose', 'variables'])],
  DnsProvider: [rule('nameServers', ['nodeGroup', 'nameServers', 'servers'])],
  DnsZone: [rule('secondaries', ['secondaries', 'registrar'])],
  DnsRecord: [rule('record', ['zone', 'name', 'type', 'values', 'ttl', 'priority'])],
  IpPool: [
    rule('addresses', ['cidrs', 'purposes', 'projects']),
    rule('failover', ['nodeGroup', 'failover', 'bgpMode', 'provider', 'cooldownSeconds']),
  ],
  DnsFailover: [
    rule('endpoints', ['host', 'mode', 'endpoints']),
    rule('check', ['check', 'intervalSeconds', 'failAfter', 'recoverAfter', 'failback', 'stableSeconds', 'ttl']),
  ],
  AutonomousSystem: [],
  BgpPeer: [
    rule('peer', ['asn', 'address', 'nodeGroup', 'multihop', 'password', 'bfd']),
    rule('routes', ['import', 'maxPrefixes', 'localPref']),
  ],
  BgpAnnouncement: [
    rule('announcement', ['prefixes', 'nodeGroup', 'peers', 'mode', 'primarySite']),
    rule('routing', ['communities', 'prepend', 'med', 'whenHealthy']),
  ],
  AlertRule: [rule('condition', ['condition', 'for']), rule('notification', ['notify', 'repeatEvery', 'escalate'])],
  Dashboard: [rule('widgets', ['widgets'])],
  StatusPage: [rule('services', ['services'])],
  ClientGroup: [rule('posture', ['posture'])],
  ImagePolicy: [rule('selection', ['selector']), rule('requirements', ['requireSignature', 'vulnerabilities'])],
  MaintenanceWindow: [rule('schedule', ['days', 'start', 'end', 'timeZone']), rule('selection', ['selector', 'sites'])],
  BackupPolicy: [
    rule('selection', ['selector']),
    rule('retention', ['schedules', 'timeZone', 'retention', 'hooks', 'restoreTest']),
    rule('targets', ['targets']),
  ],
  // A union at the spec root (S3 | SFTP): one step with every key of both.
  BackupTarget: [
    rule('target', [
      'type',
      'description',
      'endpoint',
      'bucket',
      'region',
      'prefix',
      'credentials',
      'objectLock',
      'host',
      'port',
      'user',
      'path',
      'keySecret',
      'knownHosts',
    ]),
  ],
  Restore: [rule('restore', ['backup', 'target'])],
  NodeImport: [
    rule('import', ['node', 'selection', 'discovery', 'wipeFormerIdentity', 'reservedPorts']),
    rule('steps', ['steps']),
  ],
  VirtualMachine: [
    rule('source', ['image', 'firmware', 'cloudInit']),
    rule('hardware', ['cpu', 'memory', 'disks']),
    rule('network', ['nics']),
    rule('placement', ['placement', 'ha', 'liveMigration', 'runStrategy', 'console']),
  ],
};

/** Where a kind's resources live (mirror of the server's kind registry, `RESOURCE_KINDS[kind].scope`). */
export type KindScope = 'cluster' | 'project' | 'any';

const SCOPES: Record<string, KindScope> = {
  Cluster: 'cluster',
  Site: 'cluster',
  Node: 'cluster',
  NodeGroup: 'cluster',
  WorkloadGroup: 'project',
  Policy: 'any',
  Project: 'cluster',
  Deployment: 'project',
  DnsProvider: 'cluster',
  DnsZone: 'cluster',
  DnsRecord: 'any',
  IpPool: 'cluster',
  DnsFailover: 'cluster',
  AutonomousSystem: 'cluster',
  BgpPeer: 'cluster',
  BgpAnnouncement: 'cluster',
  AlertRule: 'any',
  Dashboard: 'any',
  StatusPage: 'project',
  ClientGroup: 'cluster',
  ImagePolicy: 'any',
  MaintenanceWindow: 'cluster',
  BackupPolicy: 'any',
  BackupTarget: 'cluster',
  Restore: 'project',
  NodeImport: 'cluster',
  VirtualMachine: 'project',
};

/** The scope of a kind (unknown kinds: `any`, the server decides). */
export function kindScope(kind: string): KindScope {
  return Object.prototype.hasOwnProperty.call(SCOPES, kind) ? SCOPES[kind] : 'any';
}

/** Whether `kind` has typed steps (else one "Settings" step after General). */
export function hasTypedSteps(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULES, kind);
}

/**
 * The steps of the resource wizard of `kind` with its spec `keys` (from the schema): General (name, project + the
 * keys no typed step claims), the kind's typed steps (those without keys of the schema skipped), Review.
 */
export function wizardSteps(kind: string, keys: readonly string[]): WizardStep[] {
  const rules = RULES[kind];

  if (!rules) {
    return [
      { id: 'general', label: L.general, keys: [] },
      ...(keys.length > 0 ? [{ id: 'spec', label: L.spec, keys: [...keys] }] : []),
      { id: 'review', label: L.review, keys: [] },
    ];
  }

  const claimed = new Set(rules.flatMap((r) => r.keys));
  const typed = rules
    .map((r) => ({ id: r.id, label: r.label, keys: r.keys.filter((k) => keys.includes(k)) }))
    .filter((step) => step.keys.length > 0);
  const general: WizardStep = { id: 'general', label: L.general, keys: keys.filter((k) => !claimed.has(k)) };

  return [general, ...typed, { id: 'review', label: L.review, keys: [] }];
}

/** The first step of a create flow opened without a kind (Create ▾ "Other kind", `/create`): choose the kind. */
export const KIND_STEP: WizardStep = { id: 'kind', label: L.kind, keys: [] };

/**
 * The step a validation issue (document path) belongs to, so the stepper can mark it: `metadata` / `kind` →
 * General; `spec.<key>…` (or `spec: missing property "<key>"`) → the step that edits `<key>`; `spec` itself (a
 * union at the root) → the first step with spec keys; anything else (YAML syntax, unknown keys) → Review.
 */
export function stepOfIssue(steps: readonly WizardStep[], path: readonly (string | number)[], message = ''): string {
  const root = path[0];
  const key = path.length === 1 && root === 'spec' ? /missing property "([^"]+)"/.exec(message)?.[1] : path[1];

  if (root === 'metadata' || root === 'kind' || root === 'apiVersion') return 'general';

  if (root === 'spec' && typeof key === 'string') {
    const owner = steps.find((step) => step.keys.includes(key));

    if (owner) return owner.id;
  }

  if (root === 'spec' && path.length === 1) {
    const first = steps.find((step) => step.keys.length > 0);

    if (first) return first.id;
  }

  return 'review';
}

/** The document's `metadata.name` / `metadata.project`. */
export function documentMetadata(document: string): { name: string; project: string | null } {
  try {
    const doc = parseDocument(document);
    const name = doc.getIn(['metadata', 'name']);
    const project = doc.getIn(['metadata', 'project']);

    return {
      name: typeof name === 'string' ? name : '',
      project: typeof project === 'string' && project ? project : null,
    };
  } catch {
    return { name: '', project: null };
  }
}

/** Sets `metadata.name` / `metadata.project` (null removes the project), keeping the rest of the document. */
export function withDocumentMetadata(document: string, name: string, project: string | null): string {
  const doc = parseDocument(document);

  doc.setIn(['metadata', 'name'], name);

  if (project) doc.setIn(['metadata', 'project'], project);
  else doc.deleteIn(['metadata', 'project']);

  return doc.toString({ lineWidth: 0 });
}

/** Sets `spec.<key>` (keeping the rest of the document), e.g. a VM's image picked from the catalog (3.42). */
export function withSpecField(document: string, key: string, value: unknown): string {
  const doc = parseDocument(document);

  // A new node: the old value's quoting (an empty `""`) isn't carried over.
  doc.setIn(['spec', key], doc.createNode(value));

  return doc.toString({ lineWidth: 0 });
}

/** Resource names (DNS labels): lower-case letters, digits and `-`, 1–63 characters. */
export function validResourceName(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

/** `key=value` → a label (key: DNS-ish segments with an optional `prefix/`; null when malformed). */
export function parseLabel(input: string): { key: string; value: string } | null {
  const match = input.trim().match(/^([a-z0-9]([a-z0-9.\-/]*[a-z0-9])?)=([A-Za-z0-9._-]{0,63})$/i);

  return match ? { key: match[1], value: match[3] } : null;
}

/** Sets `metadata.labels.<key>` (keeping the rest of the document). */
export function withDocumentLabel(document: string, key: string, value: string): string {
  const doc = parseDocument(document);

  doc.setIn(['metadata', 'labels', key], value);

  return doc.toString({ lineWidth: 0 });
}
