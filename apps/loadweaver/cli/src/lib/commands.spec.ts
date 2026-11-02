import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { Server as SocketServer } from 'socket.io';

import { ask, login, portForward } from './commands';
import { writePrivateFile } from './config';

/** A terminal whose input answers each prompt once it appears on the output. */
function terminal(answers: Record<string, string>): { input: PassThrough; output: PassThrough; shown: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  const pending = { ...answers };

  output.on('data', (chunk: Buffer) => {
    shown += chunk.toString();

    for (const [prompt, answer] of Object.entries(pending))
      if (shown.endsWith(prompt)) {
        delete pending[prompt];
        setImmediate(() => input.write(`${answer}\r`));
      }
  });

  return { input, output, shown: () => shown };
}

async function freePort(): Promise<number> {
  const server = createHttpServer();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  await new Promise((resolve) => server.close(resolve));

  return port;
}

describe('cli commands', () => {
  let dir: string;
  let api: HttpServer;
  let url: string;
  const logins: Record<string, unknown>[] = [];
  const env = { ...process.env };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-cli-cmd-'));
    api = createHttpServer((req, res) => {
      let body = '';

      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');

        if (req.url === '/api/auth/login') {
          const login = JSON.parse(body) as { password: string; code?: string };

          logins.push(login);
          res.statusCode = login.password === 'secret' && login.code === '123456' ? 201 : 401;
          res.end(
            JSON.stringify(
              res.statusCode === 201
                ? { access_token: 'session-1' }
                : // The identity backend's shape (auth.service.ts throwLogin2faRequired).
                  { message: 'Two-factor authentication required', code: 'LOGIN_2FA_REQUIRED', method: 'totp' },
            ),
          );
        } else if (req.url === '/api/overview' && /^Bearer (session-1|tok-\d)$/.test(req.headers.authorization ?? ''))
          res.end('{}');
        else {
          res.statusCode = 403;
          res.end(JSON.stringify({ message: 'Forbidden' }));
        }
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    api.close();
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  });

  describe('ask', () => {
    it('shows the prompt of a hidden question but not the answer', async () => {
      const t = terminal({ 'Password: ': 'secret' });

      await expect(ask('Password: ', true, t.input, t.output)).resolves.toBe('secret');
      expect(t.shown()).toContain('Password: ');
      expect(t.shown()).not.toContain('secret');
    });
  });

  describe('login', () => {
    const configOf = async (xdg: string) => JSON.parse(await readFile(join(xdg, 'loadweaver', 'cli.json'), 'utf8'));

    it('reads the token from stdin with --token -', async () => {
      const xdg = join(dir, 'stdin');
      const out: string[] = [];

      await login(
        { url, token: '-' },
        (l) => out.push(l),
        { input: Readable.from(['tok-1\n']), output: new PassThrough() },
        {
          XDG_CONFIG_HOME: xdg,
        },
      );
      expect(await configOf(xdg)).toEqual({ url, token: 'tok-1' });
      expect(out).toEqual([`Logged in to ${url}`]);
    });

    it('takes LOADWEAVER_TOKEN when neither --token nor --email is given', async () => {
      const xdg = join(dir, 'env');

      await login(
        { url },
        () => undefined,
        { input: new PassThrough(), output: new PassThrough() },
        {
          XDG_CONFIG_HOME: xdg,
          LOADWEAVER_TOKEN: 'tok-2',
        },
      );
      expect(await configOf(xdg)).toEqual({ url, token: 'tok-2' });
    });

    it('asks for the second factor when the control plane answers LOGIN_2FA_REQUIRED', async () => {
      const xdg = join(dir, '2fa');
      const t = terminal({ 'Password: ': 'secret', 'Second-factor code: ': '123456' });

      logins.length = 0;
      await login({ url, email: 'alice@example.com' }, () => undefined, t, { XDG_CONFIG_HOME: xdg });
      expect(logins).toEqual([
        { email: 'alice@example.com', password: 'secret' },
        { email: 'alice@example.com', password: 'secret', code: '123456' },
      ]);
      expect(await configOf(xdg)).toEqual({ url, token: 'session-1' });
    });

    it('keeps the error when the token is refused (401/403)', async () => {
      await expect(
        login({ url, token: 'nope' }, () => undefined, undefined, { XDG_CONFIG_HOME: join(dir, 'refused') }),
      ).rejects.toThrow('HTTP 403');
    });
  });

  describe('writePrivateFile', () => {
    it('restricts an existing file to 0600', async () => {
      const file = join(dir, 'existing.conf');

      await writeFile(file, 'old', { mode: 0o644 });
      await writePrivateFile(file, 'new');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, 'utf8')).toBe('new');
    });
  });

  describe('portForward', () => {
    let http: HttpServer;
    let sockets: SocketServer;
    const events: string[] = [];

    beforeAll(async () => {
      http = createHttpServer();
      sockets = new SocketServer(http);
      sockets
        .of('/socket/tunnels')
        .use((socket, next) =>
          next(socket.handshake.auth['Authorization'] === 'Bearer session-1' ? undefined : new Error('Unauthorized')),
        )
        .on('connection', (socket) => {
          socket.on('openTunnel', (m: { tunnelId: string }) => {
            // Another tunnel's confirmation must not release this connection.
            socket.emit('tunnelOpened', { tunnelId: 'other' });
            setTimeout(() => {
              events.push('opened');
              socket.emit('tunnelOpened', { tunnelId: m.tunnelId });
            }, 150);
          });
          socket.on('tunnelData', (m: { tunnelId: string; data: string }) => {
            events.push(`data:${Buffer.from(m.data, 'base64').toString()}`);
            socket.emit('tunnelData', m); // echo
          });
        });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      process.env['LOADWEAVER_URL'] = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => sockets.close(resolve));
    });

    it('fails with the connect error instead of hanging', async () => {
      process.env['LOADWEAVER_TOKEN'] = 'session-expired';

      await expect(
        portForward({ replica: 'shop/site/db', ports: `${await freePort()}:5432` }, () => undefined),
      ).rejects.toThrow('socket/tunnels: Unauthorized');
    });

    it('releases a connection only on its own tunnelOpened and forwards both ways', async () => {
      process.env['LOADWEAVER_TOKEN'] = 'session-1';

      const port = await freePort();
      const stop = new AbortController();
      const out: string[] = [];
      const forwarding = portForward({ replica: 'shop/site/db', ports: `${port}:5432`, signal: stop.signal }, (l) =>
        out.push(l),
      );

      while (out.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));

      const conn = connect(port, '127.0.0.1');
      const echoed = new Promise<string>((resolve) => conn.once('data', (d: Buffer) => resolve(d.toString())));

      conn.write('ping');
      await expect(echoed).resolves.toBe('ping');
      expect(events).toEqual(['opened', 'data:ping']);

      conn.destroy();
      stop.abort();
      await forwarding;
      expect(out).toEqual([`Forwarding 127.0.0.1:${port} → shop/site/db/0:5432 (Ctrl+C to stop)`]);
    });
  });
});
