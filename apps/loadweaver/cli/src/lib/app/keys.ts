import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { publicKeyId, signingKeyType } from '@forepath/loadweaver/shared/util-app-catalog';

/** Env var with the signing key PEM itself (CI secrets), used when no `--key` is given. */
export const SIGNING_KEY_ENV = 'LW_APP_SIGNING_KEY';
/** Env var with the passphrase of an encrypted PKCS#8 signing key. */
export const SIGNING_KEY_PASSPHRASE_ENV = 'LW_APP_SIGNING_KEY_PASSPHRASE';

export interface PrivateKeySource {
  /** A PEM file, `env:<VAR>` (the PEM is in that variable) or undefined (`LW_APP_SIGNING_KEY`). */
  key?: string;
  /** Env var holding the passphrase (default `LW_APP_SIGNING_KEY_PASSPHRASE`). */
  passphraseEnv?: string;
}

export interface SigningKey {
  privateKeyPem: string;
  passphrase?: string;
  /** Key id of the matching public key (SHA-256 of the SPKI DER). */
  keyId: string;
  publicKeyPem: string;
}

/**
 * Loads a signing key from a file, an env var (`env:VAR`) or `LW_APP_SIGNING_KEY`. The PEM never leaves this
 * process: errors name the source, never the content.
 */
export async function loadSigningKey(
  source: PrivateKeySource,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SigningKey> {
  let pem: string;
  let where: string;

  if (source.key?.startsWith('env:')) {
    const name = source.key.slice(4);

    where = `$${name}`;
    pem = env[name] ?? '';
  } else if (source.key) {
    where = source.key;
    pem = await readFile(source.key, 'utf8');
  } else {
    where = `$${SIGNING_KEY_ENV}`;
    pem = env[SIGNING_KEY_ENV] ?? '';
  }

  if (!pem.trim()) throw new Error(`no signing key: pass --key <pem file | env:VAR> or set ${SIGNING_KEY_ENV}`);

  if (!pem.includes('PRIVATE KEY-----')) throw new Error(`${where} is not a PEM private key`);

  if (pem.includes('ENCRYPTED SIGSTORE PRIVATE KEY'))
    throw new Error(
      `${where} is a cosign-encrypted key, which lw does not read: use a PKCS#8 key (\`lw app keygen\`, openssl) ` +
        'and `cosign import-key-pair` it for cosign',
    );

  const passphraseVar = source.passphraseEnv ?? SIGNING_KEY_PASSPHRASE_ENV;
  const passphrase = env[passphraseVar] || undefined;
  let publicKeyPem: string;

  try {
    const key = createPrivateKey(passphrase === undefined ? pem : { key: pem, passphrase });

    publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  } catch (error) {
    const encrypted = /BEGIN ENCRYPTED PRIVATE KEY|Proc-Type: 4,ENCRYPTED/.test(pem);
    const code = (error as NodeJS.ErrnoException).code;

    throw new Error(
      encrypted && passphrase === undefined
        ? `${where}: the key is encrypted; set the passphrase in $${passphraseVar}`
        : encrypted || code === 'ERR_OSSL_BAD_DECRYPT'
          ? `${where}: wrong passphrase ($${passphraseVar})`
          : `${where}: unreadable private key`,
    );
  }

  if (!signingKeyType(publicKeyPem)) throw new Error(`${where}: app store keys are ECDSA P-256 or Ed25519 keys`);

  return { privateKeyPem: pem, passphrase, keyId: publicKeyId(publicKeyPem), publicKeyPem };
}

/** Reads a PEM public key; private keys are refused (they don't belong where public keys are expected). */
export async function readPublicKey(path: string): Promise<string> {
  const pem = await readFile(path, 'utf8');

  if (pem.includes('PRIVATE KEY-----')) throw new Error(`${path} is a private key; pass the public key`);

  if (!signingKeyType(pem)) throw new Error(`${path} is not an ECDSA P-256 / Ed25519 PEM public key`);

  return createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString();
}

/** Public keys from files and directories (every `*.pub` / `*.pem` in a directory). */
export async function loadPublicKeys(paths: readonly string[]): Promise<string[]> {
  const keys: string[] = [];

  for (const path of paths) {
    if ((await stat(path)).isDirectory()) {
      const names = (await readdir(path)).filter((n) => /\.(pub|pem)$/.test(n)).sort();

      for (const name of names) keys.push(await readPublicKey(join(path, name)));
    } else keys.push(await readPublicKey(path));
  }

  return keys;
}
