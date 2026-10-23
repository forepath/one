import {
  agentMessage,
  controlPlaneMessage,
  decodeAgentMessage,
  decodeControlPlaneMessage,
  NODE_AGENT_SERVICE,
} from './codec';
import { decodeEnvelope, encodeEnvelope, MAX_ENVELOPE_BYTES } from './envelope';
import { dockerRuntimeFamily, RUNTIMES_WIRE, workloadIsolationLevel } from './messages';

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

describe('M7 messages and fields (3.1, 3.35)', () => {
  const session = { migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', attempt: 1, replica: 'p1/lw-vm/db1/0' };
  const digest = 'sha256:' + 'a'.repeat(64);
  const image = { ref: 'registry.lw/p1/debian-13:1', digest, format: 'qcow2' as const, layerDigest: digest };
  const workload = {
    id: 'p1/d1/web/0',
    project: 'p1',
    deployment: 'd1',
    service: 'web',
    kind: 'service' as const,
    image: 'nginx@' + digest,
    environment: {},
    labels: {},
    addresses: ['10.88.0.10'],
    dnsSearch: [],
    runtime: 'runc' as const,
    resources: { cpuMillis: 100, memoryBytes: 1024 },
    restart: 'always' as const,
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
  const vm = {
    uid: session.migration,
    firmware: 'uefi' as const,
    cpuModel: 'host-model' as const,
    vcpus: 2,
    memoryMiB: 4096,
    disks: [{ name: 'root', volume: 'p1/lw-vm/db1.root', bus: 'virtio' as const, cache: 'none' as const, boot: true }],
    nics: [
      { name: 'eth0', mac: '52:54:00:aa:bb:cc', addresses: ['10.88.0.10'] },
      { name: 'eth1', mac: '52:54:00:aa:bb:cd', addresses: ['10.88.1.10', 'fd88::10'] },
    ],
    image,
    graphics: true,
    power: 'running' as const,
  };
  const desired = (extra: Record<string, unknown>) => ({
    revision: 1,
    network: {
      node: 'n1',
      addresses: [],
      wireguard: [],
      services: [],
      bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: [], sessions: [] },
      firewall: { sets: {}, rules: [] },
      dns: { domain: 'lw', records: [], visibility: {} },
    },
    controlPlane: { role: 'none' as const, members: [], automaticFailover: false, scope: 'c1' },
    lifecycle: 'active' as const,
    ...extra,
  });

  it('reports the isolation ladder, KVM facts, microVM and VM support in the hello', () => {
    const env = agentMessage('hello', {
      ...hello,
      capabilities: {
        ...hello.capabilities,
        runtimes: ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'],
        checkpoint: { runc: true, runsc: true, runscKvm: true },
        isolation: {
          runc: { state: 'ready', checkedAt: '2026-10-23T10:00:00Z' },
          'sandboxed-kvm': {
            state: 'unsupported',
            reasonCode: 'E_KVM_UNAVAILABLE',
            reason: '/dev/kvm is missing',
            checkedAt: '2026-10-23T10:00:00Z',
          },
        },
        kvm: {
          cpu: 'yes',
          device: 'present',
          module: 'loaded',
          nested: 'unknown',
          hypervisor: 'yes',
          usable: true,
          optOut: false,
        },
        microvm: {
          launcherDigest: digest,
          unpackCache: true,
          thinPool: false,
          migration: { generic: true, modes: ['generic', 'vm'], qemu: '1:10.0.13+ds-0+deb13u1' },
        },
        microvmMigration: true,
        virtualMachines: true,
        cpuFlagsHash: '0123456789abcdef',
      },
    });

    expect(decodeAgentMessage(env).ok).toBe(true);
    expect(() =>
      agentMessage('hello', {
        ...hello,
        capabilities: { ...hello.capabilities, isolation: { gvisor: { state: 'ready' } } as never },
      }),
    ).toThrow();
    expect(() =>
      agentMessage('hello', {
        ...hello,
        capabilities: { ...hello.capabilities, runtimes: ['kata' as never] },
      }),
    ).toThrow();
  });

  it('keeps workloads[].runtime at the Docker family and carries stronger levels in isolation', () => {
    const kvm = { ...workload, runtime: 'sandboxed' as const, isolation: 'sandboxed-kvm' as const };

    expect(() => controlPlaneMessage('desiredState', desired({ workloads: [kvm] }))).not.toThrow();
    expect(() =>
      controlPlaneMessage('desiredState', desired({ workloads: [{ ...workload, runtime: 'microvm' as never }] })),
    ).toThrow();
    expect(() =>
      controlPlaneMessage('desiredState', desired({ workloads: [{ ...workload, isolation: 'sandboxed' as never }] })),
    ).toThrow();
    expect(workloadIsolationLevel(kvm)).toBe('sandboxed-kvm');
    expect(workloadIsolationLevel(workload)).toBe('runc');
    expect(RUNTIMES_WIRE.map(dockerRuntimeFamily)).toEqual(['runc', 'sandboxed', 'sandboxed', 'runc']);
  });

  it('allows only /dev/kvm as a workload device', () => {
    const withDevices = (devices: unknown) =>
      controlPlaneMessage('desiredState', desired({ workloads: [{ ...workload, devices } as never] }));
    const env = withDevices([{ path: '/dev/kvm' }]);
    const decoded = decodeControlPlaneMessage(env);

    expect(
      decoded.ok && decoded.message.type === 'desiredState' && decoded.message.payload.workloads[0].devices,
    ).toEqual([{ path: '/dev/kvm', permissions: 'rwm' }]);
    expect(() => withDevices([{ path: '/dev/sda' }])).toThrow();
    expect(() => withDevices([{ path: '/dev/kvm', permissions: 'r' }])).toThrow();
  });

  it('validates microVM and full-VM workloads (one or more NICs)', () => {
    const micro = {
      ...workload,
      isolation: 'microvm' as const,
      microvm: {
        mode: 'generic' as const,
        guestImage: 'nginx@' + digest,
        layers: [{ digest, diffId: digest, size: 1024, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' }],
        process: {
          entrypoint: ['/docker-entrypoint.sh'],
          cmd: ['nginx'],
          env: ['A=1'],
          user: '',
          workingDir: '/',
          stopSignal: 'SIGQUIT',
        },
        vcpus: 1,
        memoryMiB: 512,
        rootfsBytes: 10_737_418_240,
      },
    };
    const full = { ...workload, isolation: 'microvm' as const, vm };

    expect(() => controlPlaneMessage('desiredState', desired({ workloads: [micro, full] }))).not.toThrow();
    expect(() =>
      controlPlaneMessage('desiredState', desired({ workloads: [{ ...full, vm: { ...vm, nics: [] } }] })),
    ).toThrow();
    expect(() =>
      controlPlaneMessage('desiredState', {
        ...desired({}),
        workloads: [{ ...full, vm: { ...vm, nics: [{ ...vm.nics[0], mac: '02:00:00:00:00:01' }] } }],
      }),
    ).toThrow();
    expect(() =>
      controlPlaneMessage(
        'desiredState',
        desired({ workloads: [{ ...micro, microvm: { ...micro.microvm, memoryMiB: 64 } }] }),
      ),
    ).toThrow();
  });

  it('carries block volumes and the host settings', () => {
    const volume = {
      id: 'p1/lw-vm/db1.root',
      dockerName: 'lw-vol-p1.lw-vm.db1.root',
      minor: 1001,
      port: 7801,
      sizeBytes: 21_474_836_480,
      replicas: [{ node: 'n1', nodeId: 0, address: '10.93.0.1' }],
      connections: [],
      primary: 'n1',
      keyRef: 'secret://p1/lw-volume-lw-vm.db1.root',
      mode: 'block' as const,
      initializeFrom: { digest, format: 'raw' as const },
    };

    expect(() =>
      controlPlaneMessage('desiredState', desired({ volumes: [volume], host: { kvm: 'disabled', probeNonce: 'n-1' } })),
    ).not.toThrow();
    expect(() =>
      controlPlaneMessage('desiredState', desired({ volumes: [{ ...volume, mode: 'filesystem' as never }] })),
    ).toThrow();
    expect(() => controlPlaneMessage('desiredState', desired({ host: { kvm: 'off' as never } }))).toThrow();
  });

  it("reports a VM's power state and a running boot disk import in the workload status", () => {
    const entry = { id: 'p1/lw-vm/db1/0', state: 'running' as const, specHash: 'h' };

    expect(() =>
      agentMessage('workloadStatus', {
        workloads: [
          { ...entry, vm: { power: 'shutting-down' } },
          { ...entry, id: 'p1/lw-vm/db2/0', state: 'pending', vm: { importing: true } },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      agentMessage('workloadStatus', { workloads: [{ ...entry, vm: { power: 'off' as never } }] }),
    ).toThrow();
    expect(() =>
      agentMessage('workloadStatus', { workloads: [{ ...entry, vm: { power: 'running', disk: 'x' } as never }] }),
    ).toThrow();
    // Background import progress (F3b).
    expect(() =>
      agentMessage('workloadStatus', {
        workloads: [
          {
            ...entry,
            state: 'pending',
            vm: { importing: true, importProgress: { phase: 'writing', bytes: 1024, totalBytes: 4096 } },
          },
          { ...entry, state: 'failed', vm: { importProgress: { phase: 'failed' } } },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      agentMessage('workloadStatus', {
        workloads: [{ ...entry, vm: { importProgress: { phase: 'copying' as never } } }],
      }),
    ).toThrow();
    expect(() =>
      agentMessage('workloadStatus', {
        workloads: [{ ...entry, vm: { importProgress: { phase: 'writing', bytes: -1 } } }],
      }),
    ).toThrow();
  });

  it('carries the VM command an event reports the outcome of (optional, lenient values)', () => {
    const event = {
      source: 'storage' as const,
      level: 'error' as const,
      message: 'vmPower failed: no launcher',
      at: new Date().toISOString(),
      labels: { kind: 'virtual-machine', replica: 'p1/lw-vm/db1/0', action: 'reset', result: 'failed' },
    };

    expect(() => agentMessage('event', event)).not.toThrow();
    expect(() => agentMessage('event', { ...event, vmCommand: { type: 'vmPower', action: 'reset' } })).not.toThrow();
    expect(() =>
      agentMessage('event', {
        ...event,
        vmCommand: { type: 'vmImageImport', importId: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f' },
      }),
    ).not.toThrow();
    // Unknown types / actions pass the schema (the control plane ignores them); unknown keys don't.
    expect(() => agentMessage('event', { ...event, vmCommand: { type: 'vmSomething' } })).not.toThrow();
    expect(() => agentMessage('event', { ...event, vmCommand: { type: 'vmPower', x: 1 } as never })).toThrow();
  });

  it('validates consoles, power, re-imaging and the QEMU migration commands', () => {
    expect(() =>
      controlPlaneMessage('consoleOpen', { target: { kind: 'replica', replica: session.replica }, kind: 'vnc' }),
    ).not.toThrow();
    expect(() =>
      controlPlaneMessage('consoleOpen', { target: { kind: 'node' } as never, kind: 'serial', cols: 80, rows: 24 }),
    ).toThrow();
    expect(() => controlPlaneMessage('vmPower', { replica: session.replica, action: 'reset' })).not.toThrow();
    expect(() => controlPlaneMessage('vmPower', { replica: session.replica, action: 'start' as never })).toThrow();
    expect(() =>
      controlPlaneMessage('vmImageImport', {
        import: session.migration,
        replica: session.replica,
        volume: 'p1/lw-vm/db1.root',
        image,
      }),
    ).not.toThrow();

    const token = 'A'.repeat(43);

    expect(() =>
      controlPlaneMessage('vmMigrationPrepare', {
        ...session,
        source: 'n1',
        token,
        addresses: ['10.88.0.10'],
        volumes: ['p1/lw-vm/db1.root'],
        expiresInSeconds: 600,
        spec: { ...workload, isolation: 'microvm', vm },
      }),
    ).not.toThrow();
    expect(() =>
      controlPlaneMessage('vmMigrationStart', {
        ...session,
        target: 'n2',
        endpoint: { address: '10.93.0.2', port: 7480 },
        token,
        downtimeLimitMs: 300,
        maxSeconds: 120,
      }),
    ).not.toThrow();
    expect(() => controlPlaneMessage('vmMigrationSwitchover', session)).not.toThrow();
    expect(() => controlPlaneMessage('vmMigrationSwitchover', { ...session, force: true } as never)).toThrow();
  });
});

describe('capability updates (M7 follow-up)', () => {
  it('carries the hello capabilities on the open stream and the control plane features in helloAck', () => {
    const update = agentMessage('capabilitiesUpdate', {
      capabilities: { ...hello.capabilities, runtimes: ['runc', 'microvm'] },
    });
    const decoded = decodeAgentMessage(update);

    expect(decoded.ok && decoded.message).toMatchObject({
      type: 'capabilitiesUpdate',
      payload: { capabilities: { runtimes: ['runc', 'microvm'] } },
    });
    expect(() => agentMessage('capabilitiesUpdate', {} as never)).toThrow();

    const ack = decodeControlPlaneMessage(
      controlPlaneMessage('helloAck', { protocolVersion: 2, features: ['capability-updates'] }),
    );

    expect(ack.ok && ack.message.payload).toEqual({ protocolVersion: 2, features: ['capability-updates'] });
    expect(() => controlPlaneMessage('helloAck', { protocolVersion: 2, features: ['Bad Id'] })).toThrow();
  });
});
