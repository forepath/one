import { randomBytes } from 'node:crypto';

import { generateSealKeyPair, openSealed, sealPublicKey, sealTo } from './sealed-box';
import { envelopeDecrypt, envelopeEncrypt, generateKey, open, rewrapKey, seal } from './envelope';
import { combineShares, decodeShare, encodeShare, splitSecret } from './shamir';

describe('shamir', () => {
  const secret = randomBytes(32);

  it.each([
    [1, 1],
    [3, 2],
    [5, 3],
    [10, 7],
  ])('reconstructs from any %i-of-%i subset', (shares, threshold) => {
    const parts = splitSecret(secret, shares, threshold);

    for (let start = 0; start + threshold <= shares; start++) {
      expect(combineShares(parts.slice(start, start + threshold))).toEqual(secret);
    }

    expect(combineShares([...parts].reverse())).toEqual(secret);
  });

  it('refuses too few, mixed or tampered shares', () => {
    const parts = splitSecret(secret, 3, 2);
    const other = splitSecret(randomBytes(32), 3, 2);

    expect(() => combineShares([parts[0]])).toThrow('need 2 shares');
    expect(() => combineShares([parts[0], parts[0]])).toThrow('need 2 shares');
    expect(() => combineShares([parts[0], other[1]])).toThrow('different secrets');

    const tampered = { ...parts[1], value: Buffer.from(parts[1].value) };

    tampered.value[0] ^= 1;
    expect(() => combineShares([parts[0], tampered])).toThrow('do not reconstruct');
  });

  it('gives different shares on every split (random polynomials)', () => {
    expect(splitSecret(secret, 3, 2)[0].value).not.toEqual(splitSecret(secret, 3, 2)[0].value);
  });

  it('encodes shares as text for storage and the recovery kit', () => {
    const [share] = splitSecret(secret, 3, 2);

    expect(decodeShare(encodeShare(share))).toEqual(share);
    expect(() => decodeShare('lws1.0.1.0000000000000000.AA')).toThrow('invalid share');
    expect(() => decodeShare('garbage')).toThrow('invalid share');
  });

  it('validates parameters', () => {
    expect(() => splitSecret(secret, 2, 3)).toThrow(RangeError);
    expect(() => splitSecret(secret, 256, 2)).toThrow(RangeError);
    expect(() => splitSecret(Buffer.alloc(0), 2, 2)).toThrow(RangeError);
  });
});

describe('envelope encryption', () => {
  const master = generateKey();

  it('round-trips and binds ciphertexts to their AAD', () => {
    const envelope = envelopeEncrypt(master, Buffer.from('s3cret'), 'secret/shop/db');

    expect(envelopeDecrypt(master, envelope, 'secret/shop/db').toString()).toBe('s3cret');
    expect(() => envelopeDecrypt(master, envelope, 'secret/shop/other')).toThrow();
    expect(() => envelopeDecrypt(generateKey(), envelope, 'secret/shop/db')).toThrow();
  });

  it('detects tampering', () => {
    const sealed = seal(master, Buffer.from('x'), 'a');

    sealed[sealed.length - 1] ^= 1;
    expect(() => open(master, sealed, 'a')).toThrow();
    expect(() => open(master, Buffer.from([2, 0]), 'a')).toThrow('unsupported ciphertext');
  });

  it('rotates the master key by re-wrapping data keys only', () => {
    const envelope = envelopeEncrypt(master, Buffer.from('v'), 'id');
    const next = generateKey();
    const rewrapped = {
      wrappedKey: rewrapKey(master, next, envelope.wrappedKey, 'id'),
      ciphertext: envelope.ciphertext,
    };

    expect(envelopeDecrypt(next, rewrapped, 'id').toString()).toBe('v');
    expect(() => envelopeDecrypt(master, rewrapped, 'id')).toThrow();
  });
});

describe('sealed boxes', () => {
  it('seals to a public key and opens with the private key only', () => {
    const recipient = generateSealKeyPair();
    const other = generateSealKeyPair();
    const sealed = sealTo(recipient.publicKey, Buffer.from('share'), 'master-key/1/n1');

    expect(openSealed(recipient.privateKey, sealed, 'master-key/1/n1').toString()).toBe('share');
    expect(() => openSealed(other.privateKey, sealed, 'master-key/1/n1')).toThrow();
    expect(() => openSealed(recipient.privateKey, sealed, 'master-key/1/n2')).toThrow();
    expect(sealPublicKey(recipient.privateKey)).toBe(recipient.publicKey);
  });

  it('uses a fresh ephemeral key per box', () => {
    const recipient = generateSealKeyPair();

    expect(sealTo(recipient.publicKey, Buffer.from('x'), 'a').subarray(0, 32)).not.toEqual(
      sealTo(recipient.publicKey, Buffer.from('x'), 'a').subarray(0, 32),
    );
  });
});
