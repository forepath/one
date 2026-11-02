import { envelopeDecrypt } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SecretEntity } from '../entities/secret.entity';
import { MasterKeyService } from './master-key.service';

const REF = /^secret:\/\/([a-z0-9-]+)\/([a-z0-9][a-z0-9._-]*)$/;

/**
 * Credentials the control plane itself uses (DNS providers, failover-IP providers, 3.15 / 3.6): the latest version
 * of a referenced secret, decrypted in memory only for the provider call. Never logged, never sent to nodes.
 */
@Injectable()
export class PlatformCredentialsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
  ) {}

  async read(ref: string): Promise<Buffer> {
    const match = REF.exec(ref);

    if (!match) throw new Error(`invalid secret reference ${ref}`);

    const [, project, name] = match;
    const secret = await this.dataSource
      .getRepository(SecretEntity)
      .findOne({ where: { project, name }, order: { version: 'DESC' } });

    if (!secret) throw new Error(`${ref} has no value yet`);

    const key = await this.masterKey.current();

    if (secret.keyId !== key.id)
      throw new Error(`${ref} is wrapped by another master key; retry after the re-key finished`);

    return envelopeDecrypt(
      key.value,
      { wrappedKey: secret.wrappedKey, ciphertext: secret.ciphertext },
      `secret://${project}/${name}@${secret.version}`,
    );
  }

  /**
   * Provider configuration from a secret: a JSON object is used as is, any other value is the API token
   * (`{ apiToken }`), which covers Cloudflare, Hetzner and most token-based APIs.
   */
  async providerConfig(ref: string): Promise<Record<string, string>> {
    const value = await this.read(ref);

    try {
      const text = value.toString('utf8').trim();

      if (text.startsWith('{')) {
        const parsed = JSON.parse(text) as Record<string, unknown>;

        return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<
          string,
          string
        >;
      }

      return { apiToken: text };
    } finally {
      value.fill(0);
    }
  }
}
