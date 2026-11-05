import { IdentityAppEntity, UserRole } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { APP_SECRET_DISPLAY_PREFIX_LENGTH, APP_SECRET_PREFIX } from '../constants/app.constants';
import { IDENTITY_PAT_SCOPE_CATALOG } from '../constants/pat.constants';
import { IdentityAppsRepository, type IdentityAppGrantWithRelations } from '../repositories/identity-apps.repository';
import { evaluateAppScopes, generateAppCredential, normalizeAppReturnUrl } from '../utils/identity-app.utils';

import { PersonalAccessTokenService } from './personal-access-token.service';

const BCRYPT_ROUNDS = 12;

export interface IdentityAppInput {
  name: string;
  description?: string | null;
  returnUrl: string;
  scopes: string[];
}

export interface IdentityAppResponse {
  id: string;
  name: string;
  description: string | null;
  returnUrl: string;
  scopes: string[];
  secretPrefix: string;
  secretRotatedAt: string | null;
  grantCount: number;
  createdAt: string;
  updatedAt: string;
  /** Plaintext secret; present only on create and rotate. */
  secret?: string;
}

export interface IdentityAppGrantResponse {
  id: string;
  appId: string;
  appName: string;
  appDescription: string | null;
  userId: string;
  userEmail: string;
  /** Scopes the user consented to. */
  consentedScopes: string[];
  /** Scopes app tokens currently carry (consented ∩ app scopes ∩ user role). */
  scopes: string[];
  needsReauthorization: boolean;
  sessionCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Admin app management (tenant-scoped) and grant listing/revocation for admins and the granting user.
 * App scopes may be any catalog scope; what a user can grant is capped at consent time and on every use.
 */
@Injectable()
export class IdentityAppsService {
  constructor(
    private readonly repository: IdentityAppsRepository,
    private readonly patService: PersonalAccessTokenService,
    @Inject(IDENTITY_PAT_SCOPE_CATALOG) private readonly scopeCatalog: readonly string[],
  ) {}

  async list(): Promise<IdentityAppResponse[]> {
    const apps = await this.repository.listAppsForTenant(getTenantIdOrDefault());
    const counts = await this.repository.countGrantsByApp(apps.map((app) => app.id));

    return apps.map((app) => this.toResponse(app, counts.get(app.id) ?? 0));
  }

  async get(id: string): Promise<IdentityAppResponse> {
    const app = await this.findOrThrow(id);
    const counts = await this.repository.countGrantsByApp([app.id]);

    return this.toResponse(app, counts.get(app.id) ?? 0);
  }

  async create(actorUserId: string, input: IdentityAppInput): Promise<IdentityAppResponse> {
    const normalized = this.normalizeInput(input);
    const secret = generateAppCredential(APP_SECRET_PREFIX);
    const app = await this.repository.createApp({
      ...normalized,
      tenantId: getTenantIdOrDefault(),
      secretPrefix: secret.slice(0, APP_SECRET_DISPLAY_PREFIX_LENGTH),
      secretHash: await bcrypt.hash(secret, BCRYPT_ROUNDS),
      createdByUserId: actorUserId,
    });

    return { ...this.toResponse(app, 0), secret };
  }

  async update(id: string, input: IdentityAppInput): Promise<IdentityAppResponse> {
    const app = await this.findOrThrow(id);
    const normalized = this.normalizeInput(input);

    app.name = normalized.name;
    app.description = normalized.description;
    app.returnUrl = normalized.returnUrl;
    // Removed scopes leave every token at once (effective scopes are recomputed per request);
    // added scopes need the user's re-authorization before tokens carry them.
    app.scopes = normalized.scopes;

    const saved = await this.repository.saveApp(app);

    return this.get(saved.id);
  }

  /** New secret (shown once). Existing sessions keep working; refreshes need the new secret. */
  async rotateSecret(id: string): Promise<IdentityAppResponse> {
    const app = await this.findOrThrow(id);
    const secret = generateAppCredential(APP_SECRET_PREFIX);

    app.secretPrefix = secret.slice(0, APP_SECRET_DISPLAY_PREFIX_LENGTH);
    app.secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    app.secretRotatedAt = new Date();

    await this.repository.saveApp(app);

    return { ...(await this.get(id)), secret };
  }

