import {
  getMissingPatScopes,
  getUserFromRequest,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  ActionCenterService,
  CreateActionCenterSilenceDto,
  INSTANCE_SCOPE_KEY,
  toActionCenterViewerRole,
  type ActionCenterView,
  type ActionCenterViewer,
} from '@forepath/shared/backend';
import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { ClientsService } from '../services/clients.service';

/**
 * Action center (to-dos / next steps across all workspaces) for admins and managers (enforced here, like the other
 * Agenstra admin controllers): console sessions and personal access tokens with `action_center:admin`. Like the
 * admin overview, PATs get no console-admin bypass: their view only holds items of workspaces the token's user is a
 * member of (instance-wide items stay). The static credential has no user (no silences) and gets no view.
 */
@Controller('admin/action-center')
@RequireScopes('action_center:admin')
export class AdminActionCenterController {
  constructor(
    private readonly actionCenter: ActionCenterService,
    private readonly clientsService: ClientsService,
  ) {}

  @Get()
  async getView(@Req() req: RequestWithUser): Promise<ActionCenterView> {
    return await this.actionCenter.getView(await this.resolveViewer(req));
  }

  @Post('silences')
  async createSilence(
    @Req() req: RequestWithUser,
    @Body() dto: CreateActionCenterSilenceDto,
  ): Promise<ActionCenterView> {
    return await this.actionCenter.silence(await this.resolveViewer(req), dto);
  }

  @Delete('silences/:silenceId')
  async removeSilence(
    @Req() req: RequestWithUser,
    @Param('silenceId', new ParseUUIDPipe()) silenceId: string,
  ): Promise<ActionCenterView> {
    return await this.actionCenter.unsilence(await this.resolveViewer(req), silenceId);
  }

  private async resolveViewer(req: RequestWithUser): Promise<ActionCenterViewer> {
    const viewer = resolveAgenstraActionCenterViewer(req);
    const user = getUserFromRequest(req);

    if (!(user.amr ?? []).includes('pat')) {
      return viewer;
    }

    const accessible = await this.clientsService.getAccessibleClientIds(user.userId, user.userRole, false, {
      amr: user.amr,
    });
    const granted = user.scopes ?? [];

    return {
      ...viewer,
      restriction: { param: 'clientId', values: accessible },
      groupFilter: (type, category) =>
        getMissingPatScopes(granted, [agenstraActionCenterScopeFor(type, category)]).length === 0,
    };
  }
}

/**
 * Domain scope a personal access token needs (besides `action_center:admin`) to see a group: the action center never
 * shows a token more than the domain routes would.
 */
const TYPE_SCOPES: Readonly<Record<string, string>> = {
  'agenstra.agents.config_sync_failed': 'clients:admin',
  'agenstra.handoffs.failed': 'agent_chats:read',
  'platform.webhooks.failing': 'webhooks:admin',
  'platform.updates.available': 'updates:admin',
};
const CATEGORY_SCOPES: Readonly<Record<string, string>> = {
  setup: 'clients:admin',
  workspaces: 'clients:read',
  tickets: 'tickets:read',
  automation: 'agent_chats:read',
  deployments: 'deployments:read',
  integrations: 'connections:admin',
  platform: 'clients:admin',
};

/** Scope required for a group (unknown categories: `clients:admin`). */
export function agenstraActionCenterScopeFor(type: string, category: string): string {
  return TYPE_SCOPES[type] ?? CATEGORY_SCOPES[category] ?? 'clients:admin';
}

/** The signed-in admin / manager (session or PAT); users and the static credential are rejected. */
export function resolveAgenstraActionCenterViewer(req: RequestWithUser): ActionCenterViewer {
  const user = getUserFromRequest(req);
  const role = toActionCenterViewerRole(user.userRole);

  if (user.isApiKeyAuth || !user.userId || !role) {
    throw new ForbiddenException('The action center is available to signed-in admins and managers only');
  }

  return { userId: user.userId, role, scopeKey: INSTANCE_SCOPE_KEY };
}
