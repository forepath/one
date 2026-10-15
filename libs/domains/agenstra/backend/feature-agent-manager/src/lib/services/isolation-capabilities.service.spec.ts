import type { DockerService, IsolationProbeResult } from './docker.service';
import { IsolationCapabilitiesService } from './isolation-capabilities.service';

class TestIsolationCapabilitiesService extends IsolationCapabilitiesService {
  testEnv: NodeJS.ProcessEnv = {};

  protected override get env(): NodeJS.ProcessEnv {
    return this.testEnv;
  }
}

describe('IsolationCapabilitiesService', () => {
  let docker: jest.Mocked<
    Pick<DockerService, 'getDockerHostInfo' | 'runIsolationProbe' | 'getImageId' | 'removeStaleIsolationProbes'>
  >;
  let service: TestIsolationCapabilitiesService;
  const ok: IsolationProbeResult = { ok: true };

  function hostInfo(
    runtimes: Record<string, string | null> = {
      runc: 'runc',
      'runsc-systrap': '/usr/local/bin/runsc',
      'runsc-systrap-hostnet': '/usr/local/bin/runsc',
    },
  ) {
    return { serverVersion: '29.0.0', kernelVersion: '6.8.0', defaultRuntime: 'runc', runtimes };
  }

  beforeEach(() => {
    docker = {
      getDockerHostInfo: jest.fn().mockResolvedValue(hostInfo()),
      runIsolationProbe: jest.fn().mockResolvedValue(ok),
      getImageId: jest.fn().mockResolvedValue('sha256:image'),
      removeStaleIsolationProbes: jest.fn().mockResolvedValue(0),
    };
    service = new TestIsolationCapabilitiesService(docker as unknown as DockerService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

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

  it('probes on bootstrap after removing stale probe containers', async () => {
    service.testEnv = { AGENT_ISOLATION_PROBE_ENABLED: 'false' };
    service.onApplicationBootstrap();

    await new Promise((resolve) => setImmediate(resolve));
    await service.probe();

    expect(docker.removeStaleIsolationProbes).toHaveBeenCalled();
    expect(service.getCapabilities().probedAt).not.toBeNull();
  });
});
