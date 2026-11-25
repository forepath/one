import {
  getMissingPatScopes,
  RequireScopes,
  UserRole,
  UsersRoles,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  ActionCenterService,
  CreateActionCenterSilenceDto,
  getTenantIdOrDefault,
  toActionCenterViewerRole,
  type ActionCenterView,
  type ActionCenterViewer,
} from '@forepath/shared/backend';
import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { getUserFromRequest } from '../utils/billing-access.utils';

/**
 * Action center (to-dos / next steps of the request tenant) for admins and managers: console sessions and personal
 * access tokens with `action_center:admin`. The static credential has no user (no silences) and gets no view.
 */
@Controller('admin/billing/action-center')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
@RequireScopes('action_center:admin')
export class AdminActionCenterController {
  constructor(private readonly actionCenter: ActionCenterService) {}

  @Get()
  async getView(@Req() req: RequestWithUser): Promise<ActionCenterView> {
    return await this.actionCenter.getView(resolveBillingActionCenterViewer(req));
  }

  @Post('silences')
  async createSilence(
    @Req() req: RequestWithUser,
    @Body() dto: CreateActionCenterSilenceDto,
  ): Promise<ActionCenterView> {
    return await this.actionCenter.silence(resolveBillingActionCenterViewer(req), dto);
  }

  @Delete('silences/:silenceId')
  async removeSilence(
    @Req() req: RequestWithUser,
    @Param('silenceId', new ParseUUIDPipe()) silenceId: string,
  ): Promise<ActionCenterView> {
    return await this.actionCenter.unsilence(resolveBillingActionCenterViewer(req), silenceId);
  }
}

/**
 * Domain scope a personal access token needs (besides `action_center:admin`) to see a group: the action center never
 * shows a token more than the domain routes would.
 */
const TYPE_SCOPES: Readonly<Record<string, string>> = {
  'decabill.datev.export_failed': 'datev:admin',
  'decabill.spooler.failed': 'spooler:admin',
  'decabill.letters.attention': 'letters:admin',
  'decabill.suppliers.incomplete': 'supplier_profile:admin',
  'platform.webhooks.failing': 'webhooks:admin',
  'platform.updates.available': 'updates:admin',
};
const CATEGORY_SCOPES: Readonly<Record<string, string>> = {
  setup: 'billing:admin',
  receivables: 'invoices:admin',
  offers: 'offers:admin',
  payables: 'supplier_invoices:admin',
  customers: 'customer_profile:admin',
  subscriptions: 'subscriptions:admin',
  inventory: 'inventory:admin',
  accounting: 'accounting_audit:admin',
  platform: 'billing:admin',
};

/** Scope required for a group (unknown categories: `billing:admin`). */
export function billingActionCenterScopeFor(type: string, category: string): string {
  return TYPE_SCOPES[type] ?? CATEGORY_SCOPES[category] ?? 'billing:admin';
}

/** The signed-in admin / manager of the request tenant; everyone else is rejected. */
export function resolveBillingActionCenterViewer(req: RequestWithUser): ActionCenterViewer {
  const userInfo = getUserFromRequest(req);
  const role = toActionCenterViewerRole(userInfo.userRole);

  if (userInfo.isApiKeyAuth || !userInfo.userId || !role) {
    throw new ForbiddenException('The action center is available to signed-in admins and managers only');
  }

  const viewer: ActionCenterViewer = { userId: userInfo.userId, role, scopeKey: getTenantIdOrDefault() };

  if (!(userInfo.amr ?? []).includes('pat')) {
    return viewer;
  }

  const granted = userInfo.scopes ?? [];

  return {
    ...viewer,
    groupFilter: (type, category) =>
      getMissingPatScopes(granted, [billingActionCenterScopeFor(type, category)]).length === 0,
  };
}
