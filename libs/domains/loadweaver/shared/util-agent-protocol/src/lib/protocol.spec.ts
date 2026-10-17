import {
  agentMessage,
  controlPlaneMessage,
  decodeAgentMessage,
  decodeControlPlaneMessage,
  NODE_AGENT_SERVICE,
} from './codec';
import { decodeEnvelope, encodeEnvelope, MAX_ENVELOPE_BYTES } from './envelope';

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

describe('agent protocol', () => {
  it('round-trips envelopes in protobuf wire format', () => {
    const envelope = {
      type: 'hello',
      id: 'abc',
      correlationId: 'x',
      channel: 'term-1',
      payload: new Uint8Array([1, 2, 3, 200]),
    };
    const decoded = decodeEnvelope(encodeEnvelope(envelope));

    expect(decoded).toEqual(envelope);
    // Field 1 (type), wire type 2: tag byte 0x0a.
    expect(encodeEnvelope(envelope)[0]).toBe(0x0a);
  });

  it('omits empty optional fields and skips unknown fields', () => {
    const bytes = encodeEnvelope({ type: 't', id: 'i', payload: new Uint8Array() });
    const withUnknown = new Uint8Array([...bytes, 0x30, 0x05, 0x3a, 0x01, 0x41]);

    expect(decodeEnvelope(withUnknown)).toEqual({
      type: 't',
      id: 'i',
      correlationId: undefined,
      channel: undefined,
      payload: new Uint8Array(),
    });
  });

  it('rejects malformed envelopes', () => {
    expect(() => decodeEnvelope(new Uint8Array([0x0a, 0x05, 0x61]))).toThrow('truncated');
    expect(() => decodeEnvelope(new Uint8Array([0x0b]))).toThrow('unsupported wire type');
    expect(() => decodeEnvelope(new Uint8Array([0x12, 0x01, 0x61]))).toThrow('without type');
    expect(() => decodeEnvelope(new Uint8Array(MAX_ENVELOPE_BYTES + 1))).toThrow('maximum size');
    expect(() => decodeEnvelope(new Uint8Array([0x0a, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]))).toThrow();
  });

  it('validates typed messages in both directions', () => {
    const decoded = decodeAgentMessage(agentMessage('hello', hello));

    expect(decoded.ok && decoded.message.type === 'hello' && decoded.message.payload.nodeName).toBe('n1');
    expect(() => agentMessage('hello', { ...hello, nodeName: 'Bad_Name' })).toThrow();

    const cp = decodeControlPlaneMessage(
      controlPlaneMessage('error', { code: 'x', message: 'y' }, { correlationId: 'r1' }),
    );

    expect(cp).toEqual({
      ok: true,
      message: expect.objectContaining({ type: 'error', correlationId: 'r1', payload: { code: 'x', message: 'y' } }),
    });
  });

  it('accepts only hostnames and IP literals as WireGuard endpoint hosts', () => {
    expect(() => agentMessage('hello', { ...hello, endpointHost: 'n1.example.com' })).not.toThrow();
    expect(() => agentMessage('hello', { ...hello, endpointHost: '2001:db8::1' })).not.toThrow();

    for (const bad of ['n1.example.com:51820', 'host;rm -rf /', '-o=x', 'a b', 'https://x']) {
      expect(() => agentMessage('hello', { ...hello, endpointHost: bad })).toThrow();
    }
  });

  it('rejects anything but IPs / CIDRs where addresses reach host tools', async () => {
    const { nodeNetworkConfigSchema } = await import('./messages');
    const base = {
      node: 'n1',
      addresses: ['10.93.0.1'],
      wireguard: [],
      services: [],
      bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: ['10.88.0.0/24'], sessions: [] },
      firewall: { sets: { lw_00000001: ['10.0.0.0/8'] }, rules: [] },
      dns: { domain: 'lw', records: [], visibility: {} },
    };

    expect(nodeNetworkConfigSchema.safeParse(base).success).toBe(true);
    expect(
      nodeNetworkConfigSchema.safeParse({
        ...base,
        firewall: { sets: { lw_00000001: ['10.0.0.0/8 } ; flush ruleset ; table x {'] }, rules: [] },
      }).success,
    ).toBe(false);
    expect(
      nodeNetworkConfigSchema.safeParse({ ...base, bgp: { ...base.bgp, originate: ['10.88.0.0/24;'] } }).success,
    ).toBe(false);
    expect(
      nodeNetworkConfigSchema.safeParse({ ...base, dns: { ...base.dns, visibility: { 'not-an-ip': [] } } }).success,
    ).toBe(false);

    // Remote access gateways (3.31): the gateway address carries its network's prefix length.
    const remoteAccess = {
      active: true,
      listenPort: 51800,
      address: '100.96.0.1/24',
      peers: [
        {
          id: '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001',
          label: 'alice@example.test/laptop',
          publicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
          allowedIps: ['100.96.0.2/32', '192.168.50.0/24'],
        },
      ],
      prefixes: ['100.96.0.0/24', '192.168.50.0/24'],
    };

    expect(nodeNetworkConfigSchema.safeParse({ ...base, remoteAccess }).success).toBe(true);
    expect(
      nodeNetworkConfigSchema.safeParse({ ...base, remoteAccess: { ...remoteAccess, address: 'fd00::1/64' } }).success,
    ).toBe(false);
    expect(
      nodeNetworkConfigSchema.safeParse({
        ...base,
        remoteAccess: { ...remoteAccess, peers: [{ ...remoteAccess.peers[0], publicKey: 'key\nPrivateKey = x' }] },
      }).success,
    ).toBe(false);
  });

  it('reports unknown types, bad JSON and schema violations', () => {
    const enc = new TextEncoder();

    expect(decodeAgentMessage({ type: 'desiredState', id: '1', payload: enc.encode('{}') })).toEqual({
      ok: false,
      error: 'unknown message type desiredState',
    });
    expect(decodeAgentMessage({ type: 'hello', id: '1', payload: enc.encode('{') })).toEqual({
      ok: false,
      error: 'payload is not valid JSON',
    });
    expect(
      decodeAgentMessage({
        type: 'hello',
        id: '1',
        payload: enc.encode(JSON.stringify({ ...hello, nodeName: 'Not Valid', extra: 1 })),
      }),
    ).toMatchObject({ ok: false });
  });

  it('ignores fields a newer agent added, on the control plane only (3.26 rollouts)', () => {
    const enc = new TextEncoder();
    const newer = {
      ...hello,
      futureField: { a: 1 },
      capabilities: { ...hello.capabilities, futureCapability: true },
      components: { release: '3.5.0', futureReport: 'x' },
    };
    const decoded = decodeAgentMessage({ type: 'hello', id: '1', payload: enc.encode(JSON.stringify(newer)) });

    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.message.payload).toEqual({
      ...hello,
      capabilities: hello.capabilities,
      components: { release: '3.5.0' },
    });
    // Agents stay strict: a control plane may never send them fields they don't know.
    expect(
      decodeControlPlaneMessage({
        type: 'logAck',
        id: '1',
        payload: enc.encode(JSON.stringify({ ok: true, extra: 1 })),
      }),
    ).toMatchObject({ ok: false });
  });

  it('serializes through the grpc service definition', () => {
    const def = NODE_AGENT_SERVICE['connect'];
    const env = agentMessage('heartbeat', {
      appliedRevision: 3,
      usage: { cpuMillis: 1, memoryBytes: 2, diskBytes: 3 },
      at: new Date().toISOString(),
    });

    expect(def.requestDeserialize(def.requestSerialize(env))).toEqual(env);
    expect(def.path).toBe('/loadweaver.agent.v1.NodeAgent/Connect');
  });
});

