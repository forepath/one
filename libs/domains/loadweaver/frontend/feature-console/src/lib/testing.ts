import type {
  AccessMe,
  Backup,
  BackupDeletion,
  BackupKeyGeneration,
  GitConnection,
  Plan,
  Rollout,
  UpdateRelease,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

/** A facade stub: every `*$` member a BehaviorSubject with the given value, every method a jest mock. */
export function facadeStub<T extends Record<string, unknown>>(
  streams: Record<string, unknown>,
  methods: string[],
): T & Record<string, BehaviorSubject<unknown> | jest.Mock> {
  const stub: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(streams)) stub[name] = new BehaviorSubject(value);

  for (const name of methods) stub[name] = jest.fn();

  return stub as T & Record<string, BehaviorSubject<unknown> | jest.Mock>;
}

export function accessStub(me: AccessMe | null = null) {
  return facadeStub(
    {
      me$: me,
      projects$: Object.keys(me?.projects ?? {}).sort(),
      seesInfrastructure$: !!me?.clusterRole,
      isClusterAdmin$: me?.clusterRole === 'cluster-admin',
      settled$: true,
    },
    ['load'],
  );
}

/** A Git connection (project `shop`, GitHub, bidirectional). */
export function testGitConnection(overrides: Partial<GitConnection> = {}): GitConnection {
  return {
    id: '6f1c1b0e-0000-4000-8000-000000000001',
    project: 'shop',
    provider: 'github',
    repoUrl: 'https://github.com/acme/infra.git',
    branch: 'main',
    path: 'shop',
    mode: 'bidirectional',
    credentials: 'secret://shop/git-token',
    apiUrl: null,
    caCertificate: null,
    pollIntervalSeconds: 60,
    webhook: true,
    webhookPath: '/api/git/webhooks/6f1c1b0e-0000-4000-8000-000000000001',
    approvalByMergeReview: false,
    membershipsFromGit: false,
    autoMerge: true,
    sops: false,
    githubApp: false,
    webhookGeneration: 0,
    hostKey: null,
    lastSyncedCommit: null,
    lastSyncAt: null,
    lastError: null,
    createdBy: 'u1',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

/** The Git facade as other views use it (connections for links and the authoritative mode). */
export function gitStub(connections: GitConnection[] = [], streams: Record<string, unknown> = {}) {
  return facadeStub(
    {
      connections$: connections,
      loaded$: true,
      loading$: false,
      error$: null,
      commits$: {},
      commitsLoading$: null,
      commitsError$: null,
      saving$: false,
      saveError$: null,
      saved$: null,
      created$: null,
      deleting$: null,
      deleteError$: null,
      acting$: null,
      actionError$: null,
      actionResult$: null,
      webhookSecret$: null,
      webhookSecretLoading$: null,
      webhookSecretRotating$: null,
      webhookSecretError$: null,
      sopsRecipient$: null,
      sopsLoaded$: false,
      sopsError$: null,
      sopsUnavailable$: false,
      ...streams,
    },
    [
      'load',
      'loadCommits',
      'create',
      'update',
      'clearSave',
      'remove',
      'run',
      'clearActionResult',
      'revealWebhookSecret',
      'rotateWebhookSecret',
      'hideWebhookSecret',
      'loadSopsRecipient',
      'webhookUrl',
    ],
  );
}

export function testPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    status: 'pending',
    changes: [
      {
        action: 'update',
        kind: 'Deployment',
        name: 'web',
        project: 'shop',
        baseGeneration: 3,
        before: { spec: { replicas: 1 } },
        after: { spec: { replicas: 2 } },
      },
      {
        action: 'unchanged',
        kind: 'Deployment',
        name: 'db',
        project: 'shop',
        baseGeneration: 1,
        before: { spec: {} },
        after: { spec: {} },
      },
    ],
    networkChanges: [
      { layer: 'tunnels', action: 'add', node: 'n1', summary: 'adds WireGuard peer n1↔n3', policies: ['allow-web'] },
      {
        layer: 'dns-records',
        action: 'create',
        node: 'example.com',
        summary: 'creates A www.example.com → 203.0.113.10',
      },
    ],
    diagnostics: [],
    workloadChanges: [{ action: 'move', replica: 'shop/web/web/0', from: 'n1', to: 'n2', method: 'blue-green' }],
    failureAnalysis: {
      nPlusOne: false,
      findings: [{ scope: { kind: 'node', name: 'n2' }, kind: 'data', subject: 'shop/db', reason: 'single copy' }],
    },
    deploymentStates: { 'shop/web': { images: { web: 'nginx@sha256:abc' }, secretVersions: { token: 2 } } },
    warnings: [],
    createdBy: 'author',
    creatorRoles: { shop: 'developer' },
    risk: {},
    approvals: [],
    progress: null,
    resolves: null,
    error: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    appliedAt: null,
    ...overrides,
  };
}

