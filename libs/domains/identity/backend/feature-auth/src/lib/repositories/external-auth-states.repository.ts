import { createHash } from 'node:crypto';

import { ExternalAuthStateEntity, type ExternalAuthStateKind } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

export interface ExternalAuthStateData {
  userId?: string | null;
  requestId?: string | null;
  codeChallenge?: string | null;
  redirectPath?: string | null;
  value?: string | null;
}

/** SHA-256 (hex) of a state key; raw keys are never stored. */
export function hashExternalAuthStateKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Single-use state for external sign-in flows (SAML request ids, relay states, assertion replay cache, login codes).
 * {@link consume} deletes and returns a row in one statement so two concurrent uses cannot both succeed.
 */
@Injectable()
export class ExternalAuthStatesRepository {
  constructor(
    @InjectRepository(ExternalAuthStateEntity)
    private readonly repository: Repository<ExternalAuthStateEntity>,
  ) {}

  async save(
    kind: ExternalAuthStateKind,
    key: string,
    expiresAt: Date,
    data: ExternalAuthStateData = {},
  ): Promise<void> {
    await this.purgeExpired();
    await this.repository.insert({
      kind,
      keyHash: hashExternalAuthStateKey(key),
      tenantId: getTenantIdOrDefault(),
      expiresAt,
      ...data,
    });
  }

  /** Inserts unless the key exists (and is unexpired). Returns false when it already existed. */
  async saveIfAbsent(
    kind: ExternalAuthStateKind,
    key: string,
    expiresAt: Date,
    data: ExternalAuthStateData = {},
  ): Promise<boolean> {
    await this.purgeExpired();

    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(ExternalAuthStateEntity)
      .values({ kind, keyHash: hashExternalAuthStateKey(key), tenantId: getTenantIdOrDefault(), expiresAt, ...data })
      .orIgnore()
      .returning(['id'])
      .execute();

    return Array.isArray(result.raw) && result.raw.length > 0;
  }

  /** Reads an unexpired row without consuming it. */
  async peek(kind: ExternalAuthStateKind, key: string): Promise<ExternalAuthStateEntity | null> {
    const row = await this.repository.findOne({ where: { kind, keyHash: hashExternalAuthStateKey(key) } });

    return row && row.expiresAt.getTime() > Date.now() && row.tenantId === getTenantIdOrDefault() ? row : null;
  }

  /** Atomically deletes and returns an unexpired row of the current tenant (null when absent, expired or used). */
  async consume(kind: ExternalAuthStateKind, key: string): Promise<ExternalAuthStateEntity | null> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(ExternalAuthStateEntity)
      .where('kind = :kind AND key_hash = :keyHash', { kind, keyHash: hashExternalAuthStateKey(key) })
      .returning('*')
      .execute();
    const row = this.toEntity(Array.isArray(result.raw) ? result.raw[0] : undefined);

    if (!row) {
      return null;
    }

    if (row.expiresAt.getTime() <= Date.now() || row.tenantId !== getTenantIdOrDefault()) {
      return null;
    }

    return row;
  }

  /**
   * Atomically deletes and returns an unexpired row regardless of the current tenant context. Only for flows whose
   * tenant is carried by the state itself (SAML ACS posts arrive without a tenant header); callers must continue in
   * the returned row's tenant.
   */
  async consumeForAnyTenant(kind: ExternalAuthStateKind, key: string): Promise<ExternalAuthStateEntity | null> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(ExternalAuthStateEntity)
      .where('kind = :kind AND key_hash = :keyHash', { kind, keyHash: hashExternalAuthStateKey(key) })
      .returning('*')
      .execute();
    const row = this.toEntity(Array.isArray(result.raw) ? result.raw[0] : undefined);

    return row && row.expiresAt.getTime() > Date.now() ? row : null;
  }

  async remove(kind: ExternalAuthStateKind, key: string): Promise<void> {
    await this.repository.delete({ kind, keyHash: hashExternalAuthStateKey(key) });
  }

  private toEntity(raw: Record<string, unknown> | undefined): ExternalAuthStateEntity | null {
    if (!raw) {
      return null;
    }

    return this.repository.create({
      id: raw.id as string,
      kind: raw.kind as ExternalAuthStateKind,
      keyHash: raw.key_hash as string,
      tenantId: raw.tenant_id as string,
      userId: (raw.user_id as string | null) ?? null,
      requestId: (raw.request_id as string | null) ?? null,
      codeChallenge: (raw.code_challenge as string | null) ?? null,
      redirectPath: (raw.redirect_path as string | null) ?? null,
      value: (raw.value as string | null) ?? null,
      expiresAt: new Date(raw.expires_at as string | Date),
    });
  }

  private async purgeExpired(): Promise<void> {
    await this.repository.delete({ expiresAt: LessThan(new Date()) });
  }
}
