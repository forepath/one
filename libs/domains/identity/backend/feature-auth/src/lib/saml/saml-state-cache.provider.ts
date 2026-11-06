import type { CacheItem, CacheProvider } from '@node-saml/node-saml';

import { SAML_REQUEST_TTL_MS } from '../constants/saml.constants';
import type { ExternalAuthStatesRepository } from '../repositories/external-auth-states.repository';

/**
 * node-saml cache backed by the database, so outstanding AuthnRequest ids and the assertion replay cache work
 * across replicas. Request ids are consumed atomically (`consumeAsync`) and assertion ids are remembered with
 * `saveIfAbsentAsync` (enables `rejectReplayedAssertions`).
 */
export class SamlStateCacheProvider implements CacheProvider {
  constructor(private readonly states: ExternalAuthStatesRepository) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await this.states.save('saml_request', key, new Date(Date.now() + SAML_REQUEST_TTL_MS), { value });

    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    const row = await this.states.peek('saml_request', key);

    return row?.value ?? null;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) {
      return null;
    }

    const row = await this.states.consume('saml_request', key);

    return row?.value ?? null;
  }

  async consumeAsync(key: string): Promise<string | null> {
    const row = await this.states.consume('saml_request', key);

    return row?.value ?? null;
  }

  async saveIfAbsentAsync(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    return this.states.saveIfAbsent('saml_assertion', key, new Date(expiresAtMs), { value });
  }
}
