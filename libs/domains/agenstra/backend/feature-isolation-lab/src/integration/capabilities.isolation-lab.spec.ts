import { type DockerService, IsolationCapabilitiesService } from '@forepath/agenstra/backend/feature-agent-manager';

import { ISOLATION_LAB_AGENT_NETWORK } from '../lib/isolation-lab.config';

import { requireLabKvm, runHostScript } from './harness/lab-host';
import { createLabDockerService } from './harness/manager';
import { type LabVm, startLabVm } from './harness/vm';

const VM_BOOT_TIMEOUT = 45 * 60_000;
/** Probe image: provides sh, python3 (shared-namespace probe), id and dmesg like the worker image. */
const PROBE_IMAGE = 'python:3.12-alpine';

class LabIsolationCapabilitiesService extends IsolationCapabilitiesService {
  constructor(
    docker: DockerService,
    private readonly labEnv: NodeJS.ProcessEnv,
  ) {
    super(docker);
  }

  protected override get env(): NodeJS.ProcessEnv {
    return this.labEnv;
  }
}

/**
 * The agent manager's real capability probe (IsolationCapabilitiesService + DockerService) against real
 * hosts: egress guard enabled and workers on the agent network, so the shared-namespace and embedded
 * DNS checks run for every gVisor runtime pair.
 */
