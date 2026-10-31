import type { AgentRuntime, IsolationProbeResult } from '../runtime/agent-runtime';
import { IsolationCapabilitiesService } from './isolation-capabilities.service';

class TestIsolationCapabilitiesService extends IsolationCapabilitiesService {
  testEnv: NodeJS.ProcessEnv = {};

  protected override get env(): NodeJS.ProcessEnv {
    return this.testEnv;
  }
}

describe('IsolationCapabilitiesService', () => {
  let docker: jest.Mocked<
    Pick<
      AgentRuntime,
      'getDockerHostInfo' | 'runIsolationProbe' | 'runMicrovmProbe' | 'getImageId' | 'removeStaleIsolationProbes'
    >
  >;
  let service: TestIsolationCapabilitiesService;
  const ok: IsolationProbeResult = { ok: true };
  /** What most cloud VMs report: no hardware virtualization exposed to the host. */
  const noKvm: IsolationProbeResult = {
    ok: false,
    reasonCode: 'E_KVM_UNAVAILABLE',
    reason: 'The KVM device (/dev/kvm) is not available on this host',
  };

  function hostInfo(
    runtimes: Record<string, string | null> = {
      runc: 'runc',
      'runsc-systrap': '/usr/local/bin/runsc',
      'runsc-systrap-hostnet': '/usr/local/bin/runsc',
    },
    runtimeArgs: Record<string, string[] | null> = {},
  ) {
    return { serverVersion: '29.0.0', kernelVersion: '6.8.0', defaultRuntime: 'runc', runtimes, runtimeArgs };
  }

  /** Host prepared with both gVisor platforms (runtime arguments as registered by the host script). */
  function kvmHostInfo(overrides: Record<string, string[] | null> = {}) {
    return hostInfo(
      {
        runc: 'runc',
        'runsc-systrap': '/usr/local/bin/runsc',
        'runsc-systrap-hostnet': '/usr/local/bin/runsc',
        'runsc-kvm': '/usr/local/bin/runsc',
        'runsc-kvm-hostnet': '/usr/local/bin/runsc',
      },
      {
        runc: null,
        'runsc-systrap': ['--platform=systrap'],
        'runsc-systrap-hostnet': ['--platform=systrap', '--network=host'],
        'runsc-kvm': ['--platform=kvm'],
        'runsc-kvm-hostnet': ['--platform=kvm', '--network=host'],
        ...overrides,
      },
    );
  }

  beforeEach(() => {
    docker = {
      getDockerHostInfo: jest.fn().mockResolvedValue(hostInfo()),
      runIsolationProbe: jest.fn().mockResolvedValue(ok),
      runMicrovmProbe: jest.fn().mockResolvedValue(noKvm),
      getImageId: jest.fn().mockResolvedValue('sha256:image'),
      removeStaleIsolationProbes: jest.fn().mockResolvedValue(0),
    };
    service = new TestIsolationCapabilitiesService(docker as unknown as AgentRuntime);
  });

  afterEach(async () => {
    await service.whenMicrovmProbed();
    service.onModuleDestroy();
  });

  /** Full probe including the background microvm probe. */
  async function probeAll() {
    await service.probe();

    return service.whenMicrovmProbed();
  }

  it('starts with no recommendation until the first probe completed', () => {
    const initial = service.getCapabilities();

    expect(initial.probedAt).toBeNull();
    expect(initial.recommendedLevel).toBeNull();
    expect(initial.levels.standard.reasonCode).toBe('E_PROBE_PENDING');
  });

  it('recommends sandboxed when the gVisor runtime is registered and both probes pass', async () => {
    const result = await service.probe();

    expect(result.levels.standard.state).toBe('ready');
    expect(result.levels.sandboxed.state).toBe('ready');
    expect(result.recommendedLevel).toBe('sandboxed');
    expect(result.availableLevels).toEqual(['sandboxed', 'standard']);
    expect(result.revision).toMatch(/^sha256:/);
    expect(docker.runIsolationProbe).toHaveBeenCalledWith(expect.objectContaining({ expectedRuntime: 'runc' }));
    expect(docker.runIsolationProbe.mock.calls[0][0].runtime).toBeUndefined();
    expect(docker.runIsolationProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'runsc-systrap',
        sharedNetworkNamespace: true,
        sharedNetworkNamespaceRuntime: 'runsc-systrap-hostnet',
      }),
    );
  });

  it('reports sandboxed as unsupported when the runtime is not registered (runc-only host)', async () => {
    docker.getDockerHostInfo.mockResolvedValue(hostInfo({ runc: 'runc' }));

    const result = await service.probe();

    expect(result.levels.sandboxed).toEqual(
      expect.objectContaining({ state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' }),
    );
    expect(result.recommendedLevel).toBe('standard');
    expect(docker.runIsolationProbe).toHaveBeenCalledTimes(1);
  });

  it('requires the egress-guard compatible runtime when egress guards are enabled', async () => {
    docker.getDockerHostInfo.mockResolvedValue(hostInfo({ runc: 'runc', 'runsc-systrap': '/usr/local/bin/runsc' }));

    const result = await service.probe();

    expect(result.levels.sandboxed).toEqual(
      expect.objectContaining({ state: 'unsupported', reasonCode: 'E_SHARED_NETNS_RUNTIME_NOT_REGISTERED' }),
    );

    service.testEnv = { AGENT_EGRESS_GUARD_ENABLED: 'false' };

    await expect(service.probe()).resolves.toEqual(expect.objectContaining({ recommendedLevel: 'sandboxed' }));
  });

  it('reports a failed sandbox probe without affecting the standard floor', async () => {
    docker.runIsolationProbe.mockImplementation(async ({ runtime }) =>
      !runtime ? ok : { ok: false, reasonCode: 'E_PROBE_EXEC_FAILED', reason: 'exec failed' },
    );

    const result = await service.probe();

    expect(result.levels.sandboxed).toEqual(
      expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_PROBE_EXEC_FAILED' }),
    );
    expect(result.recommendedLevel).toBe('standard');
  });

  it('marks the host as not runnable when the runc baseline fails', async () => {
    docker.runIsolationProbe.mockResolvedValue({ ok: false, reasonCode: 'E_PROBE_START_FAILED', reason: 'no start' });

    const result = await service.probe();

    expect(result.levels.standard.state).toBe('probe-failed');
    expect(result.levels.sandboxed.state).toBe('probe-failed');
    expect(result.recommendedLevel).toBeNull();
    expect(result.availableLevels).toEqual([]);
    expect(docker.runIsolationProbe).toHaveBeenCalledTimes(1);
  });

  it('keeps the standard floor when only the probe image is unavailable', async () => {
    docker.runIsolationProbe.mockResolvedValue({ ok: false, reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE', reason: 'pull' });

    const result = await service.probe();

    expect(result.levels.standard).toEqual(
      expect.objectContaining({ state: 'ready', reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE' }),
    );
    expect(result.levels.sandboxed.state).toBe('probe-failed');
    expect(result.recommendedLevel).toBe('standard');
  });

  it('rejects a shared-namespace runtime equal to the Netstack runtime', async () => {
    service.testEnv = { AGENT_SANDBOX_SHARED_NETNS_RUNTIME: 'runsc-systrap' };

    const result = await service.probe();

    expect(result.levels.sandboxed.reasonCode).toBe('E_SHARED_NETNS_RUNTIME_NOT_REGISTERED');
  });

  it('marks the host as not runnable when Docker is unreachable', async () => {
    docker.getDockerHostInfo.mockRejectedValue(new Error('connect ENOENT'));

    const result = await service.probe();

    expect(result.levels.standard.reasonCode).toBe('E_DOCKER_BASELINE_UNAVAILABLE');
    expect(result.recommendedLevel).toBeNull();
  });

  it('honours the administrative switch', async () => {
    service.testEnv = { AGENT_ISOLATION_SANDBOX_ENABLED: 'false' };

    const result = await service.probe();

    expect(result.levels.sandboxed.state).toBe('disabled-by-admin');
    expect(result.recommendedLevel).toBe('standard');
  });

  it('skips the shared namespace check when egress guards are disabled', async () => {
    service.testEnv = { AGENT_EGRESS_GUARD_ENABLED: 'false' };

    await service.probe();

    expect(docker.runIsolationProbe).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'runsc-systrap', sharedNetworkNamespace: false }),
    );
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    const [a, b] = await Promise.all([service.probe(), service.probe()]);

    expect(a.revision).toBe(b.revision);
    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);
  });

  it('reuses recent results for on-demand probes', async () => {
    await service.probe();
    await service.requestProbe();

    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);
  });

  it('waits for the first probe and re-probes an unhealthy floor before creations', async () => {
    await service.getCapabilitiesForCreation();
    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);

    await service.getCapabilitiesForCreation();
    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);

    docker.runIsolationProbe.mockResolvedValue({ ok: false, reasonCode: 'E_PROBE_START_FAILED', reason: 'x' });
    await service.probe();
    docker.runIsolationProbe.mockResolvedValue(ok);

    const result = await service.getCapabilitiesForCreation();

    expect(result.levels.standard.state).toBe('ready');
    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(3);
  });

  it('re-probes after repeated sandboxed runtime failures', async () => {
    await service.probe();
    docker.getDockerHostInfo.mockClear();

    service.recordRuntimeFailure('sandboxed');
    service.recordRuntimeFailure('sandboxed');
    expect(docker.getDockerHostInfo).not.toHaveBeenCalled();

    service.recordRuntimeFailure('sandboxed');
    await service.probe();
    expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);
  });

  it('ignores standard failures and resets the streak on success', async () => {
    await service.probe();
    docker.getDockerHostInfo.mockClear();

    service.recordRuntimeFailure('standard');
    service.recordRuntimeFailure('sandboxed');
    service.recordRuntimeFailure('sandboxed');
    service.recordRuntimeSuccess('sandboxed');
    service.recordRuntimeFailure('sandboxed');

    expect(docker.getDockerHostInfo).not.toHaveBeenCalled();
  });

  describe('sandboxed-kvm level', () => {
    it('is unsupported (not probed) when the KVM runtime is not registered', async () => {
      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual({
        rank: 3,
        runtime: 'runsc-kvm',
        state: 'unsupported',
        reasonCode: 'E_RUNTIME_NOT_REGISTERED',
        reason: "Docker runtime 'runsc-kvm' (gVisor KVM) is not registered on this host",
      });
      expect(result.recommendedLevel).toBe('sandboxed');
      expect(docker.runIsolationProbe).toHaveBeenCalledTimes(2);
    });

    it('is recommended when registered on the KVM platform and its probe passes', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual({ rank: 3, runtime: 'runsc-kvm', state: 'ready' });
      expect(result.recommendedLevel).toBe('sandboxed-kvm');
      expect(result.availableLevels).toEqual(['sandboxed-kvm', 'sandboxed', 'standard']);
      // The guard topology (shared namespace + agent network DNS) is verified with the KVM hostnet runtime.
      expect(docker.runIsolationProbe).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: 'runsc-kvm',
          sharedNetworkNamespace: true,
          sharedNetworkNamespaceRuntime: 'runsc-kvm-hostnet',
        }),
      );
      expect(docker.runIsolationProbe).toHaveBeenCalledTimes(3);
    });

    it('is probed independently of the sandboxed level', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());
      docker.runIsolationProbe.mockImplementation(async ({ runtime }) =>
        runtime === 'runsc-systrap' ? { ok: false, reasonCode: 'E_PROBE_EXEC_FAILED', reason: 'exec failed' } : ok,
      );

      const result = await service.probe();

      expect(result.levels.sandboxed.state).toBe('probe-failed');
      expect(result.levels['sandboxed-kvm'].state).toBe('ready');
      expect(result.recommendedLevel).toBe('sandboxed-kvm');
    });

    it('reports a host without /dev/kvm distinctly and keeps sandboxed', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());
      docker.runIsolationProbe.mockImplementation(async ({ runtime }) =>
        runtime === 'runsc-kvm'
          ? {
              ok: false,
              reasonCode: 'E_KVM_UNAVAILABLE',
              reason: 'The KVM device (/dev/kvm) is not available on this host',
            }
          : ok,
      );

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_KVM_UNAVAILABLE' }),
      );
      expect(result.recommendedLevel).toBe('sandboxed');
    });

    it('rejects runtimes registered with another gVisor platform', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-kvm': ['--platform=systrap'] }));

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_RUNTIME_MISCONFIGURED' }),
      );
      expect(docker.runIsolationProbe).not.toHaveBeenCalledWith(expect.objectContaining({ runtime: 'runsc-kvm' }));
    });

    it('rejects a guard runtime without the kernel network stack (security: Netstack bypasses the guard)', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-kvm-hostnet': ['--platform=kvm'] }));

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm'].reasonCode).toBe('E_RUNTIME_MISCONFIGURED');
      expect(result.levels['sandboxed-kvm'].reason).toContain('runsc-kvm-hostnet');
    });

    it('rejects a Netstack runtime registered with the host network', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-kvm': ['--platform=kvm', '--network=host'] }));

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm'].reasonCode).toBe('E_RUNTIME_MISCONFIGURED');
    });

    it('falls back to the name check when Docker reports no runtime arguments', async () => {
      // Older Docker releases report no runtime arguments for any runtime.
      docker.getDockerHostInfo.mockResolvedValue(
        kvmHostInfo({
          'runsc-systrap': null,
          'runsc-systrap-hostnet': null,
          'runsc-kvm': null,
          'runsc-kvm-hostnet': null,
        }),
      );

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm'].state).toBe('ready');
    });

    it('treats a KVM runtime registered without arguments as misconfigured when Docker reports arguments', async () => {
      // Docker omits runtimeArgs for runtimes registered without arguments (gVisor default platform: systrap).
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-kvm': null }));

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_RUNTIME_MISCONFIGURED' }),
      );
    });

    it('rejects a sandboxed guard runtime without the kernel network stack (security: guard bypass)', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-systrap-hostnet': ['--platform=systrap'] }));

      const result = await service.probe();

      expect(result.levels.sandboxed).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_RUNTIME_MISCONFIGURED' }),
      );
      expect(result.levels.sandboxed.reason).toContain('runsc-systrap-hostnet');
      expect(result.levels['sandboxed-kvm'].state).toBe('ready');
    });

    it('does not require the guard runtime network mode when no guard topology is used', async () => {
      service.testEnv = { AGENT_EGRESS_GUARD_ENABLED: 'false' };
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-systrap-hostnet': ['--platform=systrap'] }));

      const result = await service.probe();

      expect(result.levels.sandboxed.state).toBe('ready');
    });

    it('rejects KVM runtime names that reuse another level runtime', async () => {
      service.testEnv = { AGENT_SANDBOX_KVM_RUNTIME: 'runsc-systrap' };
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_RUNTIME_MISCONFIGURED' }),
      );
      expect(result.levels.sandboxed.state).toBe('ready');
    });

    it('checks runtimes registered as containerd shims by name only', async () => {
      const info = kvmHostInfo();

      // Shim runtimes (runtimeType, options in runsc.toml) are not part of runtimeArgs.
      delete info.runtimeArgs['runsc-kvm'];
      delete info.runtimeArgs['runsc-kvm-hostnet'];
      delete info.runtimeArgs['runsc-systrap-hostnet'];
      docker.getDockerHostInfo.mockResolvedValue(info);

      const result = await service.probe();

      expect(result.levels.sandboxed.state).toBe('ready');
      expect(result.levels['sandboxed-kvm'].state).toBe('ready');
    });

    it('keeps the name-based check of the sandboxed level (no new argument requirements)', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo({ 'runsc-systrap': ['--platform=ptrace'] }));

      const result = await service.probe();

      expect(result.levels.sandboxed.state).toBe('ready');
    });

    it('requires the KVM guard runtime when egress guards are enabled', async () => {
      const info = kvmHostInfo();

      delete info.runtimes['runsc-kvm-hostnet'];
      docker.getDockerHostInfo.mockResolvedValue(info);

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'unsupported', reasonCode: 'E_SHARED_NETNS_RUNTIME_NOT_REGISTERED' }),
      );
      expect(result.levels.sandboxed.state).toBe('ready');
    });

    it('uses configured runtime names', async () => {
      service.testEnv = { AGENT_SANDBOX_KVM_RUNTIME: 'kvm-a', AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME: 'kvm-b' };
      docker.getDockerHostInfo.mockResolvedValue(
        hostInfo(
          {
            runc: 'runc',
            'runsc-systrap': '/usr/local/bin/runsc',
            'runsc-systrap-hostnet': '/usr/local/bin/runsc',
            'kvm-a': '/usr/local/bin/runsc',
            'kvm-b': '/usr/local/bin/runsc',
          },
          { 'kvm-a': ['--platform=kvm'], 'kvm-b': ['--platform=kvm', '--network=host'] },
        ),
      );

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(expect.objectContaining({ runtime: 'kvm-a', state: 'ready' }));
      expect(docker.runIsolationProbe).toHaveBeenCalledWith(
        expect.objectContaining({ runtime: 'kvm-a', sharedNetworkNamespaceRuntime: 'kvm-b' }),
      );
    });

    it('honours its own administrative switch', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());
      service.testEnv = { AGENT_ISOLATION_SANDBOX_KVM_ENABLED: 'false' };

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'disabled-by-admin', reasonCode: 'E_DISABLED_BY_ADMIN' }),
      );
      expect(result.levels['sandboxed-kvm'].reason).toContain('AGENT_ISOLATION_SANDBOX_KVM_ENABLED=false');
      expect(result.levels.sandboxed.state).toBe('ready');
      expect(result.recommendedLevel).toBe('sandboxed');
    });

    it('is withheld when the standard floor or the probe image fails', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());
      docker.runIsolationProbe.mockResolvedValue({ ok: false, reasonCode: 'E_PROBE_START_FAILED', reason: 'x' });

      const floorFailed = await service.probe();

      expect(floorFailed.levels['sandboxed-kvm'].reasonCode).toBe('E_RUNC_PROBE_FAILED');
      expect(floorFailed.recommendedLevel).toBeNull();

      docker.runIsolationProbe.mockResolvedValue({
        ok: false,
        reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE',
        reason: 'pull',
      });

      const imageMissing = await service.probe();

      expect(imageMissing.levels['sandboxed-kvm'].reasonCode).toBe('E_PROBE_IMAGE_UNAVAILABLE');
      expect(imageMissing.recommendedLevel).toBe('standard');
    });

    it('reports Docker being unreachable for every level', async () => {
      docker.getDockerHostInfo.mockRejectedValue(new Error('connect ENOENT'));

      const result = await service.probe();

      expect(result.levels['sandboxed-kvm'].reasonCode).toBe('E_DOCKER_BASELINE_UNAVAILABLE');
    });

    it('counts runtime failures per level', async () => {
      await service.probe();
      docker.getDockerHostInfo.mockClear();

      service.recordRuntimeFailure('sandboxed-kvm');
      service.recordRuntimeFailure('sandboxed');
      service.recordRuntimeFailure('sandboxed-kvm');
      service.recordRuntimeFailure('sandboxed');
      expect(docker.getDockerHostInfo).not.toHaveBeenCalled();

      service.recordRuntimeSuccess('sandboxed');
      service.recordRuntimeFailure('sandboxed-kvm');
      await service.probe();
      expect(docker.getDockerHostInfo).toHaveBeenCalledTimes(1);
    });

    it('starts with the level pending', () => {
      expect(service.getCapabilities().levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ rank: 3, runtime: 'runsc-kvm', reasonCode: 'E_PROBE_PENDING' }),
      );
    });
  });

  describe('microvm level', () => {
    it('is unsupported on hosts without /dev/kvm and leaves the other levels untouched', async () => {
      const result = await probeAll();

      expect(result.levels.microvm).toEqual({
        rank: 4,
        runtime: 'runc',
        state: 'unsupported',
        reasonCode: 'E_KVM_UNAVAILABLE',
        reason: 'The KVM device (/dev/kvm) is not available on this host',
      });
      expect(result.recommendedLevel).toBe('sandboxed');
    });

    it('is recommended as the strongest level once its probe microVM passes', async () => {
      docker.getDockerHostInfo.mockResolvedValue(kvmHostInfo());
      docker.runMicrovmProbe.mockResolvedValue(ok);

      const first = await service.probe();

      // The microvm probe never delays the other levels: they are committed first.
      expect(first.levels.microvm.reasonCode).toBe('E_PROBE_PENDING');
      expect(first.recommendedLevel).toBe('sandboxed-kvm');

      const result = await service.whenMicrovmProbed();

      expect(result.levels.microvm.state).toBe('ready');
      expect(result.recommendedLevel).toBe('microvm');
      expect(result.availableLevels).toEqual(['microvm', 'sandboxed-kvm', 'sandboxed', 'standard']);
      expect(result.revision).not.toBe(first.revision);
      expect(docker.runMicrovmProbe).toHaveBeenCalledWith({
        image: 'ghcr.io/forepath/agenstra-manager-worker-microvm:latest',
        ownerImage: 'ghcr.io/forepath/agenstra-manager-worker:latest',
        timeoutMs: 240000,
      });
    });

    it('is independent of gVisor (runc-only host with KVM)', async () => {
      docker.runMicrovmProbe.mockResolvedValue(ok);
      service.testEnv = { AGENT_ISOLATION_SANDBOX_ENABLED: 'false', AGENT_MICROVM_IMAGE: 'registry.example/vm:1' };

      const result = await probeAll();

      expect(result.levels.sandboxed.state).toBe('disabled-by-admin');
      expect(result.levels.microvm.state).toBe('ready');
      expect(result.recommendedLevel).toBe('microvm');
      expect(docker.runMicrovmProbe).toHaveBeenCalledWith(expect.objectContaining({ image: 'registry.example/vm:1' }));
    });

    it('reports images without the microVM bridge as unsupported and boot failures as probe-failed', async () => {
      docker.runMicrovmProbe.mockResolvedValueOnce({
        ok: false,
        reasonCode: 'E_MICROVM_IMAGE_UNSUPPORTED',
        reason: 'no bridge',
      });

      expect((await probeAll()).levels.microvm).toEqual(
        expect.objectContaining({ state: 'unsupported', reasonCode: 'E_MICROVM_IMAGE_UNSUPPORTED' }),
      );

      docker.runMicrovmProbe.mockResolvedValueOnce({ ok: false, reasonCode: 'E_MICROVM_BOOT_FAILED', reason: 'boot' });

      expect((await probeAll()).levels.microvm).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_MICROVM_BOOT_FAILED' }),
      );
    });

    it('honours its administrative switch and is withheld when the standard floor fails', async () => {
      service.testEnv = { AGENT_ISOLATION_MICROVM_ENABLED: 'false' };

      const disabled = await probeAll();

      expect(disabled.levels.microvm).toEqual(expect.objectContaining({ state: 'disabled-by-admin' }));
      expect(disabled.levels.microvm.reason).toContain('AGENT_ISOLATION_MICROVM_ENABLED=false');
      expect(docker.runMicrovmProbe).not.toHaveBeenCalled();

      service.testEnv = {};
      docker.runIsolationProbe.mockResolvedValue({ ok: false, reasonCode: 'E_PROBE_START_FAILED', reason: 'x' });

      const floorFailed = await probeAll();

      expect(floorFailed.levels.microvm.reasonCode).toBe('E_RUNC_PROBE_FAILED');
      expect(docker.runMicrovmProbe).not.toHaveBeenCalled();
    });

    it('changes the capability revision when the microVM image changes', async () => {
      docker.runMicrovmProbe.mockResolvedValue(ok);

      const first = await probeAll();

      docker.getImageId.mockImplementation(async (image: string) =>
        image.includes('microvm') ? 'sha256:new-microvm' : 'sha256:image',
      );

      const second = await probeAll();

      expect(second.revision).not.toBe(first.revision);
    });

    it('re-probes after repeated microVM runtime failures and reports Docker being unreachable', async () => {
      await probeAll();
      docker.getDockerHostInfo.mockClear();

      service.recordRuntimeFailure('microvm');
      service.recordRuntimeFailure('microvm');
      expect(docker.getDockerHostInfo).not.toHaveBeenCalled();
      service.recordRuntimeFailure('microvm');
      await probeAll();
      expect(docker.getDockerHostInfo).toHaveBeenCalled();

      docker.getDockerHostInfo.mockRejectedValue(new Error('connect ENOENT'));
      expect((await probeAll()).levels.microvm.reasonCode).toBe('E_DOCKER_BASELINE_UNAVAILABLE');
    });

    it('keeps the last known microvm state while a re-probe runs', async () => {
      docker.runMicrovmProbe.mockResolvedValue(ok);
      await probeAll();

      let release: (result: IsolationProbeResult) => void = () => undefined;

      docker.runMicrovmProbe.mockImplementation(() => new Promise((resolve) => (release = resolve)));

      const during = await service.probe();

      expect(during.levels.microvm.state).toBe('ready');
      expect(service.getCapabilities().probing).toBe(true);
      release(noKvm);
      expect((await service.whenMicrovmProbed()).levels.microvm.reasonCode).toBe('E_KVM_UNAVAILABLE');
    });

    it('reports a crashing microvm probe as a boot failure', async () => {
      docker.runMicrovmProbe.mockRejectedValue(new Error('docker went away'));

      expect((await probeAll()).levels.microvm).toEqual(
        expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_MICROVM_BOOT_FAILED' }),
      );
    });

    it('starts with the level pending on runc', () => {
      expect(service.getCapabilities().levels.microvm).toEqual(
        expect.objectContaining({ rank: 4, runtime: 'runc', reasonCode: 'E_PROBE_PENDING' }),
      );
    });
  });

  it('probes on bootstrap after removing stale probe containers', async () => {
    service.testEnv = { AGENT_ISOLATION_PROBE_ENABLED: 'false' };
    service.onApplicationBootstrap();

    await new Promise((resolve) => setImmediate(resolve));
    await service.probe();

    expect(docker.removeStaleIsolationProbes).toHaveBeenCalled();
    expect(service.getCapabilities().probedAt).not.toBeNull();
  });
});
