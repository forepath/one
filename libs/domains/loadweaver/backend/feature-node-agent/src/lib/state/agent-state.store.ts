import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

export interface AgentIdentity {
  clusterId: string;
  nodeName: string;
  controlPlaneUrl: string;
  controlPlaneEndpoints: string[];
  endpointHost?: string;
}

export interface AgentCredentials {
  privateKeyPem: string;
  certificatePem: string;
  caCertificatePem: string;
}

const FILES = {
  identity: 'identity.json',
  key: 'node.key',
  cert: 'node.crt',
  ca: 'ca.crt',
  wireguard: 'wireguard.key',
  seal: 'seal.key',
  applied: 'applied-state.json',
  publicAddresses: 'public-addresses.json',
} as const;

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_STATE_DIR'] || '/var/lib/loadweaver';
}

/**
 * The agent's persistent state. Keys never leave the node; every file is written atomically with 0600 and
 * the directory is 0700, so a crash mid-write can't leave a half-written key or certificate behind.
 */
@Injectable()
export class AgentStateStore {
  readonly dir = stateDir();

  private path(file: keyof typeof FILES): string {
    return join(this.dir, FILES[file]);
  }

  private async write(file: keyof typeof FILES, content: string): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);

    const target = this.path(file);
    const tmp = `${target}.${process.pid}.tmp`;

    await writeFile(tmp, content, { mode: 0o600 });
    await rename(tmp, target);
  }

  private async read(file: keyof typeof FILES): Promise<string | null> {
    try {
      return await readFile(this.path(file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;

      throw error;
    }
  }

  async identity(): Promise<AgentIdentity | null> {
    const raw = await this.read('identity');

    return raw ? (JSON.parse(raw) as AgentIdentity) : null;
  }

  async saveIdentity(identity: AgentIdentity): Promise<void> {
    await this.write('identity', JSON.stringify(identity, null, 2));
  }

  async credentials(): Promise<AgentCredentials | null> {
    const [privateKeyPem, certificatePem, caCertificatePem] = await Promise.all([
      this.read('key'),
      this.read('cert'),
      this.read('ca'),
    ]);

    return privateKeyPem && certificatePem && caCertificatePem
      ? { privateKeyPem, certificatePem, caCertificatePem }
      : null;
  }

  async saveCredentials(credentials: AgentCredentials): Promise<void> {
    await this.write('key', credentials.privateKeyPem);
    await this.write('ca', credentials.caCertificatePem);
    // Certificate last: its presence marks a complete identity.
    await this.write('cert', credentials.certificatePem);
  }

  async wireguardPrivateKey(): Promise<string | null> {
    return (await this.read('wireguard'))?.trim() ?? null;
  }

  async saveWireguardPrivateKey(key: string): Promise<void> {
    await this.write('wireguard', `${key}\n`);
  }

  /** X25519 key master-key shares are sealed to (3.22). */
  async sealPrivateKey(): Promise<string | null> {
    return (await this.read('seal'))?.trim() ?? null;
  }

  async saveSealPrivateKey(key: string): Promise<void> {
    await this.write('seal', `${key}\n`);
  }

  wireguardKeyPath(): string {
    return this.path('wireguard');
  }

  /** Last successfully applied desired state: used to roll back a failed apply and after restarts. */
  async appliedState(): Promise<DesiredState | null> {
    const raw = await this.read('applied');

    return raw ? (JSON.parse(raw) as DesiredState) : null;
  }

  async saveAppliedState(state: DesiredState): Promise<void> {
    await this.write('applied', JSON.stringify(state));
  }

  /** Public addresses the agent bound to uplinks (`address/len dev iface`), so it can remove them again. */
  async boundPublicAddresses(): Promise<{ address: string; dev: string }[]> {
    const raw = await this.read('publicAddresses');

    return raw ? (JSON.parse(raw) as { address: string; dev: string }[]) : [];
  }

  async saveBoundPublicAddresses(bound: { address: string; dev: string }[]): Promise<void> {
    await this.write('publicAddresses', JSON.stringify(bound));
  }
}
