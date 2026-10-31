import 'reflect-metadata';
import { randomBytes, webcrypto } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as x509 from '@peculiar/x509';

/**
 * HashiCorp go-plugin handshake (what Terraform expects from every provider binary):
 *
 * 1. Terraform starts the binary with `TF_PLUGIN_MAGIC_COOKIE` set to a fixed value. Without it the binary was started
 *    by hand: it explains that and exits.
 * 2. `PLUGIN_PROTOCOL_VERSIONS` lists the app protocol versions Terraform speaks; the plugin picks one (6 = tfplugin6).
 * 3. AutoMTLS: `PLUGIN_CLIENT_CERT` carries Terraform's own self-signed client certificate (PEM). The plugin creates a
 *    self-signed server certificate for `localhost`, requires exactly that client certificate, and announces its own
 *    certificate (raw DER, base64 without padding) in the protocol line.
 * 4. The plugin listens on a unix socket (TCP on 127.0.0.1 within `PLUGIN_MIN_PORT`..`PLUGIN_MAX_PORT` on Windows)
 *    and prints `CORE-VERSION|APP-VERSION|NETWORK|ADDRESS|PROTOCOL|SERVER-CERT` as the first line on stdout.
 */
export const MAGIC_COOKIE_KEY = 'TF_PLUGIN_MAGIC_COOKIE';
export const MAGIC_COOKIE_VALUE = 'd602bf8f470bc67ca7faa0386276bbdd4330efaf76d1a219cb4d6991ca9872b2';
export const CORE_PROTOCOL_VERSION = 1;
export const APP_PROTOCOL_VERSION = 6;

export const NOT_STARTED_BY_TERRAFORM_MESSAGE = [
  'This binary is a plugin. These are not meant to be executed directly.',
  'Please execute the program that consumes these plugins, which will',
  'load any plugins automatically',
].join('\n');

export function hasMagicCookie(env: NodeJS.ProcessEnv): boolean {
  return env[MAGIC_COOKIE_KEY] === MAGIC_COOKIE_VALUE;
}

/**
 * The app protocol version to speak: 6 if Terraform offers it (or offers nothing, the go-plugin default), else
 * `null` (an older Terraform that only speaks protocol 5).
 */
export function negotiateProtocolVersion(env: NodeJS.ProcessEnv): number | null {
  const offered = (env['PLUGIN_PROTOCOL_VERSIONS'] ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v > 0);

  if (offered.length === 0) return APP_PROTOCOL_VERSION;

  return offered.includes(APP_PROTOCOL_VERSION) ? APP_PROTOCOL_VERSION : null;
}

export type ListenTarget =
  | { network: 'unix'; path: string }
  | { network: 'tcp'; host: '127.0.0.1'; minPort: number; maxPort: number };

/** Where to listen: a fresh socket in a private temp directory, or a loopback port range on Windows. */
export function listenTarget(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): ListenTarget {
  if (platform === 'win32') {
    const minPort = Number(env['PLUGIN_MIN_PORT'] || 10000);
    const maxPort = Number(env['PLUGIN_MAX_PORT'] || 25000);

    if (!Number.isInteger(minPort) || !Number.isInteger(maxPort) || minPort < 1 || maxPort > 65535 || minPort > maxPort)
      throw new Error(`invalid PLUGIN_MIN_PORT / PLUGIN_MAX_PORT: ${minPort}..${maxPort}`);

    return { network: 'tcp', host: '127.0.0.1', minPort, maxPort };
  }

  const dir = mkdtempSync(join(env['PLUGIN_UNIX_SOCKET_DIR'] || tmpdir(), 'plugin'));

  return { network: 'unix', path: join(dir, 'provider.sock') };
}

/** Debug-only escape hatch: serve plaintext gRPC on the Windows loopback port without `PLUGIN_CLIENT_CERT`. */
export const INSECURE_TCP_DEBUG_ENV = 'LOADWEAVER_TF_PLUGIN_INSECURE_TCP';

/**
 * Why the plugin refuses to start, or `null`: a loopback TCP port (Windows) without AutoMTLS would let any local
 * process drive the provider (and its control-plane token). Terraform always sets `PLUGIN_CLIENT_CERT`, so this only
 * blocks hand-made launches unless {@link INSECURE_TCP_DEBUG_ENV}`=1` is set for debugging.
 */
export function insecureTcpRefusal(
  env: NodeJS.ProcessEnv,
  clientCert: string | null,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'win32' || clientCert || env[INSECURE_TCP_DEBUG_ENV] === '1') return null;

  return `PLUGIN_CLIENT_CERT is not set: refusing to serve the provider without mutual TLS on a loopback TCP port (Terraform always sets it). For debugging only, set ${INSECURE_TCP_DEBUG_ENV}=1.`;
}

/** The handshake line (with the trailing newline). `serverCertificate` is empty without AutoMTLS. */
export function protocolLine(params: {
  appVersion: number;
  network: 'unix' | 'tcp';
  address: string;
  serverCertificate: string;
}): string {
  return `${CORE_PROTOCOL_VERSION}|${params.appVersion}|${params.network}|${params.address}|grpc|${params.serverCertificate}\n`;
}

export interface ServerCertificate {
  certificatePem: string;
  privateKeyPem: string;
  /** The raw DER certificate, standard base64 without padding: the last field of the protocol line. */
  handshakeValue: string;
}

const crypto = webcrypto as unknown as Crypto;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

x509.cryptoProvider.set(crypto);

/**
 * The plugin's AutoMTLS certificate, like go-plugin's `generateCert`: self-signed, `localhost`, server and client
 * auth, valid for the life of the process (with a little clock skew allowance).
 */
export async function generateServerCertificate(now: Date = new Date()): Promise<ServerCertificate> {
  const keys = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: `01${randomBytes(15).toString('hex')}`,
    name: 'CN=localhost, O=HashiCorp',
    notBefore: new Date(now.getTime() - 30_000),
    notAfter: new Date(now.getTime() + 30 * 24 * 3600_000),
    keys,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment | x509.KeyUsageFlags.keyCertSign,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], false),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'localhost' }], false),
    ],
  });
  const privateKey = await crypto.subtle.exportKey('pkcs8', keys.privateKey);

  return {
    certificatePem: cert.toString('pem'),
    privateKeyPem: x509.PemConverter.encode(privateKey, 'PRIVATE KEY'),
    handshakeValue: Buffer.from(cert.rawData).toString('base64').replace(/=+$/, ''),
  };
}

/** Validates `PLUGIN_CLIENT_CERT` (one PEM certificate) and returns it, or `null` when AutoMTLS is off. */
export function clientCertificate(env: NodeJS.ProcessEnv): string | null {
  const pem = env['PLUGIN_CLIENT_CERT'];

  if (!pem) return null;

  try {
    new x509.X509Certificate(pem);
  } catch (error) {
    throw new Error(`PLUGIN_CLIENT_CERT is not a PEM certificate: ${error instanceof Error ? error.message : error}`);
  }

  return pem;
}
