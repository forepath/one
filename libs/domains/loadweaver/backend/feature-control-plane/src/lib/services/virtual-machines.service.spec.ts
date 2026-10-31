import { virtualMachineSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { VirtualMachinesService } from './virtual-machines.service';

const SPEC = {
  image: 'registry.lw/shop/debian:13',
  cpu: { vcpus: 2 },
  memory: '4Gi',
  disks: [{ name: 'root', size: '20Gi', source: 'image' }],
  nics: [{ name: 'eth0' }],
};

function setup(options: { role?: string; developerExec?: boolean; runStrategy?: string; state?: string } = {}) {
  const commands: Record<string, unknown>[] = [];
  const audit = { record: jest.fn(async () => undefined) };
  const node = { name: 'n1', connected: true, protocolFeatures: ['virtual-machines', 'vm-consoles'] };
  const repos: Record<string, unknown> = {
    NodeEntity: { findOne: async () => node },
    VmCommandEntity: {
      create: (v: Record<string, unknown>) => v,
      save: async (v: Record<string, unknown>) => {
        const row = { id: `c${commands.length + 1}`, createdAt: new Date('2026-10-23T10:00:00Z'), ...v };

        commands.push(row);

        return row;
      },
      find: async ({ where }: { where: { status?: string } }) =>
        commands.filter((c) => !where?.status || c['status'] === where.status),
      findOne: async ({ where }: { where: { type?: string } }) =>
        [...commands].reverse().find((c) => !where?.type || c['type'] === where.type) ?? null,
      update: jest.fn(async (where: { id?: string; status?: string }, patch: Record<string, unknown>) => {
        let affected = 0;

        for (const c of commands)
          if ((!where.id || c['id'] === where.id) && (!where.status || c['status'] === where.status)) {
            if (where.id) Object.assign(c, patch);
            affected++;
          }

        return { affected: where.id ? affected : 0 };
      }),
    },
  };
  repos['WorkloadPlacementEntity'] = { update: jest.fn(async () => ({ affected: 1 })) };
  repos['VmPowerEntity'] = {
    findOne: async () => null,
    create: (v: Record<string, unknown>) => v,
    save: jest.fn(async (v: Record<string, unknown>) => v),
  };
  const manager = { getRepository: (entity: { name: string }) => repos[entity.name], query: jest.fn(async () => []) };
  const dataSource = {
    manager,
    getRepository: (entity: { name: string }) => repos[entity.name],
    transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager),
  };
  const role = options.role ?? 'operator';
  const access = {
    caller: async () => ({ isApiKey: false, userId: 'u1', projects: new Map(role ? [['shop', role]] : []) }),
    settings: async () => ({ developerExec: options.developerExec ?? false }),
  };
  const session = { protocol: { version: 2, features: new Set(['virtual-machines']) }, send: jest.fn() };
  const registry = { get: (name: string) => (name === 'n1' ? session : undefined) };
  const network = { requestRecompile: jest.fn() };
  const svc = new VirtualMachinesService(
    dataSource as never,
    access as never,
    audit as never,
    {} as never,
    network as never,
    registry as never,
    {} as never,
  );
  const spec = virtualMachineSpecSchema.parse({ ...SPEC, runStrategy: options.runStrategy ?? 'Always' });
  const ctx = {
    row: { project: 'shop', name: 'db1', labels: {}, spec, generation: 1, updatedAt: new Date() },
    spec,
    placement: {
      id: 'shop/lw-vm/db1/0',
      node: 'n1',
      addresses: ['10.20.1.5'],
      targetNode: null,
      migration: null,
      drainUntil: null,
      status: options.state === undefined ? { n1: { state: 'running', at: '2026-10-23T09:00:00.000Z' } } : null,
    },
    volumes: [],
    power: null,
    pinnedImage: null,
    guestAgent: undefined,
  };

  jest.spyOn(svc as never, 'contexts').mockImplementation((async () => [ctx]) as never);

  return { svc, commands, audit, session, network, ctx };
}

