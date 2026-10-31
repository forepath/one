import { getUserFromRequest, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { ResourceEntity } from '../entities/resource.entity';
import { REGISTRY_TOKEN_SERVICE } from '../object-store/registry-state.utils';
import {
  grantRegistryAccess,
  mayUseRegistry,
  parseRegistryScopes,
  requestsRegistryCatalog,
} from '../registry/registry-scope.utils';
import { RegistryTokenService } from '../services/registry-token.service';

/** User tokens for `docker login` / `docker push` are short; Docker fetches new ones as needed. */
export const USER_REGISTRY_TOKEN_SECONDS = 300;

/**
 * Token realm of the built-in private registry (Docker token authentication, 3.22). Credentials are the usual API
 * key or personal access token, sent by `docker login` as the password. Access follows the caller's project roles.
 */
@Controller('registry')
export class RegistryController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: RegistryTokenService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('token')
  @RequireScopes('registry:pull')
  async token(
    @Query('service') service?: string,
    @Query('scope') scope?: string | string[],
    @Req() req?: RequestWithUser,
  ): Promise<{ token: string; access_token: string; expires_in: number; issued_at: string }> {
    if (service !== undefined && service !== REGISTRY_TOKEN_SERVICE)
      throw new BadRequestException('unknown registry service');

    // Project roles decide (2026-10-26): no cluster role is needed for project repositories.
    const caller = await this.projectAccess.caller(req);

    // Plain `docker login` asks without a scope; it only needs proof that the credentials work.
    if (!mayUseRegistry(caller)) throw new ForbiddenException('Missing project membership');

    const scopes = Array.isArray(scope) ? scope : scope ? scope.split(' ') : [];
    const requested = parseRegistryScopes(scopes);
    const projects = new Set(
      (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } })).map((p) => p.name),
    );
    const user = getUserFromRequest(req || ({} as RequestWithUser));
    // A personal access token pushes only with the `registry:push` scope; its owner's role applies as well.
    const pushScope = !(user.amr ?? []).includes('pat') || (user.scopes ?? []).includes('registry:push');
    const granted = grantRegistryAccess(requested, projects, caller, { push: pushScope });
    const subject = user.isApiKeyAuth ? 'api-key' : `user:${user.userId ?? 'unknown'}`;
    // The repository catalog lists every project's repositories: cluster roles only.
    const token =
      requestsRegistryCatalog(scopes) && caller.clusterRole
        ? await this.tokens.issueWithCatalog(subject, granted, USER_REGISTRY_TOKEN_SECONDS)
        : await this.tokens.issue(subject, granted, USER_REGISTRY_TOKEN_SECONDS);

    return { token, access_token: token, expires_in: USER_REGISTRY_TOKEN_SECONDS, issued_at: new Date().toISOString() };
  }
}
