import { z } from 'zod';

import { controlPlaneMessage, decodeControlPlaneMessage } from './codec';
import { agentHelloSchema, CONTROL_PLANE_TO_AGENT, type DesiredState } from './messages';
import {
  CONTROL_PLANE_FIELD_GATES,
  CONTROL_PLANE_MESSAGE_GATES,
  envelopeForNode,
  forNode,
  KNOWN_PROTOCOL_FEATURES,
  LEGACY_PROTOCOL,
  messageAllowed,
  negotiate,
  parseGatePath,
  PROTOCOL_FEATURES,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
  type FieldGates,
} from './versioning';

/** A feature that exists only in these tests; real features are registered by the steps that add gated fields. */
const TEST_FEATURE = 'test-feature';
const TEST_GATES: FieldGates = {
  desiredState: [
    { path: 'liveAccess', feature: TEST_FEATURE },
    { path: 'workloads[].hostname', feature: TEST_FEATURE },
    { path: 'controlPlane.logStore', feature: 'never-advertised' },
  ],
};

const hello = {
  nodeName: 'n1',
  agentVersion: '0.1.0',
  os: { id: 'debian', versionId: '12', kernel: '6.1.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: false,
    criu: false,
  },
  capacity: { cpuMillis: 4000, memoryBytes: 8e9, diskBytes: 1e11 },
  wireguardPublicKey: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  appliedRevision: 0,
};

const state = {
  revision: 3,
  network: {
    node: 'n1',
    addresses: ['10.93.0.1'],
    wireguard: [],
    services: [],
    bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: [], sessions: [] },
    firewall: { sets: {}, rules: [] },
    dns: { domain: 'lw', records: [], visibility: {} },
  },
  controlPlane: { role: 'none', members: [], automaticFailover: false, scope: 'c1' },
  liveAccess: { nodeShell: false },
  lifecycle: 'active',
} as unknown as DesiredState;

/** Walks a zod object schema along a gate path; true if the last field is optional (or defaulted). */
function gatedFieldIsOptional(schema: z.ZodType, path: string): boolean {
  let node: z.ZodType = schema;
  const segments = parseGatePath(path);

  for (const [i, segment] of segments.entries()) {
    while (node instanceof z.ZodOptional || node instanceof z.ZodDefault)
      node = (node as z.ZodOptional<z.ZodType>).unwrap() as z.ZodType;

    if (segment.key === '*') {
      if (!(node instanceof z.ZodRecord)) return false;

      node = node.valueType as z.ZodType;
      continue;
    }

    if (!(node instanceof z.ZodObject)) return false;

    const field = node.shape[segment.key] as z.ZodType | undefined;

    if (!field) return false;

    if (i === segments.length - 1) return field.safeParse(undefined).success;

    node = field;

    if (segment.each === 'array') {
      while (node instanceof z.ZodOptional || node instanceof z.ZodDefault)
        node = (node as z.ZodOptional<z.ZodType>).unwrap() as z.ZodType;

      if (!(node instanceof z.ZodArray)) return false;

      node = node.element as z.ZodType;
    }
  }

  return false;
}