describe('VirtualMachinesService (3.35)', () => {
  it('shows status, NICs, consoles and the actions the caller may take', async () => {
    const vm = await setup().svc.get(undefined, 'shop', 'db1');

    expect(vm).toMatchObject({
      phase: 'Running',
      node: 'n1',
      power: 'running',
      actions: ['reboot', 'reset'],
      permissions: { power: true, snapshot: true, console: true, edit: true },
      consoles: { replica: 'shop/lw-vm/db1/0', serial: { available: true }, vnc: { available: true } },
    });
    expect(vm.nicStatus[0]).toMatchObject({ name: 'eth0', addresses: ['10.20.1.5'] });

    const developer = await setup({ role: 'developer' }).svc.get(undefined, 'shop', 'db1');

    expect(developer.actions).toEqual([]);
    expect(developer.consoles.serial.available).toBe(false);
    await expect(setup({ role: '' }).svc.get(undefined, 'shop', 'db1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends reboot as vmPower to the node, audited, once', async () => {
    const { svc, commands, audit, session } = setup();

    await svc.act(undefined, 'shop', 'db1', 'reboot');

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'vmPower',
        action: 'reboot',
        node: 'n1',
        payload: { replica: 'shop/lw-vm/db1/0', action: 'reboot' },
      }),
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'vm.reboot', target: 'virtual-machine/shop/db1' }),
    );
    await svc.dispatch();
    await svc.dispatch();
    expect(session.send).toHaveBeenCalledTimes(1);
    expect(session.send.mock.calls[0][0]).toMatchObject({ type: 'vmPower' });
    expect(commands[0]).toMatchObject({ status: 'sent' });
  });

  it('force-off destroys the domain on the node (vmPower destroy) and drains the replica', async () => {
    const { svc, commands, audit, session, network } = setup({ runStrategy: 'Manual' });

    await svc.act(undefined, 'shop', 'db1', 'force-off');

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'vmPower',
        action: 'destroy',
        node: 'n1',
        payload: { replica: 'shop/lw-vm/db1/0', action: 'destroy' },
      }),
    ]);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'vm.force-off' }));
    expect(network.requestRecompile).toHaveBeenCalledWith('vm shop/db1 stopped');
    await svc.dispatch();
    expect(session.send.mock.calls[0][0]).toMatchObject({ type: 'vmPower' });
    expect(JSON.parse(Buffer.from(session.send.mock.calls[0][0].payload).toString('utf8'))).toEqual({
      replica: 'shop/lw-vm/db1/0',
      action: 'destroy',
    });
  });

  it('force-off right after a shutdown reaches the node although the replica is already gone (G5)', async () => {
    const { svc, commands, ctx } = setup({ runStrategy: 'Manual' });

    await svc.act(undefined, 'shop', 'db1', 'shutdown');
    // The shutdown set the desired power and dropped the replica at once; the node runs out the grace on its own.
    (ctx as { placement: unknown }).placement = null;
    (ctx as { power: unknown }).power = { desired: 'stopped', graceful: true, changedAt: new Date() };
    commands[0]['createdAt'] = new Date();

    expect((await svc.get(undefined, 'shop', 'db1')).actions).toContain('force-off');
    await svc.act(undefined, 'shop', 'db1', 'force-off');
    expect(commands.map((c) => [c['action'], c['node']])).toEqual([
      ['shutdown', 'n1'],
      ['destroy', 'n1'],
    ]);

    // Long after the stop it's an ordinary stopped VM.
    (ctx as { power: unknown }).power = {
      desired: 'stopped',
      graceful: true,
      changedAt: new Date(Date.now() - 600_000),
    };
    await expect(svc.act(undefined, 'shop', 'db1', 'force-off')).rejects.toThrow('already stopped');
  });

  it("refuses a re-image while the stopped VM's launcher still runs out its grace on the node (G5)", async () => {
    const { svc, commands, ctx } = setup({ runStrategy: 'Halted' });

    // The guest is off, the replica still exists (drained after the launcher's stop grace).
    ctx.placement.status = {
      n1: { state: 'running', at: '2026-10-23T09:00:00.000Z', vm: { power: 'shut-off' } },
    } as never;

    await expect(svc.act(undefined, 'shop', 'db1', 'reimage')).rejects.toThrow(
      'the virtual machine is still being stopped on n1; re-image it once its replica is removed',
    );
    expect(commands).toHaveLength(0);
    expect((await svc.get(undefined, 'shop', 'db1')).actions).not.toContain('reimage');
  });

  it('refuses power changes managed by the spec, and roles without exec', async () => {
    await expect(setup().svc.act(undefined, 'shop', 'db1', 'stop')).rejects.toThrow(ConflictException);
    await expect(setup({ role: 'viewer' }).svc.act(undefined, 'shop', 'db1', 'reboot')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      setup({ role: 'developer', developerExec: true }).svc.act(undefined, 'shop', 'db1', 'reset'),
    ).resolves.toMatchObject({ name: 'db1' });
    await expect(
      setup({ role: 'developer', developerExec: true }).svc.act(undefined, 'shop', 'db1', 'reimage'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