  /** Deletes the app with all grants, sessions and codes (cascade); its tokens stop working immediately. */
  async remove(id: string): Promise<void> {
    const app = await this.findOrThrow(id);

    await this.repository.deleteApp(app.id);
  }

  async listGrants(appId: string): Promise<IdentityAppGrantResponse[]> {
    const app = await this.findOrThrow(appId);

    return (await this.repository.listGrantsForApp(app.id)).map((item) => this.toGrantResponse(item));
  }

  /** Revoke one user's authorization: kills its sessions and forces the full consent flow next time. */
  async revokeGrant(appId: string, grantId: string): Promise<void> {
    const app = await this.findOrThrow(appId);
    const grant = await this.repository.findGrantById(grantId);

    if (!grant || grant.appId !== app.id) {
      throw new NotFoundException('Authorization not found');
    }

    await this.repository.deleteGrant(grant.id);
  }

  async revokeAllGrants(appId: string): Promise<{ revoked: number }> {
    const app = await this.findOrThrow(appId);

    return { revoked: await this.repository.deleteGrantsByApp(app.id) };
  }

  async listOwnGrants(userId: string): Promise<IdentityAppGrantResponse[]> {
    const items = await this.repository.listGrantsForUser(userId, getTenantIdOrDefault());

    return items.map((item) => this.toGrantResponse(item));
  }

  async revokeOwnGrant(userId: string, grantId: string): Promise<void> {
    const grant = await this.repository.findGrantById(grantId);

    if (!grant || grant.userId !== userId || grant.tenantId !== getTenantIdOrDefault()) {
      throw new NotFoundException('Authorization not found');
    }

    await this.repository.deleteGrant(grant.id);
  }

  private async findOrThrow(id: string): Promise<IdentityAppEntity> {
    const app = await this.repository.findAppForTenant(id, getTenantIdOrDefault());

    if (!app) {
      throw new NotFoundException('App not found');
    }

    return app;
  }

  private normalizeInput(input: IdentityAppInput): Required<IdentityAppInput> {
    const name = input.name?.trim();

    if (!name) {
      throw new BadRequestException('Name is required');
    }

    const description = input.description?.trim() || null;
    const returnUrl = normalizeAppReturnUrl(input.returnUrl ?? '');

    if (!returnUrl) {
      throw new BadRequestException(
        'Return URL must be an absolute https URL (http only for localhost) without credentials or fragment.',
      );
    }

    if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
      throw new BadRequestException('At least one scope is required');
    }

    const scopes = [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))];
    const catalog = new Set(this.scopeCatalog);
    const unknown = scopes.filter((scope) => !catalog.has(scope));

    if (unknown.length > 0) {
      throw new BadRequestException(`Unsupported scopes: ${unknown.join(', ')}`);
    }

    return { name, description, returnUrl, scopes };
  }

  private toResponse(app: IdentityAppEntity, grantCount: number): IdentityAppResponse {
    return {
      id: app.id,
      name: app.name,
      description: app.description ?? null,
      returnUrl: app.returnUrl,
      scopes: [...app.scopes],
      secretPrefix: app.secretPrefix,
      secretRotatedAt: app.secretRotatedAt?.toISOString() ?? null,
      grantCount,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
    };
  }

  private toGrantResponse(item: IdentityAppGrantWithRelations): IdentityAppGrantResponse {
    const evaluation = evaluateAppScopes({
      appScopes: item.app.scopes,
      catalog: this.scopeCatalog,
      roleCatalog: this.patService.getCatalogForRole(item.user.role ?? UserRole.USER),
      consentedScopes: item.grant.scopes,
    });
    const lastUsedAt = item.lastSessionUsedAt ?? item.grant.lastUsedAt ?? null;

    return {
      id: item.grant.id,
      appId: item.app.id,
      appName: item.app.name,
      appDescription: item.app.description ?? null,
      userId: item.user.id,
      userEmail: item.user.email,
      consentedScopes: [...item.grant.scopes],
      scopes: evaluation.effective,
      needsReauthorization: evaluation.needsReauthorization,
      sessionCount: item.sessionCount,
      lastUsedAt: lastUsedAt?.toISOString() ?? null,
      createdAt: item.grant.createdAt.toISOString(),
      updatedAt: item.grant.updatedAt.toISOString(),
    };
  }
}
