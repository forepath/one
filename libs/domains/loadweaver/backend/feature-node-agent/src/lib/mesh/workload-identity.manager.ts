import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { agentMessage, type Envelope, type WorkloadIdentities } from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair, remainingLifetimeFraction } from '@forepath/loadweaver/shared/util-pki';
import { Injectable, Logger } from '@nestjs/common';

import { AgentStateStore } from '../state/agent-state.store';

/** Renewed at half their lifetime (24 h certificates: every 12 h). */
const RENEW_BELOW_FRACTION = 0.5;
/** A request without an answer is repeated after this long. */
const REQUEST_RETRY_MS = 60_000;

export interface HeldIdentity {
  identity: string;
  certificatePem: string;
  privateKeyPem: string;
}

function matches(certificatePem: string, privateKeyPem: string): boolean {
  try {
    return new X509Certificate(certificatePem).publicKey.equals(createPublicKey(createPrivateKey(privateKeyPem)));
  } catch {
    return false;
  }
}

/** File name of an identity (`project/deployment/service` has slashes). */
const fileName = (identity: string) => identity.split('/').join('~');

/**
 * The workload identities of this node's replicas (3.7): keys generated here and never sent anywhere, certificates
 * from the control plane by CSR (only for services this node runs), renewed in time. The node proxy reads them.
 */
@Injectable()
export class WorkloadIdentityManager {
  private readonly logger = new Logger(WorkloadIdentityManager.name);
  private send: ((envelope: Envelope) => void) | null = null;
  /** Keys waiting for their certificate. */
  private readonly pending = new Map<string, { privateKeyPem: string; requestedAt: number }>();
  private caCertificatePem: string | null = null;
  private onChange: (() => void) | null = null;

  constructor(private readonly state: AgentStateStore) {}

  private get dir(): string {
    return join(this.state.dir, 'mesh', 'identities');
  }

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
  }

  /** Called when new certificates arrived, so the proxy picks them up. */
  watch(onChange: () => void): void {
    this.onChange = onChange;
  }

  async ca(): Promise<string | null> {
    this.caCertificatePem ??= await readFile(join(this.dir, 'ca.pem'), 'utf8').catch(() => null);

    return this.caCertificatePem;
  }

  /** Identities with a usable certificate. */
  async held(identities: readonly string[]): Promise<HeldIdentity[]> {
    const result: HeldIdentity[] = [];

    for (const identity of identities) {
      const certificatePem = await readFile(join(this.dir, `${fileName(identity)}.crt`), 'utf8').catch(() => null);
      const privateKeyPem = await readFile(join(this.dir, `${fileName(identity)}.key`), 'utf8').catch(() => null);

      if (certificatePem && privateKeyPem && remainingLifetimeFraction(certificatePem) > 0)
        result.push({ identity, certificatePem, privateKeyPem });
    }

    return result;
  }

  /** Requests what is missing or due, drops identities no longer needed. */
  async ensure(identities: readonly string[]): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });

    const wanted = new Set(identities.map(fileName));

    for (const file of await readdir(this.dir)) {
      const base = file.replace(/\.(crt|key)$/, '');

      if (file !== 'ca.pem' && !wanted.has(base)) await rm(join(this.dir, file), { force: true });
    }

    for (const identity of [...this.pending.keys()]) if (!identities.includes(identity)) this.pending.delete(identity);

    const held = new Map((await this.held(identities)).map((h) => [h.identity, h]));
    const requests: { identity: string; csrPem: string }[] = [];

    for (const identity of identities) {
      const current = held.get(identity);
      const due = !current || remainingLifetimeFraction(current.certificatePem) < RENEW_BELOW_FRACTION;
      const waiting = this.pending.get(identity);

      if (!due || (waiting && Date.now() - waiting.requestedAt < REQUEST_RETRY_MS)) continue;

      const keys = await generateKeyPair();

      this.pending.set(identity, { privateKeyPem: keys.privateKeyPem, requestedAt: Date.now() });
      requests.push({ identity, csrPem: await createCsr(keys, `workload:${identity}`) });
    }

    if (requests.length > 0 && this.send) this.send(agentMessage('workloadIdentityRequest', { requests }));
  }

  /** Called by the connection for `workloadIdentities` replies. */
  async deliver(payload: WorkloadIdentities): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.write('ca.pem', payload.caCertificatePem);
    this.caCertificatePem = payload.caCertificatePem;

    for (const { identity, certificatePem } of payload.certificates) {
      const key = this.pending.get(identity);

      // An answer to an earlier request (since replaced by a retry with a new key) doesn't fit this key.
      if (!key || !matches(certificatePem, key.privateKeyPem)) continue;

      // Key first: the certificate's presence marks a complete pair.
      await this.write(`${fileName(identity)}.key`, key.privateKeyPem);
      await this.write(`${fileName(identity)}.crt`, certificatePem);
      this.pending.delete(identity);
    }

    for (const identity of payload.refused) {
      this.pending.delete(identity);
      this.logger.warn(`Workload identity ${identity} refused by the control plane`);
    }

    this.onChange?.();
  }

  private async write(file: string, content: string): Promise<void> {
    await writeFile(join(this.dir, `${file}.new`), content, { mode: 0o600 });
    await rename(join(this.dir, `${file}.new`), join(this.dir, file));
  }
}