describe('isolation lab: capability probes', () => {
  const previousNetwork = process.env['AGENT_DOCKER_NETWORK'];
  const env: NodeJS.ProcessEnv = {
    AGENT_DOCKER_NETWORK: ISOLATION_LAB_AGENT_NETWORK,
    AGENT_EGRESS_GUARD_ENABLED: 'true',
    AGENT_ISOLATION_PROBE_IMAGE: PROBE_IMAGE,
    AGENT_ISOLATION_PROBE_ENABLED: 'false',
    AGENT_ISOLATION_PROBE_TIMEOUT_MS: String(5 * 60_000),
  };

  beforeAll(() => {
    // DockerService reads the agent network from the process environment for the namespace probe.
    process.env['AGENT_DOCKER_NETWORK'] = ISOLATION_LAB_AGENT_NETWORK;
  });

  afterAll(() => {
    if (previousNetwork === undefined) {
      delete process.env['AGENT_DOCKER_NETWORK'];
    } else {
      process.env['AGENT_DOCKER_NETWORK'] = previousNetwork;
    }
  });

  describe('host with hardware virtualization', () => {
    let vm: LabVm;
    let kvm = false;
    let service: LabIsolationCapabilitiesService;

    beforeAll(async () => {
      vm = await startLabVm('caps-kvm');
      kvm = await requireLabKvm(vm, 'capability probes with KVM');

      const prepared = await runHostScript(vm, 'install');

      if (prepared.code !== 0) {
        throw new Error(`Host preparation failed:\n${prepared.output.slice(-3000)}`);
      }

      const docker = createLabDockerService(await vm.dockerSocket());

      await docker.ensureNetworkExists(ISOLATION_LAB_AGENT_NETWORK);
      service = new LabIsolationCapabilitiesService(docker, env);
    }, VM_BOOT_TIMEOUT);

    afterAll(async () => {
      service?.onModuleDestroy();
      await vm?.stop();
    });

    it('reports every prepared level ready and recommends the strongest', async () => {
      const capabilities = await service.probe();

      expect(capabilities.levels.standard.state).toBe('ready');
      expect(capabilities.levels.sandboxed).toEqual(
        expect.objectContaining({ runtime: 'runsc-systrap', state: 'ready' }),
      );

      if (kvm) {
        expect(capabilities.levels['sandboxed-kvm']).toEqual({ rank: 3, runtime: 'runsc-kvm', state: 'ready' });
        expect(capabilities.recommendedLevel).toBe('sandboxed-kvm');
        expect(capabilities.availableLevels).toEqual(['sandboxed-kvm', 'sandboxed', 'standard']);
      } else {
        expect(capabilities.recommendedLevel).toBe('sandboxed');
      }
    });

    it('detects a KVM runtime registered with another platform', async () => {
      if (!kvm) {
        return;
      }

      await vm.execOrThrow(
        'runsc install --runtime=runsc-kvm -- --platform=systrap >/dev/null && systemctl reload docker && sleep 2',
        { sudo: true },
      );

      try {
        const capabilities = await service.probe();

        expect(capabilities.levels['sandboxed-kvm']).toEqual(
          expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_RUNTIME_MISCONFIGURED' }),
        );
        expect(capabilities.recommendedLevel).toBe('sandboxed');
      } finally {
        await vm.execOrThrow(
          'runsc install --runtime=runsc-kvm -- --platform=kvm >/dev/null && systemctl reload docker && sleep 2',
          { sudo: true },
        );
      }
    });

    it('reports a host that lost /dev/kvm as E_KVM_UNAVAILABLE and keeps the sandboxed level', async () => {
      if (!kvm) {
        return;
      }

      await vm.execOrThrow(
        `printf 'install kvm_intel /bin/false\\ninstall kvm_amd /bin/false\\ninstall kvm /bin/false\\n' > /etc/modprobe.d/agenstra-lab-nokvm.conf
modprobe -r kvm_intel kvm_amd kvm 2>/dev/null || true
test ! -c /dev/kvm`,
        { sudo: true },
      );

      try {
        const capabilities = await service.probe();

        expect(capabilities.levels['sandboxed-kvm']).toEqual(
          expect.objectContaining({ state: 'probe-failed', reasonCode: 'E_KVM_UNAVAILABLE' }),
        );
        expect(capabilities.levels.sandboxed.state).toBe('ready');
        expect(capabilities.recommendedLevel).toBe('sandboxed');
      } finally {
        await vm.execOrThrow(
          'rm -f /etc/modprobe.d/agenstra-lab-nokvm.conf && (modprobe kvm_intel 2>/dev/null || modprobe kvm_amd) && sleep 1 && test -c /dev/kvm',
          { sudo: true },
        );
      }

      await expect(service.probe()).resolves.toEqual(expect.objectContaining({ recommendedLevel: 'sandboxed-kvm' }));
    });

    it('honours the administrative switch of the KVM level', async () => {
      const disabled = new LabIsolationCapabilitiesService(createLabDockerService(await vm.dockerSocket()), {
        ...env,
        AGENT_ISOLATION_SANDBOX_KVM_ENABLED: 'false',
      });

      try {
        const capabilities = await disabled.probe();

        expect(capabilities.levels['sandboxed-kvm'].state).toBe('disabled-by-admin');
        expect(capabilities.recommendedLevel).toBe('sandboxed');
      } finally {
        disabled.onModuleDestroy();
      }
    });
  });

  describe('ordinary cloud VM (no nested virtualization)', () => {
    let vm: LabVm;
    let service: LabIsolationCapabilitiesService;

    beforeAll(async () => {
      vm = await startLabVm('caps-plain', { exposeVirtualization: false });

      const prepared = await runHostScript(vm, 'install');

      if (prepared.code !== 0) {
        throw new Error(`Host preparation failed:\n${prepared.output.slice(-3000)}`);
      }

      const docker = createLabDockerService(await vm.dockerSocket());

      await docker.ensureNetworkExists(ISOLATION_LAB_AGENT_NETWORK);
      service = new LabIsolationCapabilitiesService(docker, env);
    }, VM_BOOT_TIMEOUT);

    afterAll(async () => {
      service?.onModuleDestroy();
      await vm?.stop();
    });

    it('offers sandboxed and reports sandboxed-kvm as not registered', async () => {
      const capabilities = await service.probe();

      expect(capabilities.levels.sandboxed.state).toBe('ready');
      expect(capabilities.levels['sandboxed-kvm']).toEqual(
        expect.objectContaining({ state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' }),
      );
      expect(capabilities.recommendedLevel).toBe('sandboxed');
    });
  });
});