/** A release (1.2.0, stable, imported and signed). */
export function testRelease(overrides: Partial<UpdateRelease> = {}): UpdateRelease {
  return {
    version: '1.2.0',
    channel: 'stable',
    status: 'available',
    source: 'github',
    signed: true,
    keyId: 'k1',
    notes: ['needs agent 1.1'],
    components: [{ name: 'envoy', kind: 'image', version: '1.31.0' }],
    clusterImages: [],
    announcement: { htmlUrl: 'https://github.com/forepath/one/releases/tag/v1.2.0', publishedAt: '2026-10-01' },
    error: null,
    importedAt: '2026-10-02T10:00:00.000Z',
    importedBy: 'admin',
    ...overrides,
  };
}

/** An update plan 1.1.0 → 1.2.0 (planned). */
export function testRollout(overrides: Partial<Rollout> = {}): Rollout {
  return {
    id: 'r1',
    status: 'planned',
    kind: 'minor',
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    options: { windows: 'respect', host: false, osUpgrade: false, automatic: false, emergency: false },
    diff: [],
    notes: [],
    warnings: [],
    failureAnalysis: [],
    createdBy: 'admin',
    approvedBy: null,
    approvedAt: null,
    pauseReason: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    progress: { done: 1, total: 4, currentWave: 1 },
    steps: [],
    ...overrides,
  };
}

/** A successful backup of `shop/web/data` (1000 B, 100 B stored). */
export function testBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: '6f0c1b0e-0000-4000-8000-000000000001',
    scope: 'project-shop',
    project: 'shop',
    resource: 'shop/web/data',
    policy: 'nightly',
    node: 'n1',
    status: 'succeeded',
    snapshotId: 'k1',
    keyGeneration: 1,
    bytes: 1000,
    uploadedBytes: 100,
    files: 10,
    targets: [{ target: 'garage', copiedAt: '2026-10-01T10:01:00.000Z', lockedUntil: null }],
    keep: ['latest', 'daily'],
    hooks: true,
    encrypted: true,
    lockedUntil: null,
    error: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    finishedAt: '2026-10-01T10:01:00.000Z',
    deletedAt: null,
    restoreTest: null,
    ...overrides,
  };
}

/** A pending deletion request of one backup in project `shop`, requested by `u1`. */
export function testBackupDeletion(overrides: Partial<BackupDeletion> = {}): BackupDeletion {
  return {
    id: 'd1',
    kind: 'backups',
    scope: 'project-shop',
    backupIds: ['6f0c1b0e-0000-4000-8000-000000000001'],
    retention: null,
    reason: 'GDPR erasure request',
    state: 'pending',
    requestedBy: 'u1',
    approvedBy: null,
    approvedAt: null,
    notBefore: '2099-10-04T10:00:00.000Z',
    executedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

/** The active backup key generation 1 with an unconfirmed 2-of-3 kit. */
export function testKeyGeneration(overrides: Partial<BackupKeyGeneration> = {}): BackupKeyGeneration {
  return {
    generation: 1,
    rootId: 'root-1',
    active: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    retiredAt: null,
    kit: { shares: 3, threshold: 2, downloaded: [], confirmedAt: null, confirmedBy: null },
    escrow: null,
    ...overrides,
  };
}
