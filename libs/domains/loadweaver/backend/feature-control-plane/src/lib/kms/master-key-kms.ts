import { Injectable, Logger } from '@nestjs/common';

/**
 * External KMS / Vault holding the cluster master key (3.22), instead of Shamir shares on the members. A provider
 * wraps the key; the control plane stores only the wrapped form and unwraps it into memory when it unseals.
 */
export interface MasterKeyKmsProvider {
  /** Stable id, configured with `LOADWEAVER_MASTER_KEY_KMS`. */
  readonly id: string;
  /** Which key of the KMS wraps (shown in plans and the audit log, never secret). */
  keyRef(): string;
  wrap(key: Buffer, keyId: string): Promise<string>;
  unwrap(wrapped: string, keyId: string): Promise<Buffer>;
}

export const MASTER_KEY_KMS_ENV = 'LOADWEAVER_MASTER_KEY_KMS';
export const DYNAMIC_KMS_PROVIDERS_ENV = 'DYNAMIC_KMS_PROVIDERS';

/** Built-in and plugin KMS providers; the configured one (if any) holds the master key. */
@Injectable()
export class MasterKeyKmsRegistry {
  private readonly logger = new Logger(MasterKeyKmsRegistry.name);
  private readonly providers = new Map<string, MasterKeyKmsProvider>();

  register(provider: MasterKeyKmsProvider): void {
    if (this.providers.has(provider.id))
      this.logger.warn(`KMS provider ${provider.id} registered twice; keeping the first`);
    else this.providers.set(provider.id, provider);
  }

  /** The configured provider; null = Shamir shares on the members. Unknown ids fail loudly. */
  configured(env: NodeJS.ProcessEnv = process.env): MasterKeyKmsProvider | null {
    const id = env[MASTER_KEY_KMS_ENV];

    if (!id) return null;

    const provider = this.providers.get(id);

    if (!provider) throw new Error(`${MASTER_KEY_KMS_ENV}=${id} names no registered KMS provider`);

    return provider;
  }

  get(id: string): MasterKeyKmsProvider {
    const provider = this.providers.get(id);

    if (!provider) throw new Error(`the master key is held by KMS provider ${id}, which is not registered`);

    return provider;
  }
}
