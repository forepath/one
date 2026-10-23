import { parseDomainState, VM_CTL_PATH, vmDiskPrefix, VmPower, vmReplicaOfVolume } from './vm-power';

describe('VM power (M7.3)', () => {
  it('normalizes virsh domstate', () => {
    expect(parseDomainState('running\n\n')).toBe('running');
    expect(parseDomainState('idle')).toBe('running');
    expect(parseDomainState('in shutdown')).toBe('shutting-down');
    expect(parseDomainState('shut off')).toBe('shut-off');
    expect(parseDomainState('paused')).toBe('paused');
    expect(parseDomainState('crashed')).toBe('crashed');
    expect(parseDomainState('pmsuspended')).toBe('suspended');
    expect(parseDomainState('')).toBe('unknown');
  });

  it('maps VM disk volumes to their replica and back', () => {
    expect(vmReplicaOfVolume('shop/lw-vm/db1.root')).toBe('shop/lw-vm/db1/0');
    expect(vmReplicaOfVolume('shop/store/data')).toBeNull();
    expect(vmDiskPrefix('shop/lw-vm/db1/0')).toBe('shop/lw-vm/db1.');
    expect(vmDiskPrefix('shop/store/web/0')).toBeNull();
  });

  function setup(exitCodes: Record<string, number | null> = {}) {
    const docker = {
      listContainers: jest.fn(async () => [
        { Id: 'c-db1', Labels: { 'loadweaver.com/workload': 'shop/lw-vm/db1/0', 'loadweaver.com/vm': 'db1' } },
      ]),
    };
    const jobs = {
      exec: jest.fn(async (_id: string, command: string[]) => {
        const code = command[1] in exitCodes ? exitCodes[command[1]] : 0;

        return {
          exitCode: code,
          stdout: command[1] === 'state' ? 'running\n' : '',
          stderr: '',
          combined: code ? 'error: Guest agent is not responding' : '',
        };
      }),
    };

    return { power: new VmPower(docker as never, jobs as never), docker, jobs };
  }

  it('runs vmPower actions through vm-ctl in the running launcher only', async () => {
    const { power, docker, jobs } = setup();

    await power.power({ replica: 'shop/lw-vm/db1/0', action: 'reboot' });

    expect(docker.listContainers).toHaveBeenCalledWith({
      filters: {
        label: ['loadweaver.com/managed=true', 'loadweaver.com/vm', 'loadweaver.com/workload=shop/lw-vm/db1/0'],
        status: ['running'],
      },
    });
    expect(jobs.exec).toHaveBeenCalledWith('c-db1', [VM_CTL_PATH, 'reboot'], 30_000);
    expect(VM_CTL_PATH).toBe('/usr/lib/agenstra-microvm/vm-ctl');

    docker.listContainers.mockResolvedValueOnce([]);
    await expect(power.power({ replica: 'shop/lw-vm/db1/0', action: 'reset' })).rejects.toThrow(
      "doesn't run on this node",
    );
  });

  it('reports failures, the power state and a frozen file system only with a responding guest agent', async () => {
    const failing = setup({ shutdown: 1, fsfreeze: 1, state: null });

    await expect(failing.power.power({ replica: 'shop/lw-vm/db1/0', action: 'shutdown' })).rejects.toThrow(
      'vm-ctl shutdown failed (exit 1)',
    );
    expect(await failing.power.freeze('c-db1')).toBe(false);
    expect(await failing.power.state('c-db1')).toBe('unknown');

    const healthy = setup();

    expect(await healthy.power.freeze('c-db1')).toBe(true);
    expect(await healthy.power.state('c-db1')).toBe('running');
    await healthy.power.thaw('c-db1');
    expect(healthy.jobs.exec).toHaveBeenLastCalledWith('c-db1', [VM_CTL_PATH, 'fsthaw'], 60_000);
  });

  it('destroys (force-off) through vm-ctl, and treats a VM that no longer runs here as off', async () => {
    const { power, docker, jobs } = setup();

    await power.power({ replica: 'shop/lw-vm/db1/0', action: 'destroy' });
    expect(jobs.exec).toHaveBeenCalledWith('c-db1', [VM_CTL_PATH, 'destroy'], 30_000);

    jobs.exec.mockClear();
    docker.listContainers.mockResolvedValueOnce([]);
    await power.power({ replica: 'shop/lw-vm/db1/0', action: 'destroy' });
    expect(jobs.exec).not.toHaveBeenCalled();
  });
});
