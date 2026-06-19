import * as sshpk from 'sshpk';

export interface SshKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generates an ed25519 SSH keypair for server provisioning.
 * Public key is in OpenSSH format for authorized_keys; private key is stored (encrypted) in the database.
 */
export function generateSshKeyPair(): SshKeyPair {
  const privateKeyObj = sshpk.generatePrivateKey('ed25519');
  const publicKey = privateKeyObj.toPublic().toString('ssh');
  const privateKey = privateKeyObj.toString('openssh');

  return { publicKey, privateKey };
}
