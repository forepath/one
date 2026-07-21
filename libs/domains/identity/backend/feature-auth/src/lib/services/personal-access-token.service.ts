import { randomBytes } from 'node:crypto';

import { UserEntity, UserPersonalAccessTokenEntity, UserRole } from '@forepath/identity/backend';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import {
  ADMIN_ONLY_PAT_SCOPES,
  DUMMY_PAT_BCRYPT_HASH,
  IDENTITY_PAT_SCOPE_CATALOG,
  PAT_LOOKUP_PREFIX_LENGTH,
  PAT_TOKEN_PREFIX,
} from '../constants/pat.constants';
import { PersonalAccessTokensRepository } from '../repositories/personal-access-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';

const BCRYPT_ROUNDS = 12;
/** Avoid writing lastUsedAt on every authenticated PAT request. */
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface CreatePatInput {
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

export interface UpdatePatInput {
  name: string;
  scopes: string[];
}

export interface PatListItem {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatePatResult extends PatListItem {
  token: string;
}

export interface VerifiedPat {
  user: UserEntity;
  scopes: string[];
  patId: string;
}

@Injectable()
export class PersonalAccessTokenService {
  constructor(
    private readonly tokensRepository: PersonalAccessTokensRepository,
    private readonly usersRepository: UsersRepository,
    @Inject(IDENTITY_PAT_SCOPE_CATALOG) private readonly scopeCatalog: readonly string[],
  ) {}

  getCatalogForRole(role: UserRole): string[] {
    const catalog = [...this.scopeCatalog];

    if (role === UserRole.ADMIN) {
      return catalog;
    }

    return catalog.filter((scope) => !ADMIN_ONLY_PAT_SCOPES.has(scope));
  }

  /** Scope catalog for the user's current DB role (not JWT role). */
  async getCatalogForUser(userId: string): Promise<string[]> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    return this.getCatalogForRole(user.role);
  }

  async listForUser(userId: string): Promise<PatListItem[]> {
    const tokens = await this.tokensRepository.findActiveByUserId(userId);

    return tokens.map((token) => this.toListItem(token));
  }

  async listForUserAdmin(userId: string): Promise<PatListItem[]> {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const tokens = await this.tokensRepository.findAllByUserId(userId);

    return tokens.map((token) => this.toListItem(token));
  }

  async create(userId: string, input: CreatePatInput): Promise<CreatePatResult> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    if (!this.isPatEligibleAccount(user)) {
      throw new BadRequestException('Personal access tokens are not available for this account.');
    }

    const name = input.name.trim();

    if (!name) {
      throw new BadRequestException('Name is required');
    }

    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration must be in the future');
    }

    // Grants follow DB role so demotion takes effect without waiting for JWT expiry.
    const scopes = this.normalizeAndValidateScopes(input.scopes, user.role);
    const plaintext = this.generatePlaintextToken();
    const tokenPrefix = plaintext.slice(0, PAT_LOOKUP_PREFIX_LENGTH);
    const tokenHash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
    const entity = await this.tokensRepository.create({
      userId,
      name,
      tokenPrefix,
      tokenHash,
      scopes,
      expiresAt: input.expiresAt ?? null,
    });

    return {
      ...this.toListItem(entity),
      token: plaintext,
    };
  }

  async update(userId: string, tokenId: string, input: UpdatePatInput): Promise<PatListItem> {
    const user = await this.usersRepository.findByIdOrThrow(userId);
    const entity = await this.tokensRepository.findById(tokenId);

    if (!entity || entity.userId !== userId || entity.revokedAt) {
      throw new NotFoundException('Token not found');
    }

    const name = input.name.trim();

    if (!name) {
      throw new BadRequestException('Name is required');
    }

    const scopes = this.normalizeAndValidateScopes(input.scopes, user.role);

    entity.name = name;
    entity.scopes = scopes;

    const saved = await this.tokensRepository.save(entity);

    return this.toListItem(saved);
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const entity = await this.tokensRepository.findById(tokenId);

    if (!entity || entity.userId !== userId) {
      throw new NotFoundException('Token not found');
    }

    if (entity.revokedAt) {
      return;
    }

    entity.revokedAt = new Date();
    await this.tokensRepository.save(entity);
  }

  async revokeAsAdmin(userId: string, tokenId: string): Promise<void> {
    const entity = await this.tokensRepository.findById(tokenId);

    if (!entity || entity.userId !== userId) {
      throw new NotFoundException('Token not found');
    }

    if (entity.revokedAt) {
      return;
    }

    entity.revokedAt = new Date();
    await this.tokensRepository.save(entity);
  }

  async verifyToken(plaintext: string): Promise<VerifiedPat> {
    if (!plaintext.startsWith(PAT_TOKEN_PREFIX) || plaintext.length < PAT_LOOKUP_PREFIX_LENGTH) {
      throw new UnauthorizedException('Invalid token');
    }

    const tokenPrefix = plaintext.slice(0, PAT_LOOKUP_PREFIX_LENGTH);
    const entity = await this.tokensRepository.findByPrefix(tokenPrefix);
    // Always bcrypt-compare to reduce timing oracles when prefix is unknown.
    const hashToCompare = entity?.tokenHash ?? DUMMY_PAT_BCRYPT_HASH;
    const valid = await bcrypt.compare(plaintext, hashToCompare);

    if (!entity || !valid || entity.revokedAt) {
      throw new UnauthorizedException('Invalid token');
    }

    if (entity.expiresAt && entity.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.usersRepository.findById(entity.userId);

    if (!user || !this.isPatEligibleAccount(user)) {
      throw new UnauthorizedException('Invalid token');
    }

    if (!user.emailConfirmedAt) {
      throw new UnauthorizedException('Invalid token');
    }

    if (user.lockedAt) {
      throw new UnauthorizedException('Invalid token');
    }

    const scopes = this.filterScopesForRole([...entity.scopes], user.role);

    if (scopes.length === 0) {
      throw new UnauthorizedException('Invalid token');
    }

    entity.lastUsedAt = new Date();
    await this.tokensRepository.touchLastUsedAtIfActive(entity.id, entity.lastUsedAt);

    return {
      user,
      scopes,
      patId: entity.id,
    };
  }

  /**
   * Live validation for an exchanged PAT JWT: reject revoked/expired tokens and
   * refresh scopes from the DB (scope updates and role demotion take effect immediately).
   */
  async assertPatJwtActive(
    patId: string,
    userId: string,
    jwtScopes: string[] | undefined,
  ): Promise<{ scopes: string[] }> {
    const entity = await this.tokensRepository.findById(patId);

    if (!entity || entity.userId !== userId || entity.revokedAt) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    if (entity.expiresAt && entity.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const user = await this.usersRepository.findById(userId);

    // Align with verifyToken: password or Keycloak-linked accounts, confirmed, not locked.
    if (!user || !this.isPatEligibleAccount(user) || !user.emailConfirmedAt || user.lockedAt) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const scopes = this.filterScopesForRole([...entity.scopes], user.role);

    if (scopes.length === 0) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const jwtSet = new Set(jwtScopes ?? []);
    const scopesMatch = scopes.length === jwtSet.size && scopes.every((scope) => jwtSet.has(scope));

    if (!scopesMatch) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const now = Date.now();
    const lastUsedMs = entity.lastUsedAt?.getTime() ?? 0;

    if (now - lastUsedMs >= LAST_USED_TOUCH_INTERVAL_MS) {
      await this.tokensRepository.touchLastUsedAtIfActive(entity.id, new Date(now));
    }

    return { scopes };
  }

  private isPatEligibleAccount(user: UserEntity): boolean {
    return Boolean(user.passwordHash || user.keycloakSub);
  }

  private filterScopesForRole(scopes: string[], role: UserRole): string[] {
    const grantable = new Set(this.getCatalogForRole(role));

    return scopes.filter((scope) => grantable.has(scope));
  }

  private normalizeAndValidateScopes(scopes: string[], actorRole: UserRole): string[] {
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new BadRequestException('At least one scope is required');
    }

    const unique = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
    const catalog = new Set(this.scopeCatalog);
    const unknown = unique.filter((scope) => !catalog.has(scope));

    if (unknown.length > 0) {
      throw new BadRequestException(`Unsupported scopes: ${unknown.join(', ')}`);
    }

    const grantable = new Set(this.getCatalogForRole(actorRole));
    const forbidden = unique.filter((scope) => !grantable.has(scope));

    if (forbidden.length > 0) {
      throw new ForbiddenException(`Cannot grant scopes: ${forbidden.join(', ')}`);
    }

    return unique;
  }

  private generatePlaintextToken(): string {
    return `${PAT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  }

  private toListItem(entity: UserPersonalAccessTokenEntity): PatListItem {
    return {
      id: entity.id,
      name: entity.name,
      tokenPrefix: entity.tokenPrefix,
      scopes: [...entity.scopes],
      expiresAt: entity.expiresAt ?? null,
      revokedAt: entity.revokedAt ?? null,
      lastUsedAt: entity.lastUsedAt ?? null,
      createdAt: entity.createdAt,
    };
  }
}
