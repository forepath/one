import { ConsolesGateway, VM_CONSOLES_FEATURE } from './consoles.gateway';

type Handler = (type: string, payload: Record<string, unknown>) => void;

describe('ConsolesGateway (VM consoles, 3.35)', () => {
  const setup = (options: { features?: string[]; accessError?: Error; recorded?: boolean } = {}) => {
    const handlers = new Map<string, Handler>();
    const sent: { node: string; channel: string; type: string; payload: Record<string, unknown> }[] = [];
    const audits: Record<string, unknown>[] = [];
    const queries: { sql: string; params: unknown[] }[] = [];
    const stored: { key: string; data: Buffer }[] = [];
    const live = {
      openChannel: (handler: Handler) => {
        const channel = `ch${handlers.size + 1}`;

        handlers.set(channel, handler);

        return channel;
      },
      closeChannel: jest.fn(),
      send: async (node: string, channel: string, type: string, payload: Record<string, unknown>) =>
        void sent.push({ node, channel, type, payload }),
    };
    const liveAccess = {
      console: jest.fn(async (_req: unknown, replica: string) => {
        if (options.accessError) throw options.accessError;

        return { node: 'n1', project: 'shop', target: `replica/${replica}`, caller: {} };
      }),
      recorded: jest.fn(async () => options.recorded ?? false),
    };
    const manager = {
      query: async (sql: string, params: unknown[]) => (queries.push({ sql, params }), [{ id: 'sess-1' }]),
    };
    const dataSource = {
      query: jest.fn(async () => [{ protocol_features: options.features ?? [VM_CONSOLES_FEATURE] }]),
      transaction: async (work: (m: typeof manager) => Promise<unknown>) => await work(manager),
    };
    const audit = { record: jest.fn(async (_m: unknown, entry: Record<string, unknown>) => void audits.push(entry)) };
    const files = { writeFile: async (_scope: unknown, key: string, data: Buffer) => void stored.push({ key, data }) };
    const gateway = new ConsolesGateway(
      dataSource as never,
      {} as never,
      live as never,
      liveAccess as never,
      audit as never,
      files as never,
    );
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const socket = {
      id: 's1',
      data: { userInfo: { isApiKeyAuth: false, user: { id: 'u1', roles: ['user'] } } },
      emit: (event: string, payload: Record<string, unknown>) => void emitted.push({ event, payload }),
      conn: { writeBuffer: [] as unknown[] },
    };
    const settle = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    };

    return { gateway, socket, emitted, sent, handlers, audits, queries, stored, liveAccess, settle };
  };

  it('opens a serial console: consoleOpen to the node, text both ways, recorded and audited like terminals', async () => {
    const t = setup({ recorded: true });

    await t.gateway.open({ sessionId: 'c1', replica: 'shop/lw-vm/db1/0', kind: 'serial' }, t.socket as never);
    expect(t.liveAccess.console).toHaveBeenCalledWith(expect.anything(), 'shop/lw-vm/db1/0', 'serial');
    expect(t.sent[0]).toEqual({
      node: 'n1',
      channel: 'ch1',
      type: 'consoleOpen',
      payload: { target: { kind: 'replica', replica: 'shop/lw-vm/db1/0' }, kind: 'serial', cols: 80, rows: 24 },
    });
    expect(t.emitted).toContainEqual({
      event: 'consoleOpened',
      payload: { sessionId: 'c1', kind: 'serial', recorded: true },
    });
    expect(t.queries[0].params).toEqual(['u1', 'shop', 'virtual-machine/shop/db1/console/serial', 'n1', true]);
    expect(t.audits[0]).toMatchObject({
      action: 'vm.console.open',
      target: 'virtual-machine/shop/db1',
      project: 'shop',
      details: { kind: 'serial', replica: 'shop/lw-vm/db1/0', node: 'n1', recorded: true, session: 'sess-1' },
    });

    await t.gateway.input({ sessionId: 'c1', data: 'root\r' }, t.socket as never);
    await t.settle();
    expect(t.sent[1]).toMatchObject({ type: 'execInput', payload: { data: Buffer.from('root\r').toString('base64') } });
    // Binary is VNC's: refused on a serial console.
    await t.gateway.input({ sessionId: 'c1', data: new Uint8Array([1]) }, t.socket as never);
    expect(t.emitted.at(-1)).toEqual({ event: 'error', payload: { sessionId: 'c1', message: 'invalid payload' } });

    const handler = t.handlers.get('ch1') as Handler;

    handler('execOutput', { data: Buffer.from('login: ').toString('base64') });
    handler('execOutput', { data: Buffer.from('ignored').toString('base64'), stream: 'stderr' });
    expect(t.emitted.filter((e) => e.event === 'consoleOutput')).toEqual([
      { event: 'consoleOutput', payload: { sessionId: 'c1', data: 'login: ' } },
    ]);

    await t.gateway.closeConsole({ sessionId: 'c1' }, t.socket as never);
    await t.settle();
    expect(t.sent.at(-1)).toMatchObject({ type: 'execClose' });
    handler('execExit', { code: null });
    await t.settle();
    expect(t.emitted).toContainEqual({ event: 'consoleClosed', payload: { sessionId: 'c1', exitCode: null } });
    expect(t.stored[0].key).toMatch(/\/sess-1\.cast$/);
    expect(t.stored[0].data.toString()).toContain('login: ');
    expect(t.audits.at(-1)).toMatchObject({
      action: 'vm.console.close',
      target: 'virtual-machine/shop/db1',
      details: { kind: 'serial', session: 'sess-1', bytesIn: 5, bytesOut: 7 },
    });
  });

  it('relays VNC as binary both ways, never recorded beyond metadata', async () => {
    const t = setup({ recorded: true });

    await t.gateway.open({ sessionId: 'v1', replica: 'shop/lw-vm/db1/0', kind: 'vnc' }, t.socket as never);
    expect(t.sent[0].payload).toEqual({ target: { kind: 'replica', replica: 'shop/lw-vm/db1/0' }, kind: 'vnc' });
    expect(t.emitted).toContainEqual({
      event: 'consoleOpened',
      payload: { sessionId: 'v1', kind: 'vnc', recorded: false },
    });
    expect(t.liveAccess.recorded).not.toHaveBeenCalled();

    const rfb = new Uint8Array([0x03, 0x00, 0xff]);

    await t.gateway.input({ sessionId: 'v1', data: rfb }, t.socket as never);
    await t.gateway.input({ sessionId: 'v1', data: 'text' }, t.socket as never);
    await t.settle();
    expect(t.sent[1]).toMatchObject({ type: 'execInput', payload: { data: Buffer.from(rfb).toString('base64') } });
    expect(t.emitted.at(-1)).toEqual({ event: 'error', payload: { sessionId: 'v1', message: 'invalid payload' } });

    const server = Buffer.from('RFB 003.008\n');

    (t.handlers.get('ch1') as Handler)('execOutput', { data: server.toString('base64') });
    expect(t.emitted).toContainEqual({ event: 'consoleOutput', payload: { sessionId: 'v1', data: server } });
    (t.handlers.get('ch1') as Handler)('execExit', { code: 0 });
    await t.settle();
    expect(t.stored).toEqual([]);
    expect(t.audits.at(-1)).toMatchObject({ action: 'vm.console.close', details: { kind: 'vnc', bytesOut: 12 } });
  });

  it('refuses without access, on nodes without vm-consoles, invalid replicas and beyond the limits', async () => {
    const denied = setup({ accessError: new Error('exec not allowed') });

    await denied.gateway.open({ replica: 'shop/lw-vm/db1/0', kind: 'serial' }, denied.socket as never);
    expect(denied.emitted.at(-1)?.payload['message']).toBe('exec not allowed');
    expect(denied.sent).toEqual([]);

    const old = setup({ features: ['exec-stdio'] });

    await old.gateway.open({ replica: 'shop/lw-vm/db1/0', kind: 'serial' }, old.socket as never);
    expect(old.emitted.at(-1)?.payload['message']).toContain('does not support VM consoles');
    expect(old.sent).toEqual([]);

    const invalid = setup();

    await invalid.gateway.open({ replica: 'shop/site/web/0', kind: 'serial' }, invalid.socket as never);
    await invalid.gateway.open({ replica: 'shop/lw-vm/db1/0', kind: 'spice' }, invalid.socket as never);
    await invalid.gateway.input({ sessionId: 'nope', data: 'x' }, invalid.socket as never);
    expect(invalid.emitted.map((e) => e.payload['message'])).toEqual([
      'invalid payload',
      'invalid payload',
      'unknown session',
    ]);

    const busy = setup();

    for (let i = 0; i < 6; i++)
      await busy.gateway.open(
        { sessionId: `b${i}`, replica: 'shop/lw-vm/db1/0', kind: 'serial' },
        busy.socket as never,
      );

    expect(busy.emitted.filter((e) => e.event === 'consoleOpened')).toHaveLength(4);
    expect(busy.emitted.filter((e) => e.event === 'error').map((e) => e.payload['message'])).toEqual([
      'too many consoles',
      'too many consoles',
    ]);
  });

  it('limits serial input like terminals and closes on disconnect', async () => {
    const t = setup();

    await t.gateway.open({ sessionId: 'r1', replica: 'shop/lw-vm/db1/0', kind: 'serial' }, t.socket as never);

    for (let i = 0; i < 17; i++)
      await t.gateway.input({ sessionId: 'r1', data: 'x'.repeat(64 * 1024) }, t.socket as never);

    expect(t.emitted.at(-1)).toEqual({
      event: 'error',
      payload: { sessionId: 'r1', message: 'input rate limit exceeded' },
    });

    t.gateway.handleDisconnect(t.socket as never);
    await t.settle();
    expect(t.sent.at(-1)).toMatchObject({ type: 'execClose' });
    (t.handlers.get('ch1') as Handler)('execExit', { code: null });
    await t.settle();
    expect(t.emitted.at(-1)).toEqual({ event: 'consoleClosed', payload: { sessionId: 'r1', exitCode: null } });
  });
});
