import { bearerExpiresAt, ExecGateway, LIVE_EXEC_SCOPE } from './exec.gateway';

type Handler = (type: string, payload: Record<string, unknown>) => void;

describe('ExecGateway (machine exec, 3.19)', () => {
  const env = process.env['AUTHENTICATION_METHOD'];

  afterEach(() => {
    process.env['AUTHENTICATION_METHOD'] = env;
  });

  const setup = (
    options: { features?: string[]; accessError?: Error; guardUser?: Record<string, unknown>; revoked?: boolean } = {},
  ) => {
    const handlers = new Map<string, Handler>();
    const sent: { node: string; channel: string; type: string; payload: Record<string, unknown> }[] = [];
    const audits: Record<string, unknown>[] = [];
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
      replica: jest.fn(async (_req: unknown, replica: string) => {
        if (options.accessError) throw options.accessError;

        return { node: 'n1', project: 'agenstra-ws', target: `replica/${replica}`, caller: {} };
      }),
    };
    const dataSource = { query: jest.fn(async () => [{ protocol_features: options.features ?? ['exec-stdio'] }]) };
    const audit = { recordStandalone: jest.fn(async (entry: Record<string, unknown>) => void audits.push(entry)) };
    const guard = {
      canActivate: jest.fn(async (ctx: { switchToHttp(): { getRequest(): { user?: unknown } } }) => {
        if (options.guardUser) ctx.switchToHttp().getRequest().user = options.guardUser;

        return true;
      }),
    };
    const socketAuth = {
      validateAndGetUser: jest.fn(async (header?: string) =>
        header === 'Bearer static'
          ? { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } }
          : header === 'Bearer t' && !options.revoked
            ? { isApiKeyAuth: false, user: { id: 'u1', amr: ['pat'], scopes: [LIVE_EXEC_SCOPE] } }
            : null,
      ),
    };
    const gateway = new ExecGateway(
      dataSource as never,
      socketAuth as never,
      live as never,
      liveAccess as never,
      audit as never,
      { get: () => guard } as never,
    );
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const socket = {
      id: 's1',
      data: { req: { user: { id: 'u1', amr: ['pat'], scopes: [LIVE_EXEC_SCOPE] } }, header: 'Bearer t' },
      emit: (event: string, payload: Record<string, unknown>) => void emitted.push({ event, payload }),
      disconnect: jest.fn(),
      conn: { writeBuffer: [] },
    };

    return { gateway, socket, emitted, sent, handlers, audits, liveAccess, guard, socketAuth, options };
  };

  it('accepts PATs only with the live:exec scope; other credentials as on the other namespaces', async () => {
    process.env['AUTHENTICATION_METHOD'] = 'users';

    const withScope = setup({ guardUser: { id: 'u1', amr: ['pat'], scopes: ['plans:create', LIVE_EXEC_SCOPE] } });

    expect(await withScope.gateway.authenticate('Bearer t')).toMatchObject({ user: { id: 'u1' } });

    const without = setup({ guardUser: { id: 'u1', amr: ['pat'], scopes: ['plans:create'] } });

    expect(await without.gateway.authenticate('Bearer t')).toBeNull();

    const session = setup({ guardUser: { id: 'u2', amr: ['pwd'] } });

    expect(await session.gateway.authenticate('Bearer t')).toMatchObject({ user: { id: 'u2' } });
    expect(await setup().gateway.authenticate(undefined)).toBeNull();

    process.env['AUTHENTICATION_METHOD'] = 'api-key';

    const apiKey = setup();

    expect(await apiKey.gateway.authenticate('Bearer static')).toMatchObject({ apiKeyAuthenticated: true });
    expect(apiKey.guard.canActivate).not.toHaveBeenCalled();
  });

  it('runs a command: no TTY, binary stdin / stdout / stderr, exit code, audited', async () => {
    const { gateway, socket, emitted, sent, handlers, audits } = setup();

    await gateway.exec(
      { execId: 'e1', replica: 'agenstra-ws/env-1/worker/0', command: ['/bin/cat', 'secret-arg'], user: '1000' },
      socket as never,
    );

    expect(sent[0]).toMatchObject({
      node: 'n1',
      type: 'execOpen',
      payload: { tty: false, user: '1000', command: ['/bin/cat', 'secret-arg'] },
    });
    expect(emitted).toContainEqual({ event: 'started', payload: { execId: 'e1' } });

    const data = Buffer.from([0, 255, 10]);

    await gateway.stdin({ execId: 'e1', data, eof: true }, socket as never);
    expect(sent[1]).toMatchObject({ type: 'execInput', payload: { data: data.toString('base64'), eof: true } });

    const handler = handlers.get(sent[0].channel) as Handler;

    handler('execOutput', { data: data.toString('base64') });
    handler('execOutput', { data: Buffer.from('oops').toString('base64'), stream: 'stderr' });
    handler('execExit', { code: 3 });
    await new Promise((r) => setImmediate(r));

    expect(emitted).toContainEqual({ event: 'stdout', payload: { execId: 'e1', data } });
    expect(emitted).toContainEqual({ event: 'stderr', payload: { execId: 'e1', data: Buffer.from('oops') } });
    expect(emitted).toContainEqual({ event: 'exit', payload: { execId: 'e1', exitCode: 3 } });
    expect(audits[0]).toMatchObject({
      action: 'exec.run',
      target: 'replica/agenstra-ws/env-1/worker/0',
      details: { node: 'n1', command: 'cat', exitCode: 3, stdin: 3, stdout: 3, stderr: 4 },
    });
    // Arguments may carry secrets: only the program is audited.
    expect(JSON.stringify(audits)).not.toContain('secret-arg');
  });

  it('refuses without operator access, on nodes without machine exec and beyond the start rate', async () => {
    const denied = setup({ accessError: new Error('operator role required') });

    await denied.gateway.exec({ execId: 'e1', replica: 'p/d/s/0', command: ['ls'] }, denied.socket as never);
    expect(denied.emitted).toContainEqual({
      event: 'error',
      payload: { execId: 'e1', message: 'operator role required' },
    });
    expect(denied.liveAccess.replica).toHaveBeenCalledWith(expect.anything(), 'p/d/s/0', 'machine-exec');

    const old = setup({ features: [] });

    await old.gateway.exec({ execId: 'e1', replica: 'p/d/s/0', command: ['ls'] }, old.socket as never);
    expect(old.emitted[0].payload['message']).toContain('does not support machine exec');

    const busy = setup();

    for (let i = 0; i < 300; i++) {
      await busy.gateway.exec({ execId: `e${i}`, replica: 'p/d/s/0', command: ['ls'] }, busy.socket as never);
      busy.handlers.get(`ch${busy.handlers.size}`)?.('execExit', { code: 0 });
    }

    expect(busy.emitted.filter((e) => e.event === 'error').map((e) => e.payload['message'])).toContain(
      'rate limit exceeded',
    );
  });

  it('refuses invalid payloads', async () => {
    const { gateway, socket, emitted } = setup();

    await gateway.exec({ execId: 'e1', replica: '../x', command: ['ls'] }, socket as never);
    await gateway.stdin({ execId: 'nope', data: Buffer.from('x') }, socket as never);
    expect(emitted.map((e) => e.payload['message'])).toEqual(['invalid payload', 'unknown session']);
  });

  it('re-validates the token before every exec and every minute, disconnecting on failure (M6 review M4)', async () => {
    const t = setup();

    await t.gateway.exec({ execId: 'e1', replica: 'p/d/s/0', command: ['ls'] }, t.socket as never);
    expect(t.emitted).toContainEqual({ event: 'started', payload: { execId: 'e1' } });
    expect(t.socketAuth.validateAndGetUser).toHaveBeenCalledWith('Bearer t');

    // The PAT is revoked while the socket stays open: the minute check ends the session and the socket.
    t.options.revoked = true;
    await (t.gateway as unknown as { check(): Promise<void> }).check();
    expect(t.sent.at(-1)).toMatchObject({ type: 'execClose' });
    expect(t.emitted).toContainEqual({ event: 'error', payload: { message: 'credentials no longer valid' } });
    expect(t.socket.disconnect).toHaveBeenCalledWith(true);

    // A new exec on the (still referenced) socket is refused before anything reaches a node.
    const before = t.sent.length;

    await t.gateway.exec({ execId: 'e2', replica: 'p/d/s/0', command: ['ls'] }, t.socket as never);
    expect(t.sent).toHaveLength(before);
    expect(t.emitted).not.toContainEqual({ event: 'started', payload: { execId: 'e2' } });
    t.handlers.get('ch1')?.('execExit', { code: null });
    await new Promise((r) => setImmediate(r));
    expect(t.emitted).toContainEqual({ event: 'exit', payload: { execId: 'e1', exitCode: null } });
  });

  it('refuses an expired JWT without asking the guards and reads exp from JWT bearer tokens only', async () => {
    const jwt = (exp: number) =>
      `Bearer x.${Buffer.from(JSON.stringify({ sub: 'u1', exp })).toString('base64url')}.sig`;
    const t = setup();

    expect(bearerExpiresAt(jwt(1_900_000_000))).toBe(1_900_000_000_000);
    expect(bearerExpiresAt('Bearer static')).toBeNull();
    expect(bearerExpiresAt('Bearer a.!!!.c')).toBeNull();

    t.socket.data.header = jwt(Math.floor(Date.now() / 1000) - 10);
    await t.gateway.exec({ execId: 'e1', replica: 'p/d/s/0', command: ['ls'] }, t.socket as never);
    expect(t.sent).toHaveLength(0);
    expect(t.socketAuth.validateAndGetUser).not.toHaveBeenCalled();
    expect(t.socket.disconnect).toHaveBeenCalledWith(true);
  });
});
