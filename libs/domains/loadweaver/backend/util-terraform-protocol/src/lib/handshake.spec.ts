import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { credentials, makeGenericClientConstructor, type Client } from '@grpc/grpc-js';

import {
  APP_PROTOCOL_VERSION,
  clientCertificate,
  generateServerCertificate,
  hasMagicCookie,
  INSECURE_TCP_DEBUG_ENV,
  insecureTcpRefusal,
  listenTarget,
  MAGIC_COOKIE_KEY,
  MAGIC_COOKIE_VALUE,
  negotiateProtocolVersion,
  protocolLine,
} from './handshake';
import { createPluginLogger } from './logger';
import { servePlugin } from './plugin-server';
import { serviceDefinition } from './protos';

describe('go-plugin handshake', () => {
  it('checks the magic cookie', () => {
    expect(hasMagicCookie({ [MAGIC_COOKIE_KEY]: MAGIC_COOKIE_VALUE })).toBe(true);
    expect(hasMagicCookie({ [MAGIC_COOKIE_KEY]: 'nope' })).toBe(false);
    expect(hasMagicCookie({})).toBe(false);
  });

  it('negotiates protocol 6', () => {
    expect(negotiateProtocolVersion({})).toBe(APP_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion({ PLUGIN_PROTOCOL_VERSIONS: '5,6' })).toBe(6);
    expect(negotiateProtocolVersion({ PLUGIN_PROTOCOL_VERSIONS: '5' })).toBeNull();
  });

  it('prints the protocol line', () => {
    expect(protocolLine({ appVersion: 6, network: 'unix', address: '/tmp/x/p.sock', serverCertificate: 'AbC' })).toBe(
      '1|6|unix|/tmp/x/p.sock|grpc|AbC\n',
    );
  });

  it('listens on a private unix socket, or a loopback port range on Windows', () => {
    const unix = listenTarget({}, 'linux');

    expect(unix.network).toBe('unix');
    expect(unix.network === 'unix' && existsSync(dirname(unix.path))).toBe(true);
    expect(listenTarget({ PLUGIN_MIN_PORT: '20000', PLUGIN_MAX_PORT: '20010' }, 'win32')).toEqual({
      network: 'tcp',
      host: '127.0.0.1',
      minPort: 20000,
      maxPort: 20010,
    });
    expect(() => listenTarget({ PLUGIN_MIN_PORT: '9', PLUGIN_MAX_PORT: '1' }, 'win32')).toThrow('invalid');
  });

  it('creates an AutoMTLS certificate like go-plugin (localhost, server + client auth, raw DER in the line)', async () => {
    const cert = await generateServerCertificate();
    const x509 = new X509Certificate(cert.certificatePem);

    expect(x509.subjectAltName).toBe('DNS:localhost');
    expect(x509.ca).toBe(true);
    expect(x509.checkIssued(x509)).toBe(true);
    expect(cert.handshakeValue).not.toMatch(/=$/);
    expect(Buffer.from(cert.handshakeValue, 'base64').equals(x509.raw)).toBe(true);
    expect(cert.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('validates PLUGIN_CLIENT_CERT', async () => {
    expect(clientCertificate({})).toBeNull();
    expect(() => clientCertificate({ PLUGIN_CLIENT_CERT: 'garbage' })).toThrow('PLUGIN_CLIENT_CERT');

    const { certificatePem } = await generateServerCertificate();

    expect(clientCertificate({ PLUGIN_CLIENT_CERT: certificatePem })).toBe(certificatePem);
  });
});

describe('plugin server', () => {
  const logger = createPluginLogger('test', () => undefined);

  it('refuses to run without Terraform', async () => {
    const stderr: string[] = [];

    await expect(servePlugin({ provider: {}, logger, env: {}, stderr: (l) => stderr.push(l) })).resolves.toBeNull();
    expect(stderr.join('')).toContain('This binary is a plugin');
  });

  it('refuses protocol 5 only hosts', async () => {
    const stderr: string[] = [];

    await expect(
      servePlugin({
        provider: {},
        logger,
        env: { [MAGIC_COOKIE_KEY]: MAGIC_COOKIE_VALUE, PLUGIN_PROTOCOL_VERSIONS: '5' },
        stderr: (l) => stderr.push(l),
      }),
    ).resolves.toBeNull();
    expect(stderr.join('')).toContain('protocol 6');
  });

  it('refuses the Windows loopback TCP listener without PLUGIN_CLIENT_CERT unless the debug flag is set', async () => {
    expect(insecureTcpRefusal({}, null, 'win32')).toContain('PLUGIN_CLIENT_CERT is not set');
    expect(insecureTcpRefusal({ [INSECURE_TCP_DEBUG_ENV]: '1' }, null, 'win32')).toBeNull();
    expect(insecureTcpRefusal({ [INSECURE_TCP_DEBUG_ENV]: 'true' }, null, 'win32')).not.toBeNull();
    expect(insecureTcpRefusal({}, 'PEM', 'win32')).toBeNull();
    expect(insecureTcpRefusal({}, null, 'linux')).toBeNull();

    const stderr: string[] = [];
    const stdout: string[] = [];

    await expect(
      servePlugin({
        provider: {},
        logger,
        env: { [MAGIC_COOKIE_KEY]: MAGIC_COOKIE_VALUE, PLUGIN_PROTOCOL_VERSIONS: '6' },
        platform: 'win32',
        stderr: (l) => stderr.push(l),
        stdout: (l) => stdout.push(l),
      }),
    ).resolves.toBeNull();
    expect(stderr.join('')).toContain(INSECURE_TCP_DEBUG_ENV);
    expect(stdout).toEqual([]);
  });

  it('serves tfplugin6 over mutual TLS on a unix socket, health and controller shutdown included', async () => {
    const client = await generateServerCertificate();
    const lines: string[] = [];
    const running = await servePlugin({
      provider: {
        GetMetadata: async () => ({ resources: [{ type_name: 'loadweaver_project' }] }),
      },
      logger,
      env: {
        [MAGIC_COOKIE_KEY]: MAGIC_COOKIE_VALUE,
        PLUGIN_PROTOCOL_VERSIONS: '5,6',
        PLUGIN_CLIENT_CERT: client.certificatePem,
      },
      stdout: (l) => lines.push(l),
    });

    expect(running).not.toBeNull();

    const [core, app, network, address, protocol, cert] = lines[0].trimEnd().split('|');

    expect([core, app, network, protocol]).toEqual(['1', '6', 'unix', 'grpc']);

    const serverPem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(cert, 'base64').toString('base64')}\n-----END CERTIFICATE-----\n`;
    const creds = credentials.createSsl(
      Buffer.from(serverPem),
      Buffer.from(client.privateKeyPem),
      Buffer.from(client.certificatePem),
    );
    const options = { 'grpc.ssl_target_name_override': 'localhost', 'grpc.default_authority': 'localhost' };
    const call = (definition: string, method: string, request: Record<string, unknown>) => {
      const Ctor = makeGenericClientConstructor(serviceDefinition(definition), definition);
      const c = new Ctor(`unix:${address}`, creds, options) as Client & Record<string, (...args: unknown[]) => void>;

      return new Promise<Record<string, unknown>>((resolve, reject) =>
        c[method](request, (err: Error | null, res: Record<string, unknown>) => {
          c.close();

          return err ? reject(err) : resolve(res);
        }),
      );
    };

    await expect(call('tfplugin6.Provider', 'GetMetadata', {})).resolves.toMatchObject({
      resources: [{ type_name: 'loadweaver_project' }],
    });
    await expect(call('tfplugin6.Provider', 'GetProviderSchema', {})).rejects.toMatchObject({ code: 12 });
    await expect(call('grpc.health.v1.Health', 'Check', { service: 'plugin' })).resolves.toEqual({ status: 1 });

    // A client without the expected certificate is refused.
    const stranger = await generateServerCertificate();
    const Ctor = makeGenericClientConstructor(serviceDefinition('tfplugin6.Provider'), 'p');
    const bad = new Ctor(
      `unix:${address}`,
      credentials.createSsl(
        Buffer.from(serverPem),
        Buffer.from(stranger.privateKeyPem),
        Buffer.from(stranger.certificatePem),
      ),
      options,
    ) as Client & Record<string, (...args: unknown[]) => void>;

    await expect(
      new Promise((resolve, reject) =>
        bad['GetMetadata']({}, { deadline: Date.now() + 3000 }, (err: Error | null, res: unknown) =>
          err ? reject(err) : resolve(res),
        ),
      ),
    ).rejects.toBeDefined();
    bad.close();

    await call('plugin.GRPCController', 'Shutdown', {});
    await running?.done;
    expect(existsSync(address)).toBe(false);
  });
});
