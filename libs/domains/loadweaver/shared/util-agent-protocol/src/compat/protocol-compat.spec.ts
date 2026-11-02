import { isDeepStrictEqual } from 'node:util';

import { checkJsonSchema, type JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';

import { controlPlaneMessage } from '../lib/codec';
import type { ControlPlaneMessageType } from '../lib/messages';
import {
  CONTROL_PLANE_FIELD_GATES,
  CONTROL_PLANE_MESSAGE_GATES,
  envelopeForNode,
  forNode,
  GatedFieldRefused,
  KNOWN_PROTOCOL_FEATURES,
  LEGACY_PROTOCOL,
  messageAllowed,
  negotiate,
  PROTOCOL_VERSION,
  type FieldGates,
} from '../lib/versioning';
import {
  currentSnapshot,
  frozenVersions,
  loadSnapshot,
  PROTOCOL_DIRECTIONS,
  protocolIncompatibilities,
  schemaPaths,
  type ProtocolSnapshot,
} from './protocol-snapshots';

const UUID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const TOKEN = 'A'.repeat(43);
const WORKLOAD = {
  id: 'p1/d1/web/0',
  project: 'p1',
  deployment: 'd1',
  service: 'web',
  kind: 'service',
  image: 'nginx@sha256:' + '1'.repeat(64),
  environment: {},
  labels: {},
  addresses: ['10.88.0.10'],
  dnsSearch: [],
  runtime: 'runc',
  resources: { cpuMillis: 100, memoryBytes: 1024 },
  restart: 'always',
  stopGracePeriodMs: 10_000,
  init: false,
  readOnly: false,
  privileged: false,
  capAdd: [],
  capDrop: [],
  ulimits: {},
  extraHosts: [],
  volumes: [],
  secrets: [],
  specHash: 'a'.repeat(32),
};
const SESSION = { migration: UUID, attempt: 1, replica: 'p1/d1/web/0' };
const DIGEST = 'sha256:' + 'c'.repeat(64);
const VM_IMAGE = { ref: 'registry.lw/p1/debian-13:1', digest: DIGEST, format: 'qcow2', layerDigest: DIGEST };
const VM_SESSION = { migration: UUID, attempt: 1, replica: 'p1/lw-vm/db1/0' };
/** A full VM replica (M7): every refuse-gated workload field. */
const VM_WORKLOAD = {
  ...WORKLOAD,
  id: 'p1/lw-vm/db1/0',
  deployment: 'lw-vm',
  service: 'db1',
  isolation: 'microvm',
  devices: [{ path: '/dev/kvm', permissions: 'rwm' }],
  vm: {
    uid: UUID,
    firmware: 'uefi',
    cpuModel: 'host-model',
    vcpus: 2,
    memoryMiB: 2048,
    disks: [{ name: 'root', volume: 'p1/lw-vm/db1.root', bus: 'virtio', cache: 'none', boot: true }],
    nics: [
      { name: 'eth0', mac: '52:54:00:00:00:01', addresses: ['10.88.0.10'] },
      { name: 'eth1', mac: '52:54:00:00:00:02', addresses: ['10.88.1.10'] },
    ],
    image: VM_IMAGE,
    graphics: false,
    power: 'running',
  },
};
const BLOCK_VOLUME = {
  id: 'p1/lw-vm/db1.root',
  dockerName: 'lw-vol-p1.lw-vm.db1.root',
  minor: 1001,
  port: 7801,
  sizeBytes: 21_474_836_480,
  replicas: [{ node: 'n1', nodeId: 0, address: '10.93.0.1' }],
  connections: [],
  primary: 'n1',
  keyRef: 'secret://p1/lw-volume-lw-vm.db1.root',
  mode: 'block',
  initializeFrom: { digest: DIGEST, format: 'qcow2' },
};
const M7_FEATURES = [
  'isolation-ladder',
  'workload-devices',
  'microvm',
  'virtual-machines',
  'vm-block-volumes',
  'vm-consoles',
  'vm-migration',
];
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const BACKUP_REPOSITORY = {
  scope: 'project-p1',
  servers: [{ address: '10.93.0.1', port: 7500 }],
  fingerprint: 'f'.repeat(64),
  username: 'v-d1.data',
  hostname: 'p1',
  password: TOKEN,
};

/** What the current control plane sends, one sample per message type (desired state with its optional parts). */
const SAMPLES: { [T in ControlPlaneMessageType]: unknown } = {
  logAck: { ok: true },
  helloAck: { protocolVersion: 2, features: ['capability-updates', 'live-migration'] },
  desiredState: {
    revision: 7,
    network: {
      node: 'n1',
      addresses: ['10.93.0.1', 'fd93::1'],
      wireguard: [],
      services: [{ name: 'db.p1.lw', serviceIp: '10.89.0.5', backends: ['10.88.0.10'] }],
      bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: ['10.88.0.0/24'], sessions: [] },
      firewall: { sets: { lw_00000001: ['10.0.0.0/8'] }, rules: [] },
      dns: { domain: 'lw', records: [{ name: 'db.p1.lw', addresses: ['10.89.0.5'] }], visibility: {} },
    },
    controlPlane: {
      role: 'member',
      members: [{ name: 'n1', address: '10.93.0.1', witness: false }],
      automaticFailover: false,
      scope: 'c1',
      environment: { DATABASE_URL: 'postgres://x' },
      logStore: { clusterName: 'lw-logs', heapMb: 512, httpPort: 9200, transportPort: 9300 },
    },
    // Restored replica with a kept address (live migration, gated by `live-migration`).
    workloads: [
      {
        ...WORKLOAD,
        restoredFrom: { migration: UUID, runtime: 'runc' },
        hostRoutes: ['10.88.0.10/32'],
      },
    ],
    volumes: [],
    publicAddresses: [],
    liveAccess: { nodeShell: false },
    probes: [],
    lifecycle: 'active',
    // Host settings (M7, strip-gated by `isolation-ladder`).
    host: { kvm: 'disabled', probeNonce: 'p-1' },
    // Release components (gated by `components`).
    components: {
      release: '3.5.0',
      manifest: '{"version":"3.5.0"}',
      signature: '{"algorithm":"ecdsa-p256-sha256"}',
      artifactBase: '/api/updates/artifacts',
      clusterImages: ['envoy'],
      host: {
        id: UUID,
        snapshot: 's-20261019',
        aptBase: '/api/updates/apt/s-20261019',
        sources: [
          {
            name: 'debian',
            suites: ['trixie', 'trixie-updates'],
            components: ['main'],
            keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
          },
        ],
        upgrade: true,
        reboot: UUID,
      },
      actions: { patroniSwitchover: { id: UUID, candidate: '10.93.0.2' } },
    },
    // Backup repository servers (gated by `backups`).
    backupServer: {
      repositories: [
        {
          scope: 'project-p1',
          port: 7500,
          s3: { address: '10.93.0.1', port: 3900, bucket: 'lw-backups', prefix: 'project-p1/' },
          tls: { certificatePem: PEM, privateKeyPem: PEM },
          accessKeyId: 'GK0123',
          secretAccessKey: 'secret',
          password: TOKEN,
          controlPassword: TOKEN,
          serverControlPassword: TOKEN,
        },
      ],
    },
  },
  certificateIssued: { certificatePem: PEM, caCertificatePem: PEM },
  secretValue: { workload: 'p1/d1/web', ref: 'db-password', version: 2, valueBase64: 'c2VjcmV0' },
  unsealShareRequest: {
    requestId: UUID,
    keyId: '0123456789abcdef',
    encryptedShare: 'AAAA',
    requesterPublicKey: 'BBBB',
  },
  registryToken: { requestId: UUID, token: 'jwt', expiresInSeconds: 300 },
  workloadIdentities: { certificates: [], refused: ['p1/d1/web'], caCertificatePem: PEM },
  execOpen: { target: { kind: 'replica', replica: 'p1/d1/web/0' }, cols: 80, rows: 24 },
  execInput: { data: 'bHM=' },
  execResize: { cols: 120, rows: 40 },
  execClose: {},
  fileRequest: { op: 'read', target: { kind: 'volume', volume: 'p1/d1/data' }, path: '/a', offset: 0, length: 10 },
  tunnelOpen: { replica: 'p1/d1/web/0', port: 8080 },
  tunnelData: { data: 'AA==' },
  tunnelClose: { reason: 'done' },
  migrationPrepare: {
    ...SESSION,
    source: 'n1',
    runtime: 'runc',
    token: TOKEN,
    addresses: ['10.88.0.10'],
    expiresInSeconds: 600,
    spec: WORKLOAD,
  },
  migrationPrecopy: {
    ...SESSION,
    target: 'n2',
    endpoint: { address: '10.93.0.2', port: 7480 },
    token: TOKEN,
    maxRounds: 5,
    convergeBytes: 1_048_576,
  },
  migrationFreeze: {
    ...SESSION,
    target: 'n2',
    endpoint: { address: '10.93.0.2', port: 7480 },
    token: TOKEN,
    runtime: 'runc',
    volumes: ['p1/d1/data'],
    freezeBudgetMs: 3000,
  },
  migrationRestore: { ...SESSION, runtime: 'runc', volumes: ['p1/d1/data'], addresses: ['10.88.0.10'] },
  migrationCommit: { ...SESSION, role: 'source' },
  migrationAbort: { ...SESSION, role: 'source', reason: 'restore failed', volumes: [] },
  backupRun: {
    backup: UUID,
    volume: 'p1/d1/data',
    repository: BACKUP_REPOSITORY,
    description: 'policy nightly',
    tags: { policy: 'nightly' },
    hooks: { replica: 'p1/d1/db/0', pre: ['pg_dump', '-f', '/data/dump.sql'], timeoutSeconds: 300 },
  },
  restoreRun: {
    restore: UUID,
    kind: 'scratch',
    snapshot: 'k' + 'a'.repeat(32),
    repository: BACKUP_REPOSITORY,
    volume: 'p1/d1/data',
    sizeBytes: 1_073_741_824,
    check: { image: 'postgres:17', command: ['pg_verifybackup', '/data'], mountPath: '/data', timeoutSeconds: 600 },
  },
  discoveryRequest: { request: UUID },
  importStep: {
    import: UUID,
    step: 'shop/precopy',
    action: { kind: 'precopy', copies: [{ source: '/var/lib/docker/volumes/shop_html/_data', volume: 'lw-vol-x' }] },
  },
  // M7 (3.35): message-gated by `vm-consoles`, `virtual-machines`, `vm-migration`.
  consoleOpen: { target: { kind: 'replica', replica: 'p1/lw-vm/db1/0' }, kind: 'serial', cols: 80, rows: 24 },
  vmPower: { replica: 'p1/lw-vm/db1/0', action: 'reboot' },
  vmImageImport: { import: UUID, replica: 'p1/lw-vm/db1/0', volume: 'p1/lw-vm/db1.root', image: VM_IMAGE },
  vmMigrationPrepare: {
    ...VM_SESSION,
    source: 'n1',
    token: TOKEN,
    addresses: ['10.88.0.10'],
    volumes: ['p1/lw-vm/db1.root'],
    expiresInSeconds: 600,
    spec: VM_WORKLOAD,
  },
  vmMigrationStart: {
    ...VM_SESSION,
    target: 'n2',
    endpoint: { address: '10.93.0.2', port: 7480 },
    token: TOKEN,
    downtimeLimitMs: 300,
    maxSeconds: 120,
  },
  vmMigrationSwitchover: VM_SESSION,
  error: { code: 'closed', message: 'bye' },
};