describe('live migration messages (3.10, protocol v2)', () => {
  const session = { migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', attempt: 1, replica: 'p1/d1/web/0' };

  it('reports checkpoint support in the hello', () => {
    expect(() =>
      agentMessage('hello', {
        ...hello,
        capabilities: {
          ...hello.capabilities,
          criu: true,
          checkpoint: { runc: true, runsc: false, criuVersion: '4.1.1' },
          transferBitsPerSecond: 10_000_000_000,
        },
      }),
    ).not.toThrow();
  });

  it('validates the session commands strictly', () => {
    const freeze = {
      ...session,
      target: 'n2',
      endpoint: { address: '10.93.0.2', port: 7480 },
      token: 'A'.repeat(43),
      runtime: 'runc' as const,
      volumes: ['p1/d1/data'],
      freezeBudgetMs: 3000,
    };

    expect(() => controlPlaneMessage('migrationFreeze', freeze)).not.toThrow();
    // Tokens are 32 bytes base64url, endpoints IPs, volumes ids; nothing unknown passes.
    expect(() => controlPlaneMessage('migrationFreeze', { ...freeze, token: 'short' })).toThrow();
    expect(() =>
      controlPlaneMessage('migrationFreeze', { ...freeze, endpoint: { address: 'evil;rm', port: 7480 } }),
    ).toThrow();
    expect(() => controlPlaneMessage('migrationFreeze', { ...freeze, volumes: ['../x'] })).toThrow();
    expect(() => controlPlaneMessage('migrationFreeze', { ...freeze, extra: 1 } as never)).toThrow();
    expect(() =>
      controlPlaneMessage('migrationAbort', { ...session, role: 'source', reason: 'x', volumes: [] }),
    ).not.toThrow();
  });

  it('accepts progress on the session channel and rejects garbage', () => {
    const env = agentMessage(
      'migrationProgress',
      { ...session, phase: 'precopy', status: 'running', round: 2, bytes: 1024, dirtyBytesPerSecond: 10 },
      { channel: `migration:${session.migration}` },
    );
    const decoded = decodeAgentMessage(env);

    expect(decoded.ok && decoded.message.channel).toBe(`migration:${session.migration}`);
    expect(() =>
      agentMessage('migrationProgress', { ...session, phase: 'teleport' as never, status: 'running' }),
    ).toThrow();
  });
});
