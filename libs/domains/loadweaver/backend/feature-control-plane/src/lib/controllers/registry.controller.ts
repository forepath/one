import { getUserFromRequest, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { REGISTRY_TOKEN_SERVICE } from '../object-store/registry-state.utils';
import { grantRegistryAccess, parseRegistryScopes } from '../registry/registry-scope.utils';
import { ClusterAccessService } from '../services/cluster-access.service';
import { RegistryTokenService } from '../services/registry-token.service';

/** User tokens for `docker login` / `docker push` are short; Docker fetches new ones as needed. */
export const USER_REGISTRY_TOKEN_SECONDS = 300;

/**
 * Token realm of the built-in private registry (Docker token authentication, 3.22). Credentials are the usual API
 * key or personal access token, sent by `docker login` as the password.
 */
@Controller('registry')
export class RegistryController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: RegistryTokenService,
    private readonly access: ClusterAccessService,
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

    // Plain `docker login` asks without a scope; it only needs proof that the credentials work.
    await this.access.assert(req, 'read');

    const requested = parseRegistryScopes(Array.isArray(scope) ? scope : scope ? scope.split(' ') : []);
    const projects = new Set(
      (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } })).map((p) => p.name),
    );
    const caller = getUserFromRequest(req || ({} as RequestWithUser));
    // A personal access token pushes only with the `registry:push` scope; its owner's role applies as well.
    const pushScope = !(caller.amr ?? []).includes('pat') || (caller.scopes ?? []).includes('registry:push');
    const granted = grantRegistryAccess(requested, projects, {
      pull: true,
      push: pushScope && (await this.access.can(req, 'infra')),
    });
    const token = await this.tokens.issue(
      caller.isApiKeyAuth ? 'api-key' : `user:${caller.userId ?? 'unknown'}`,
      granted,
      USER_REGISTRY_TOKEN_SECONDS,
    );

    return { token, access_token: token, expires_in: USER_REGISTRY_TOKEN_SECONDS, issued_at: new Date().toISOString() };
  }
}