const latest = (): number => Math.max(...frozenVersions());

function issues(snapshot: ProtocolSnapshot, type: string, payload: unknown): string[] {
  const schema = snapshot.messages[type];

  if (!schema) return [`${type}: unknown to protocol v${snapshot.protocolVersion}`];

  return checkJsonSchema(schema, payload).map((i) => `${type}.${i.path.join('.')}: ${i.message}`);
}

/** A copy of the current control-plane → agent snapshot as if `desiredState.liveAccess` were new since N-1. */
function withoutLiveAccess(): ProtocolSnapshot {
  const previous = JSON.parse(JSON.stringify(currentSnapshot('control-plane-to-agent'))) as ProtocolSnapshot;
  const desired = previous.messages['desiredState'] as { properties: Record<string, unknown> };

  delete desired.properties['liveAccess'];

  return previous;
}

describe('agent-protocol compatibility with the N-1 snapshot (3.26)', () => {
  it('has a frozen snapshot of each direction, not newer than this build', () => {
    expect(frozenVersions().length).toBeGreaterThan(0);
    expect(latest()).toBeLessThanOrEqual(PROTOCOL_VERSION);

    for (const direction of PROTOCOL_DIRECTIONS) expect(loadSnapshot(latest(), direction).direction).toBe(direction);
  });

  it('bumps PROTOCOL_VERSION when the schemas changed since the last frozen snapshot', () => {
    if (latest() < PROTOCOL_VERSION) return;

    for (const direction of PROTOCOL_DIRECTIONS) {
      const current = JSON.parse(JSON.stringify(currentSnapshot(direction))) as ProtocolSnapshot;

      // If this fails: increase PROTOCOL_VERSION (the frozen v<N> is what N-1 agents speak).
      expect(isDeepStrictEqual(current, loadSnapshot(PROTOCOL_VERSION, direction))).toBe(true);
    }
  });

  it.each(PROTOCOL_DIRECTIONS)('is compatible in direction %s', (direction) => {
    expect(
      protocolIncompatibilities(
        loadSnapshot(latest(), direction),
        currentSnapshot(direction),
        CONTROL_PLANE_FIELD_GATES,
        CONTROL_PLANE_MESSAGE_GATES,
      ),
    ).toEqual([]);
  });

  it('sends a node advertising no features only messages the N-1 agent accepts', () => {
    const previous = loadSnapshot(latest(), 'control-plane-to-agent');
    // A current agent that doesn't advertise `live-migration` (like today's agents) is treated the same way.
    const current = negotiate({ protocolVersion: PROTOCOL_VERSION, features: [] });

    for (const [type, payload] of Object.entries(SAMPLES) as [ControlPlaneMessageType, never][]) {
      // The sample is a valid current message …
      expect(() => controlPlaneMessage(type, payload)).not.toThrow();

      for (const negotiated of [LEGACY_PROTOCOL, current]) {
        if (CONTROL_PLANE_MESSAGE_GATES[type]) {
          // … a gated message type never reaches the node at all …
          expect(messageAllowed(type, negotiated)).toBe(false);
          expect(envelopeForNode(controlPlaneMessage(type, payload), negotiated)).toBeNull();
        } else {
          // … and everything else, gated for an old agent, is valid for the N-1 agent.
          expect(issues(previous, type, forNode({ type, payload }, negotiated).payload)).toEqual([]);
        }
      }
    }
  });

  it('sends the live-migration messages and hints only to nodes advertising the feature', () => {
    const capable = negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration'] });
    const prepare = controlPlaneMessage('migrationPrepare', SAMPLES.migrationPrepare as never);

    expect(envelopeForNode(prepare, capable)).toBe(prepare);
    expect(
      (
        forNode({ type: 'desiredState', payload: SAMPLES.desiredState as never }, capable).payload as never as {
          workloads: Record<string, unknown>[];
        }
      ).workloads[0],
    ).toMatchObject({ restoredFrom: { runtime: 'runc' }, hostRoutes: ['10.88.0.10/32'] });
    expect(
      (
        forNode({ type: 'desiredState', payload: SAMPLES.desiredState as never }, LEGACY_PROTOCOL).payload as never as {
          workloads: Record<string, unknown>[];
        }
      ).workloads[0],
    ).not.toHaveProperty('restoredFrom');
  });

  it('sends release components only to nodes advertising `components` (3.26)', () => {
    const capable = negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['components'] });
    const payload = (n: ReturnType<typeof negotiate>) =>
      forNode({ type: 'desiredState', payload: SAMPLES.desiredState as never }, n).payload as never as Record<
        string,
        unknown
      >;

    expect(payload(capable)['components']).toMatchObject({ release: '3.5.0', host: { upgrade: true } });
    expect(payload(LEGACY_PROTOCOL)).not.toHaveProperty('components');
    expect(payload(negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration'] }))).not.toHaveProperty(
      'components',
    );
  });

  it('refuses M7 workload / volume fields for nodes without their features instead of stripping them (M7)', () => {
    const previous = loadSnapshot(latest(), 'control-plane-to-agent');
    const payload = {
      ...(SAMPLES.desiredState as Record<string, unknown>),
      workloads: [VM_WORKLOAD],
      volumes: [BLOCK_VOLUME],
    };
    const envelope = controlPlaneMessage('desiredState', payload as never);
    const prepare = controlPlaneMessage('migrationPrepare', {
      ...(SAMPLES.migrationPrepare as Record<string, unknown>),
      spec: { ...WORKLOAD, runtime: 'sandboxed', isolation: 'sandboxed-kvm' },
    } as never);
    const liveOnly = negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration'] });

    for (const negotiated of [LEGACY_PROTOCOL, negotiate({ protocolVersion: PROTOCOL_VERSION, features: [] })])
      expect(() => envelopeForNode(envelope, negotiated)).toThrow(GatedFieldRefused);

    // A sandboxed-kvm replica is never migrated to a node that would run it as plain `sandboxed`.
    expect(() => envelopeForNode(prepare, liveOnly)).toThrow(
      /spec\.isolation needs the protocol feature isolation-ladder/,
    );
    expect(
      envelopeForNode(
        prepare,
        negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration', 'isolation-ladder'] }),
      ),
    ).toBe(prepare);

    // A node with every feature gets the message unchanged; what an N-1 agent gets has none of it.
    const capable = negotiate({ protocolVersion: PROTOCOL_VERSION, features: [...KNOWN_PROTOCOL_FEATURES] });

    expect(M7_FEATURES.every((f) => capable.features.has(f))).toBe(true);

    expect(envelopeForNode(envelope, capable)).toBe(envelope);
    expect(issues(previous, 'desiredState', payload)).not.toEqual([]);

    const stripped = forNode({ type: 'desiredState', payload: SAMPLES.desiredState as never }, LEGACY_PROTOCOL)
      .payload as never as Record<string, unknown>;

    expect(stripped).not.toHaveProperty('host');
    expect(issues(previous, 'desiredState', stripped)).toEqual([]);
  });

  describe('a field added since N-1 (simulated)', () => {
    const previous = withoutLiveAccess();
    const current = currentSnapshot('control-plane-to-agent');
    const gates: FieldGates = { desiredState: [{ path: 'liveAccess', feature: 'test-feature' }] };
    const sample = SAMPLES.desiredState as never;

    it('is reported until it is gated', () => {
      expect(protocolIncompatibilities(previous, current, {})).toEqual([
        'desiredState.liveAccess: new field without a feature gate (CONTROL_PLANE_FIELD_GATES)',
      ]);
      expect(protocolIncompatibilities(previous, current, gates)).toEqual([]);
    });

    it('reaches only nodes that advertise the feature', () => {
      // The strict N-1 agent would reject the ungated field …
      expect(issues(previous, 'desiredState', sample)).toEqual([
        'desiredState.liveAccess: unknown property "liveAccess"',
      ]);
      // … so an old agent (no version, no features) gets the message without it …
      expect(
        issues(
          previous,
          'desiredState',
          forNode({ type: 'desiredState', payload: sample }, LEGACY_PROTOCOL, gates).payload,
        ),
      ).toEqual([]);
      // … a current agent without the feature too, unknown features of a newer agent don't count …
      const newer = negotiate({ protocolVersion: PROTOCOL_VERSION + 1, features: ['from-the-future'] }, [
        'test-feature',
      ]);

      expect(forNode({ type: 'desiredState', payload: sample }, newer, gates).payload).not.toHaveProperty('liveAccess');
      // … and an agent advertising it gets the field.
      const capable = negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['test-feature'] }, ['test-feature']);

      expect(forNode({ type: 'desiredState', payload: sample }, capable, gates).payload).toHaveProperty('liveAccess');
    });
  });

  it('reports breaking changes in both directions', () => {
    const toAgent = currentSnapshot('control-plane-to-agent');
    const fromAgent = currentSnapshot('agent-to-control-plane');
    const mutate = (snapshot: ProtocolSnapshot, change: (messages: Record<string, JsonSchemaObject>) => void) => {
      const copy = JSON.parse(JSON.stringify(snapshot)) as ProtocolSnapshot;

      change(copy.messages);

      return copy;
    };
    const props = (schema: JsonSchemaObject) => schema['properties'] as Record<string, JsonSchemaObject>;

    // Control plane → agent: a new message type, a new enum value, a required field becoming optional.
    const olderToAgent = mutate(toAgent, (m) => {
      delete m['tunnelOpen'];
      (props(m['desiredState'])['lifecycle'] as { enum: string[] }).enum = ['active', 'cordoned', 'draining'];
      (m['error'] as { required: string[] }).required.push('details');
      props(m['error'])['details'] = { type: 'string' };
    });

    const toAgentFindings = protocolIncompatibilities(olderToAgent, toAgent, {});

    expect(toAgentFindings).toEqual(
      expect.arrayContaining([
        'error.details: field removed although an N-1 agent requires it',
        'desiredState.lifecycle: new value(s) "leaving" an N-1 agent rejects',
        "tunnelOpen: new message type an N-1 agent doesn't know (CONTROL_PLANE_MESSAGE_GATES)",
      ]),
    );
    expect(toAgentFindings).toHaveLength(3);

    // Agent → control plane: a field N-1 agents send was removed, a new required field, a dropped enum value.
    const olderFromAgent = mutate(fromAgent, (m) => {
      props(m['hello'])['legacy'] = { type: 'string' };
      props(m['applyReport'])['status'] = { type: 'string', enum: ['applied', 'failed', 'rolled-back', 'skipped'] };
    });
    const newerFromAgent = mutate(fromAgent, (m) => {
      props(m['heartbeat'])['mandatory'] = { type: 'string' };
      (m['heartbeat'] as { required: string[] }).required.push('mandatory');
    });

    expect(protocolIncompatibilities(olderFromAgent, newerFromAgent, {})).toEqual(
      expect.arrayContaining([
        'hello.legacy: field removed although an N-1 agent sends it',
        'applyReport.status: value(s) "skipped" an N-1 agent may send are no longer accepted',
        "heartbeat.mandatory: new required field an N-1 agent doesn't send",
      ]),
    );
    expect(protocolIncompatibilities(olderFromAgent, newerFromAgent, {})).toHaveLength(3);
    // New optional agent fields (like the hello's protocolVersion / features) are fine.
    expect(
      protocolIncompatibilities(
        mutate(fromAgent, (m) => delete props(m['hello'])['features']),
        fromAgent,
        {},
      ),
    ).toEqual([]);
  });

  it('flattens schemas into gate paths', () => {
    const paths = schemaPaths(currentSnapshot('control-plane-to-agent').messages['desiredState']);

    expect(paths.get('lifecycle')).toMatchObject({ required: true });
    expect(paths.get('liveAccess')).toMatchObject({ required: false });
    expect(paths.has('workloads[].id')).toBe(true);
    expect(paths.has('workloads[].ulimits.*.soft')).toBe(true);
  });
});
