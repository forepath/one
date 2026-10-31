import { applyVmCommandOutcome, vmCommandOutcome } from './vm-command-outcome.utils';

const event = (labels: Record<string, string>, message = 'virtual machine shop/lw-vm/db1/0: reboot') => ({
  labels: { kind: 'virtual-machine', ...labels },
  message,
});

function store(rows: Record<string, unknown>[]) {
  const repo = {
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const statuses = (where['status'] as { _value?: string[]; value?: string[] })?._value ?? [];

      return rows.filter(
        (r) =>
          r['project'] === where['project'] &&
          r['name'] === where['name'] &&
          r['node'] === where['node'] &&
          r['type'] === where['type'] &&
          statuses.includes(r['status'] as string),
      );
    }),
    update: jest.fn(async (where: { id: string; status: string }, patch: Record<string, unknown>) => {
      const row = rows.find((r) => r['id'] === where.id && r['status'] === where.status);

      if (row) Object.assign(row, patch);

      return { affected: row ? 1 : 0 };
    }),
  };

  return { manager: { getRepository: () => repo } as never, repo };
}

describe('VM command outcomes (3.35)', () => {
  it('reads outcome events of power actions and re-images; ignores other events', () => {
    expect(vmCommandOutcome(event({ replica: 'shop/lw-vm/db1/0', action: 'reboot', result: 'done' }))).toEqual({
      type: 'vmPower',
      project: 'shop',
      name: 'db1',
      action: 'reboot',
      status: 'succeeded',
      error: null,
    });
    expect(
      vmCommandOutcome(
        event({ replica: 'shop/lw-vm/db1/0', result: 'failed' }, 'vmPower failed: vm-ctl destroy timed out'),
      ),
    ).toMatchObject({ type: 'vmPower', status: 'failed', error: 'vmPower failed: vm-ctl destroy timed out' });
    expect(
      vmCommandOutcome(event({ replica: 'shop/lw-vm/db1/0', import: 'i-1', result: 'running' }, 're-imaging …')),
    ).toMatchObject({ type: 'vmImageImport', import: 'i-1', status: 'running' });
    expect(vmCommandOutcome({ labels: { kind: 'backup' }, message: 'x' })).toBeNull();
    expect(vmCommandOutcome(event({ replica: 'shop/web/api/0', action: 'reboot', result: 'done' }))).toBeNull();
    expect(vmCommandOutcome(event({ replica: 'shop/lw-vm/db1/0', result: 'failed' }, 'something else'))).toBeNull();
  });

  it('prefers the explicit command fields of current agents, falling back to labels / prefix (F3b)', () => {
    const IMPORT = '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f';
    const failed = (
      vmCommand: { type: string; action?: string; importId?: string },
      message = 'reset refused: no launcher',
    ) => ({
      ...event({ replica: 'shop/lw-vm/db1/0', result: 'failed' }, message),
      vmCommand,
    });

    // A power failure with its action named — no message prefix needed.
    expect(vmCommandOutcome(failed({ type: 'vmPower', action: 'reset' }))).toEqual({
      type: 'vmPower',
      project: 'shop',
      name: 'db1',
      action: 'reset',
      status: 'failed',
      error: 'reset refused: no launcher',
    });
    // A re-image failure by its import id, even without the `import` label.
    expect(vmCommandOutcome(failed({ type: 'vmImageImport', importId: IMPORT }, 'disk busy'))).toMatchObject({
      type: 'vmImageImport',
      import: IMPORT,
      status: 'failed',
    });
    // The explicit type wins over contradicting labels.
    expect(
      vmCommandOutcome({
        ...event({ replica: 'shop/lw-vm/db1/0', action: 'reboot', result: 'done' }),
        vmCommand: { type: 'vmImageImport', importId: IMPORT },
      }),
    ).toMatchObject({ type: 'vmImageImport', import: IMPORT });
    // Lenient: unknown actions / malformed ids are dropped (the command still matches by type) ...
    expect(vmCommandOutcome(failed({ type: 'vmPower', action: 'poweroff' }))).not.toHaveProperty('action');
    expect(vmCommandOutcome(failed({ type: 'vmImageImport', importId: 'x' }))).not.toHaveProperty('import');
    // ... and an unknown type falls back to the labels / message prefix of older agents.
    expect(vmCommandOutcome(failed({ type: 'vmSomething' }, 'vmPower failed: boom'))).toMatchObject({
      type: 'vmPower',
      status: 'failed',
    });
    expect(vmCommandOutcome(failed({ type: 'vmSomething' }, 'boom'))).toBeNull();
    // Boot disk import events (no command) stay out of the command queue.
    expect(
      vmCommandOutcome(
        event(
          {
            replica: 'shop/lw-vm/db1/0',
            volume: 'shop/lw-vm/db1.root',
            operation: 'boot-disk-import',
            result: 'failed',
          },
          'boot disk import of shop/lw-vm/db1.root failed: digest mismatch',
        ),
      ),
    ).toBeNull();
    // Still no outcome without a VM replica / result.
    expect(vmCommandOutcome({ ...event({ result: 'done' }), vmCommand: { type: 'vmPower' } })).toBeNull();
  });

  it('folds outcomes into the oldest open command of the VM on that node', async () => {
    const rows: Record<string, unknown>[] = [
      {
        id: 'a',
        project: 'shop',
        name: 'db1',
        node: 'n1',
        type: 'vmPower',
        status: 'sent',
        payload: { action: 'reset' },
      },
      {
        id: 'b',
        project: 'shop',
        name: 'db1',
        node: 'n1',
        type: 'vmPower',
        status: 'sent',
        payload: { action: 'reboot' },
      },
      {
        id: 'c',
        project: 'shop',
        name: 'db1',
        node: 'n2',
        type: 'vmImageImport',
        status: 'sent',
        payload: { import: 'i-1' },
      },
    ];
    const { manager } = store(rows);
    const outcome = (labels: Record<string, string>, message?: string) =>
      vmCommandOutcome(event({ replica: 'shop/lw-vm/db1/0', ...labels }, message))!;

    expect(await applyVmCommandOutcome(manager, 'n1', outcome({ action: 'reboot', result: 'done' }))).toBe('b');
    expect(rows[1]).toMatchObject({ status: 'succeeded', error: null });
    expect(await applyVmCommandOutcome(manager, 'n1', outcome({ result: 'failed' }, 'vmPower failed: boom'))).toBe('a');
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'vmPower failed: boom' });

    // Re-images by import id, from the node that holds the disk: running, then done.
    expect(await applyVmCommandOutcome(manager, 'n1', outcome({ import: 'i-1', result: 'running' }))).toBeNull();
    expect(await applyVmCommandOutcome(manager, 'n2', outcome({ import: 'i-1', result: 'running' }))).toBe('c');
    expect(rows[2]['status']).toBe('running');
    expect(await applyVmCommandOutcome(manager, 'n2', outcome({ import: 'i-1', result: 'done' }))).toBe('c');
    expect(rows[2]['status']).toBe('succeeded');
    // A late `running` never reopens a finished command.
    expect(await applyVmCommandOutcome(manager, 'n2', outcome({ import: 'i-1', result: 'running' }))).toBeNull();
    expect(rows[2]['status']).toBe('succeeded');
  });

  it('applies an explicit power failure to the command with that action, not just the oldest one', async () => {
    const rows: Record<string, unknown>[] = ['reset', 'reboot'].map((action, i) => ({
      id: `p${i}`,
      project: 'shop',
      name: 'db1',
      node: 'n1',
      type: 'vmPower',
      status: 'sent',
      payload: { action },
    }));
    const { manager } = store(rows);
    const outcome = vmCommandOutcome({
      ...event({ replica: 'shop/lw-vm/db1/0', action: 'reboot', result: 'failed' }, 'vmPower failed: boom'),
      vmCommand: { type: 'vmPower', action: 'reboot' },
    });

    if (!outcome) throw new Error('no outcome');

    expect(await applyVmCommandOutcome(manager, 'n1', outcome)).toBe('p1');
    expect(rows.map((r) => r['status'])).toEqual(['sent', 'failed']);
  });
});
