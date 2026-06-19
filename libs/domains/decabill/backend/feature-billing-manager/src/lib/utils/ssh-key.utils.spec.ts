import * as sshpk from 'sshpk';

import { generateSshKeyPair } from './ssh-key.utils';

describe('ssh-key.utils', () => {
  describe('generateSshKeyPair', () => {
    it('returns publicKey and privateKey strings', () => {
      const pair = generateSshKeyPair();

      expect(pair).toHaveProperty('publicKey');
      expect(pair).toHaveProperty('privateKey');
      expect(typeof pair.publicKey).toBe('string');
      expect(typeof pair.privateKey).toBe('string');
      expect(pair.publicKey.length).toBeGreaterThan(0);
      expect(pair.privateKey.length).toBeGreaterThan(0);
    });

    it('public key is in OpenSSH format suitable for authorized_keys', () => {
      const pair = generateSshKeyPair();

      expect(pair.publicKey).toMatch(/^ssh-ed25519 AAAA/);
    });

    it('private key can be parsed by sshpk', () => {
      const pair = generateSshKeyPair();
      const parsed = sshpk.parsePrivateKey(pair.privateKey, 'openssh');

      expect(parsed).toBeDefined();
      expect(parsed.type).toBe('ed25519');
    });

    it('public key matches the private key', () => {
      const pair = generateSshKeyPair();
      const parsedPrivate = sshpk.parsePrivateKey(pair.privateKey, 'openssh');
      const expectedPublic = parsedPrivate
        .toPublic()
        .toString('ssh')
        .replace(/\s*\(unnamed\)$/, '');

      expect(pair.publicKey).toBe(expectedPublic);
    });

    it('generates a new keypair on each call', () => {
      const pair1 = generateSshKeyPair();
      const pair2 = generateSshKeyPair();

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
    });
  });
});