describe('agent-protocol versioning', () => {
  it('is at protocol version 2 and registers only known, well-formed features', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(KNOWN_PROTOCOL_FEATURES).toEqual(Object.keys(PROTOCOL_FEATURES));
    // The agent advertises only what it implements: live migration since M6 step 1b (checkpoint manager etc.).
    expect(SUPPORTED_PROTOCOL_FEATURES).toContain('live-migration');
    expect(KNOWN_PROTOCOL_FEATURES).toContain('live-migration');

    for (const [id, info] of Object.entries(PROTOCOL_FEATURES) as [string, { since: number }][]) {
      expect(id).toMatch(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);
      expect(info.since).toBeGreaterThanOrEqual(1);
      expect(info.since).toBeLessThanOrEqual(PROTOCOL_VERSION);
    }
  });

  it('accepts hellos with and without version and features', () => {
    expect(agentHelloSchema.safeParse(hello).success).toBe(true);
    expect(agentHelloSchema.safeParse({ ...hello, protocolVersion: 1, features: [] }).success).toBe(true);
    // Unknown (newer) feature ids are well-formed and accepted; garbage is not.
    expect(agentHelloSchema.safeParse({ ...hello, protocolVersion: 7, features: ['from-the-future'] }).success).toBe(
      true,
    );
    expect(agentHelloSchema.safeParse({ ...hello, protocolVersion: 1, features: ['Bad Feature'] }).success).toBe(false);
    expect(agentHelloSchema.safeParse({ ...hello, protocolVersion: 0 }).success).toBe(false);
  });

  describe('negotiate', () => {
    it('treats agents built before versioning as version 0 without features', () => {
      expect(negotiate(agentHelloSchema.parse(hello))).toBe(LEGACY_PROTOCOL);
      expect(LEGACY_PROTOCOL).toEqual({ version: 0, features: new Set() });
      // Features without a version are not honored.
      expect(negotiate({ features: [TEST_FEATURE] }, [TEST_FEATURE]).features.size).toBe(0);
    });

    it('uses the lower version and the features both sides know, ignoring unknown ones', () => {
      const negotiated = negotiate({ protocolVersion: 99, features: [TEST_FEATURE, 'from-the-future'] }, [
        TEST_FEATURE,
      ]);

      expect(negotiated.version).toBe(PROTOCOL_VERSION);
      expect([...negotiated.features]).toEqual([TEST_FEATURE]);
      expect(negotiate({ protocolVersion: 1 }, [TEST_FEATURE])).toEqual({ version: 1, features: new Set() });
    });

    it('negotiates the registered features by default', () => {
      expect([...negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['from-the-future'] }).features]).toEqual([]);
      expect([
        ...negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration', 'from-the-future'] }).features,
      ]).toEqual(['live-migration']);
    });
  });

  describe('field gating', () => {
    const withWorkload = {
      ...state,
      workloads: [{ hostname: 'SIGTERM', other: 1 } as never, { other: 2 } as never],
    } as DesiredState;

    it('strips gated fields for an old agent without features and never mutates the input', () => {
      const snapshot = JSON.stringify(withWorkload);
      const gated = forNode({ type: 'desiredState', payload: withWorkload }, LEGACY_PROTOCOL, TEST_GATES);

      expect(gated.payload).not.toHaveProperty('liveAccess');
      expect(gated.payload.workloads).toEqual([{ other: 1 }, { other: 2 }]);
      // Untouched branches keep their identity (no deep copy).
      expect(gated.payload.network).toBe(withWorkload.network);
      expect(JSON.stringify(withWorkload)).toBe(snapshot);
    });

    it('keeps gated fields for an agent that advertises the feature', () => {
      const negotiated = negotiate({ protocolVersion: 1, features: [TEST_FEATURE, 'from-the-future'] }, [TEST_FEATURE]);
      const message = { type: 'desiredState' as const, payload: withWorkload };

      expect(forNode(message, negotiated, TEST_GATES)).toBe(message);
    });

    it('strips record values and leaves messages without gates alone', () => {
      const member = {
        ...state,
        controlPlane: { ...state.controlPlane, environment: { A: '1', B: '2' } },
      } as DesiredState;
      const gated = forNode({ type: 'desiredState', payload: member }, LEGACY_PROTOCOL, {
        desiredState: [{ path: 'controlPlane.*.A', feature: 'x' }],
      });

      expect(gated.payload.controlPlane.environment).toEqual({ B: '2' });

      const error = { type: 'error' as const, payload: { code: 'x', message: 'y' } };

      expect(forNode(error, LEGACY_PROTOCOL, TEST_GATES)).toBe(error);
    });

    it('gates encoded envelopes, keeping id, correlation id and channel, and re-validates', () => {
      const envelope = controlPlaneMessage('desiredState', state, { correlationId: 'c1', channel: 'ch' });
      const gated = envelopeForNode(envelope, LEGACY_PROTOCOL, TEST_GATES) as NonNullable<
        ReturnType<typeof envelopeForNode>
      >;
      const decoded = decodeControlPlaneMessage(gated);

      expect(gated).toMatchObject({ type: 'desiredState', id: envelope.id, correlationId: 'c1', channel: 'ch' });
      expect(decoded.ok && decoded.message.payload).not.toHaveProperty('liveAccess');
      // Nothing to strip: the very same envelope (no re-encoding).
      expect(
        envelopeForNode(
          envelope,
          negotiate({ protocolVersion: 1, features: [TEST_FEATURE] }, [TEST_FEATURE]),
          TEST_GATES,
        ),
      ).toBe(envelope);
      expect(envelopeForNode(envelope, LEGACY_PROTOCOL)).toBe(envelope);
    });

    it('drops gated message types for nodes without the feature', () => {
      const envelope = controlPlaneMessage('migrationCommit', {
        migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
        attempt: 1,
        replica: 'p1/d1/web/0',
        role: 'source',
      });
      const capable = negotiate({ protocolVersion: PROTOCOL_VERSION, features: ['live-migration'] });

      expect(messageAllowed('migrationCommit', LEGACY_PROTOCOL)).toBe(false);
      expect(messageAllowed('desiredState', LEGACY_PROTOCOL)).toBe(true);
      expect(envelopeForNode(envelope, LEGACY_PROTOCOL)).toBeNull();
      expect(envelopeForNode(envelope, negotiate({ protocolVersion: 2, features: [] }))).toBeNull();
      expect(envelopeForNode(envelope, capable)).toBe(envelope);

      for (const feature of Object.values(CONTROL_PLANE_MESSAGE_GATES))
        expect(Object.keys(PROTOCOL_FEATURES)).toContain(feature);
    });

    it('rejects malformed gate paths', () => {
      expect(() => parseGatePath('a[]')).toThrow();
      expect(() => parseGatePath('*.a')).toThrow();
      expect(() => parseGatePath('a.*')).toThrow();
      expect(() => parseGatePath('a..b')).toThrow();
      expect(parseGatePath('a[].b.*.c')).toEqual([
        { key: 'a', each: 'array' },
        { key: 'b', each: null },
        { key: '*', each: 'record' },
        { key: 'c', each: null },
      ]);
    });

    it('sends DRBD host names only to agents with drbd-hostnames (3.5)', () => {
      const volume = {
        id: 'shop/store/data',
        dockerName: 'lw-vol-shop.store.data',
        minor: 1000,
        port: 7800,
        sizeBytes: 1024,
        replicas: [
          { node: 'n1', nodeId: 0, address: '10.93.0.1', host: 'n1.dc1.example' },
          { node: 'n2', nodeId: 1, address: '10.93.0.2' },
        ],
        connections: [{ a: 'n1', b: 'n2', protocol: 'C' as const }],
        primary: 'n1',
        keyRef: 'secret://shop/lw-volume-store.data',
      };
      const message = { type: 'desiredState' as const, payload: { ...state, volumes: [volume] } };
      const legacy = forNode(message, LEGACY_PROTOCOL).payload.volumes ?? [];

      expect(legacy[0].replicas[0]).toEqual({ node: 'n1', nodeId: 0, address: '10.93.0.1' });
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(forNode(message, LEGACY_PROTOCOL).payload).success).toBe(
        true,
      );
      expect(
        forNode(message, negotiate({ protocolVersion: 2, features: ['drbd-hostnames'] })).payload.volumes?.[0]
          .replicas[0].host,
      ).toBe('n1.dc1.example');
      expect(SUPPORTED_PROTOCOL_FEATURES).toContain('drbd-hostnames');
    });

    it('sends control-plane data backup settings only to agents with platform-backups (3.20)', () => {
      const platformBackups = {
        gatewayPort: 7480,
        bucket: 'lw-platform',
        region: 'garage',
        postgres: { accessKeyId: 'LWPB0123456789ABCDEF01234567', secretAccessKey: 'a'.repeat(64) },
      };
      const message = {
        type: 'desiredState' as const,
        payload: { ...state, controlPlane: { ...state.controlPlane, platformBackups } },
      };
      const legacy = forNode(message, LEGACY_PROTOCOL).payload;

      expect(legacy.controlPlane).not.toHaveProperty('platformBackups');
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(legacy).success).toBe(true);
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(message.payload).success).toBe(true);
      expect(
        forNode(message, negotiate({ protocolVersion: 2, features: ['platform-backups'] })).payload.controlPlane
          .platformBackups,
      ).toEqual(platformBackups);
      expect(SUPPORTED_PROTOCOL_FEATURES).toContain('platform-backups');
    });

    it('sends the database scope and cut-over only to agents with platform-cutover (3.20)', () => {
      const platformBackups = {
        gatewayPort: 7480,
        bucket: 'lw-platform',
        region: 'garage',
        postgresCutover: { id: 'a1b2c3d4', scope: 'lw-lab-ra1b2c3d4', previousScope: 'lw-lab', node: 'n1' },
      };
      const message = {
        type: 'desiredState' as const,
        payload: {
          ...state,
          controlPlane: { ...state.controlPlane, postgresScope: 'lw-lab-ra1b2c3d4', platformBackups },
        },
      };
      const backupsOnly = forNode(message, negotiate({ protocolVersion: 2, features: ['platform-backups'] })).payload;

      expect(backupsOnly.controlPlane).not.toHaveProperty('postgresScope');
      expect(backupsOnly.controlPlane.platformBackups).not.toHaveProperty('postgresCutover');
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(backupsOnly).success).toBe(true);
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(message.payload).success).toBe(true);

      const both = forNode(
        message,
        negotiate({ protocolVersion: 2, features: ['platform-backups', 'platform-cutover'] }),
      ).payload;

      expect(both.controlPlane.postgresScope).toBe('lw-lab-ra1b2c3d4');
      expect(both.controlPlane.platformBackups?.postgresCutover).toEqual(platformBackups.postgresCutover);
      expect(SUPPORTED_PROTOCOL_FEATURES).toContain('platform-cutover');
    });

    it("sends the member's Postgres certificate only to agents with postgres-tls (3.2)", () => {
      const postgresTls = { certificatePem: 'cert', privateKeyPem: 'key', caCertificatePem: 'ca' };
      const message = {
        type: 'desiredState' as const,
        payload: { ...state, controlPlane: { ...state.controlPlane, postgresTls } },
      };
      const legacy = forNode(message, negotiate({ protocolVersion: 2, features: ['platform-backups'] })).payload;

      expect(legacy.controlPlane).not.toHaveProperty('postgresTls');
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(legacy).success).toBe(true);
      expect(CONTROL_PLANE_TO_AGENT.desiredState.safeParse(message.payload).success).toBe(true);
      expect(
        forNode(message, negotiate({ protocolVersion: 2, features: ['postgres-tls'] })).payload.controlPlane
          .postgresTls,
      ).toEqual(postgresTls);
      expect(SUPPORTED_PROTOCOL_FEATURES).toContain('postgres-tls');
    });

    it('accepts the kernel host name and DRBD 9 capability in hellos, as optional fields', () => {
      expect(agentHelloSchema.safeParse({ ...hello, hostname: 'node-1.dc1.example' }).success).toBe(true);
      expect(agentHelloSchema.safeParse({ ...hello, hostname: 'bad"host' }).success).toBe(false);
      expect(agentHelloSchema.safeParse({ ...hello, hostname: 'x'.repeat(65) }).success).toBe(false);
      expect(
        agentHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, drbd9: true } }).success,
      ).toBe(true);
    });

    it('only gates optional fields of real messages behind registered features', () => {
      const gates = { ...CONTROL_PLANE_FIELD_GATES, ...TEST_GATES };

      for (const [type, list] of Object.entries(gates) as [
        keyof typeof CONTROL_PLANE_TO_AGENT,
        readonly { path: string }[],
      ][])
        for (const gate of list.filter((g) => !g.path.includes('*')))
          expect({
            type,
            path: gate.path,
            optional: gatedFieldIsOptional(CONTROL_PLANE_TO_AGENT[type], gate.path),
          }).toEqual({
            type,
            path: gate.path,
            optional: true,
          });

      for (const list of Object.values(CONTROL_PLANE_FIELD_GATES))
        for (const gate of list ?? []) expect(Object.keys(PROTOCOL_FEATURES)).toContain(gate.feature);
    });
  });
});
