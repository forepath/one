import { buildAgentManagerUpdateCommand } from '@forepath/decabill/backend/feature-billing-manager';
import { GVISOR_RUNTIMES } from '@forepath/shared/backend/util-container-runtime';

import { labDockerRuntimes, requireLabKvm } from './harness/lab-host';
import { type LabVm, startLabVm } from './harness/vm';

const VM_BOOT_TIMEOUT = 45 * 60_000;

/**
 * Agent manager hosts provisioned by Decabill before an isolation level existed receive it with the next
 * update: the update command refreshes the host preparation (never fatal, reload only) before it pulls
 * and recreates the manager stack.
 */
describe('isolation lab: Decabill agent manager update', () => {
  let vm: LabVm;
  let kvm = false;

  beforeAll(async () => {
    vm = await startLabVm('decabill-update');
    kvm = await requireLabKvm(vm, 'Decabill update with KVM');
    // A host provisioned without the isolation runtimes, running a compose stack in /opt/agent-manager.
    await vm.execOrThrow(
      `mkdir -p /opt/agent-manager && cat > /opt/agent-manager/docker-compose.yml <<'YAML'
services:
  stand-in:
    image: alpine:3.20
    command: ['sleep', 'infinity']
YAML
cd /opt/agent-manager && docker compose up -d >/dev/null 2>&1 && docker compose ps -q stand-in > /root/stand-in.id`,
      { sudo: true },
    );
  }, VM_BOOT_TIMEOUT);

  afterAll(async () => {
    await vm?.stop();
  });

  it('installs the isolation runtimes on update without restarting running containers', async () => {
    const before = (
      await vm.execOrThrow(`docker inspect -f '{{.State.StartedAt}}' "$(cat /root/stand-in.id)"`, { sudo: true })
    ).trim();

    expect(Object.keys(await labDockerRuntimes(vm)).filter((name) => name.startsWith('runsc'))).toEqual([]);

    const output = await vm.execOrThrow(buildAgentManagerUpdateCommand(), { sudo: true, timeoutMs: 20 * 60_000 });
    const runtimes = await labDockerRuntimes(vm);

    expect(output).toContain('Container isolation runtimes refreshed');
    expect(output).toContain('Update completed');
    expect(runtimes[GVISOR_RUNTIMES.systrap.runtime]).toEqual(['--platform=systrap']);
    expect(runtimes[GVISOR_RUNTIMES.systrap.sharedNetnsRuntime]).toEqual(['--platform=systrap', '--network=host']);

    if (kvm) {
      expect(runtimes[GVISOR_RUNTIMES.kvm.runtime]).toEqual(['--platform=kvm']);
      expect(runtimes[GVISOR_RUNTIMES.kvm.sharedNetnsRuntime]).toEqual(['--platform=kvm', '--network=host']);
    }

    // Docker was only reloaded: the running stack container was not restarted by the refresh.
    const after = (
      await vm.execOrThrow(`docker inspect -f '{{.State.StartedAt}}' "$(cat /root/stand-in.id)"`, { sudo: true })
    ).trim();

    expect(after).toBe(before);
    expect(await vm.execOrThrow('test -x /opt/agent-manager/agenstra-gvisor.sh && echo ok', { sudo: true })).toContain(
      'ok',
    );
  });

  it('is idempotent and never fails the update', async () => {
    const output = await vm.execOrThrow(buildAgentManagerUpdateCommand(), { sudo: true, timeoutMs: 20 * 60_000 });

    expect(output).toContain('Update completed');
    expect(output).not.toContain('ERROR');
  });
});
