import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
} from 'node:crypto';

import { open, seal } from './envelope';

/**
 * Sealed boxes (ECIES over X25519 + HKDF-SHA256 + AES-256-GCM): encrypt to a public key so only the holder of the
 * private key can read it. Used to keep master-key shares encrypted to the node that holds them (3.22).
 */

const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const INFO = Buffer.from('loadweaver sealed box v1');

export interface SealKeyPair {
  /** Raw 32-byte X25519 keys, base64. */
  privateKey: string;
  publicKey: string;
}

function privateKeyObject(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64');

  if (bytes.length !== 32) throw new Error('invalid seal private key');

  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, bytes]), format: 'der', type: 'pkcs8' });
}

function publicKeyObject(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64');

  if (bytes.length !== 32) throw new Error('invalid seal public key');

  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, bytes]), format: 'der', type: 'spki' });
}

function rawPublic(key: KeyObject): string {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_PREFIX.length).toString('base64');
}

export function generateSealKeyPair(): SealKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');

  return {
    privateKey: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer)
      .subarray(PKCS8_PREFIX.length)
      .toString('base64'),
    publicKey: rawPublic(publicKey),
  };
}

export function sealPublicKey(privateKey: string): string {
  return rawPublic(createPublicKey(privateKeyObject(privateKey)));
}

function deriveKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
}

/** `ephemeralPublic(32) | seal(...)` */
export function sealTo(recipientPublicKey: string, plaintext: Buffer, aad: string): Buffer {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralRaw = Buffer.from(rawPublic(ephemeral.publicKey), 'base64');
  const recipientRaw = Buffer.from(recipientPublicKey, 'base64');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyObject(recipientPublicKey) });
  const key = deriveKey(shared, ephemeralRaw, recipientRaw);

  try {
    return Buffer.concat([ephemeralRaw, seal(key, plaintext, aad)]);
  } finally {
    key.fill(0);
    shared.fill(0);
  }
}

export function openSealed(recipientPrivateKey: string, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 33) throw new Error('invalid sealed box');

  const ephemeralRaw = sealed.subarray(0, 32);
  const recipientRaw = Buffer.from(sealPublicKey(recipientPrivateKey), 'base64');
  const shared = diffieHellman({
    privateKey: privateKeyObject(recipientPrivateKey),
    publicKey: publicKeyObject(ephemeralRaw.toString('base64')),
  });
  const key = deriveKey(shared, ephemeralRaw, recipientRaw);

  try {
    return open(key, sealed.subarray(32), aad);
  } finally {
    key.fill(0);
    shared.fill(0);
  }
}
