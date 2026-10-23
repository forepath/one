import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * WireGuard keys are raw Curve25519 keys in base64 (32 bytes). Node's X25519 keys are the same curve, so the
 * agent needs no `wg genkey`. The raw key sits at the end of the DER encodings.
 */
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

export interface WireguardKeyPair {
  privateKey: string;
  publicKey: string;
}

function rawPublic(key: KeyObject): string {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_X25519_PREFIX.length).toString('base64');
}

export function generateWireguardKeyPair(): WireguardKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const rawPrivate = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(
    PKCS8_X25519_PREFIX.length,
  );

  return { privateKey: rawPrivate.toString('base64'), publicKey: rawPublic(publicKey) };
}

export function wireguardPublicKey(privateKeyBase64: string): string {
  const raw = Buffer.from(privateKeyBase64, 'base64');

  if (raw.length !== 32) throw new Error('invalid WireGuard private key');

  const key = createPrivateKey({ key: Buffer.concat([PKCS8_X25519_PREFIX, raw]), format: 'der', type: 'pkcs8' });

  return rawPublic(createPublicKey(key));
}
