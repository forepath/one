import {
  PlatformEmailDeliveryActionSource,
  PlatformWebhooksActionSource,
  runWithTenantId,
} from '@forepath/shared/backend';
import type { ActionCenterSource } from '@forepath/shared/backend';
import { ForbiddenException } from '@nestjs/common';

import {
  AdminActionCenterController,
  resolveBillingActionCenterViewer,
} from '../controllers/admin-action-center.controller';

import { BillingActionCenterGateway } from './billing-action-center.gateway';
import { BillingActionCenterRegistrar } from './billing-action-center.registrar';
import { BillingDocumentsActionSource } from './billing-documents.action-source';
import { BillingOperationsActionSource } from './billing-operations.action-source';
import { BillingPartnersActionSource } from './billing-partners.action-source';
import { BillingSetupActionSource } from './billing-setup.action-source';
import { DECABILL_ACTION_TYPES } from './decabill-action-center.types';

type Captured = { sql: string; params: unknown[] };

function recordingRunner(rows: (sql: string) => unknown[] = () => []) {
  const captured: Captured[] = [];

  return {
    captured,
    runner: {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        captured.push({ sql, params });

        return rows(sql);
      }),
    },
  };
}

/** Highest `$n` placeholder of a statement. */
function maxPlaceholder(sql: string): number {
  return Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
}

const context = { scopeKey: 'tenant-a', itemLimit: 200, now: new Date('2026-11-24T10:00:00Z') };

function setupSource(
  runner: unknown,
  overrides: {
    accounting?: boolean;
    missing?: string[];
    datev?: boolean;
    datevConfig?: unknown;
    global?: boolean;
  } = {},
) {
  return new BillingSetupActionSource(
    runner as never,
    {
      getMissingCorePrerequisites: () => overrides.missing ?? [],
      isEnabled: () => overrides.accounting ?? false,
      getConfig: () => ({ startDate: '2026-01-01' }),
    } as never,
    {
      isEnabled: () => overrides.datev ?? false,
      resolveForTenant: () => ('datevConfig' in overrides ? overrides.datevConfig : {}),
    } as never,
    { isGlobalViewsAllowedForTenant: () => overrides.global ?? false } as never,
  );
}

describe('Decabill action center sources', () => {
  it('pass exactly the bind values every statement references, always bound to the tenant', async () => {
    const { captured, runner } = recordingRunner();
    const sources: ActionCenterSource[] = [
      new BillingDocumentsActionSource(runner as never),
      new BillingPartnersActionSource(runner as never),
      new BillingOperationsActionSource(runner as never),
      setupSource(runner, { accounting: true, datev: true, global: true }),
      new PlatformWebhooksActionSource(runner),
      new PlatformEmailDeliveryActionSource(runner),
    ];

    for (const source of sources) {
      await source.collect(context);
    }

    expect(captured.length).toBeGreaterThan(25);

    for (const { sql, params } of captured) {
      // Postgres rejects both missing and unused bind values.
      expect({ sql: sql.slice(0, 80), count: params.length }).toEqual({
        sql: sql.slice(0, 80),
        count: maxPlaceholder(sql),
      });

      // Tenant scoping: every statement binds the tenant, except the entity-wide VAT returns (global tenants only).
      if (!sql.includes('billing_accounting_vat_returns')) {
        expect(params[0]).toBe('tenant-a');
      }
    }
  });

  it('declare only Decabill types and cover the whole catalog', () => {
    const { runner } = recordingRunner();
    const declared = [
      new BillingDocumentsActionSource(runner as never),
      new BillingPartnersActionSource(runner as never),
      new BillingOperationsActionSource(runner as never),
      setupSource(runner),
    ].flatMap((source) => source.types);

    expect([...declared].sort()).toEqual([...Object.values(DECABILL_ACTION_TYPES)].sort());
  });

  it('maps document rows to items', async () => {
    const { runner } = recordingRunner((sql) =>
      sql.includes('d.sent_at IS NULL') && sql.includes('billing_invoices')
        ? [
            {
              id: 'inv-1',
              number: 'R-1',
              customer: 'ACME',
              total_gross: '119.00',
              balance_due: '119.00',
              currency: 'EUR',
              due_date: '2026-12-01',
              at: new Date('2026-11-20T00:00:00Z'),
              total: '7',
            },
          ]
        : [],
    );
    const groups = await new BillingDocumentsActionSource(runner as never).collect(context);

    expect(groups).toEqual([
      expect.objectContaining({
        type: DECABILL_ACTION_TYPES.invoicesUnsent,
        total: 7,
        items: [
          {
            id: 'inv-1',
            occurredAt: '2026-11-20T00:00:00.000Z',
            params: {
              number: 'R-1',
              customer: 'ACME',
              totalGross: '119.00',
              balanceDue: '119.00',
              currency: 'EUR',
              dueDate: '2026-12-01',
            },
          },
        ],
      }),
    ]);
  });

  describe('setup and feature gating', () => {
    const env = process.env;

    beforeEach(() => {
      process.env = { ...env };

      for (const key of Object.keys(process.env).filter(
        (name) => name.startsWith('BILLING_ISSUER_') || name === 'BILLING_ACCOUNTING_ENABLED',
      )) {
        delete process.env[key];
      }
    });
    afterEach(() => (process.env = env));

    it('suggests the issuer setup (admins only) and skips disabled features', async () => {
      const { captured, runner } = recordingRunner((sql) =>
        sql.includes('COUNT(*) AS count') ? [{ count: '3' }] : [],
      );
      const groups = await setupSource(runner).collect(context);

      expect(groups.map((group) => [group.type, group.audience])).toEqual([
        [DECABILL_ACTION_TYPES.setupIssuer, 'admin'],
        [DECABILL_ACTION_TYPES.setupIssuerDetails, 'admin'],
      ]);
      expect(captured.some(({ sql }) => sql.includes('billing_accounting'))).toBe(false);
      expect(captured.some(({ sql }) => sql.includes('billing_datev_exports'))).toBe(false);
    });

    it('reports accounting prerequisites, DATEV config and the first customer', async () => {
      process.env['BILLING_ACCOUNTING_ENABLED'] = 'true';
      Object.assign(process.env, {
        BILLING_ISSUER_NAME: 'Forepath',
        BILLING_ISSUER_VAT_ID: 'DE1',
        BILLING_ISSUER_ADDRESS_LINE1: 'Street 1',
        BILLING_ISSUER_POSTAL_CODE: '1',
        BILLING_ISSUER_CITY: 'City',
        BILLING_ISSUER_EMAIL: 'a@b.c',
        BILLING_ISSUER_IBAN: 'DE00',
        BILLING_ISSUER_BIC: 'X',
      });

      const { runner } = recordingRunner((sql) => (sql.includes('COUNT(*) AS count') ? [{ count: '0' }] : []));
      const groups = await setupSource(runner, {
        missing: ['BILLING_ACCOUNTING_ENABLED', 'BILLING_ISSUER_COUNTRY'],
        datev: true,
        datevConfig: null,
      }).collect(context);

      expect(groups.map((group) => group.type)).toEqual([
        DECABILL_ACTION_TYPES.setupAccounting,
        DECABILL_ACTION_TYPES.setupDatev,
        DECABILL_ACTION_TYPES.setupFirstCustomer,
      ]);
      expect(groups[0].params).toEqual({ missing: 'BILLING_ISSUER_COUNTRY' });
    });

    it('limits entity-wide accounting records to tenants with global views', async () => {
      const tenantOnly = recordingRunner();

      await setupSource(tenantOnly.runner, { accounting: true }).collect(context);
      expect(tenantOnly.captured.some(({ sql }) => sql.includes('billing_accounting_vat_returns'))).toBe(false);
      expect(
        tenantOnly.captured.find(({ sql }) => sql.includes('billing_accounting_posting_issues'))?.sql,
      ).not.toContain('tenant_id IS NULL');

      const global = recordingRunner();

      await setupSource(global.runner, { accounting: true, global: true }).collect(context);
      expect(global.captured.some(({ sql }) => sql.includes('billing_accounting_vat_returns'))).toBe(true);
      expect(global.captured.find(({ sql }) => sql.includes('billing_accounting_posting_issues'))?.sql).toContain(
        'tenant_id IS NULL',
      );
    });
  });
});

describe('AdminActionCenterController (Decabill)', () => {
  const request = (user: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
    ({ user, ...extra }) as never;

  it('resolves admins and managers of the request tenant', () => {
    expect(
      runWithTenantId('tenant-a', () => resolveBillingActionCenterViewer(request({ id: 'u-1', roles: ['manager'] }))),
    ).toEqual({ userId: 'u-1', role: 'manager', scopeKey: 'tenant-a' });
  });

  it('accepts personal access tokens of admins (scope enforced by the PAT guard)', () => {
    expect(
      runWithTenantId('tenant-a', () =>
        resolveBillingActionCenterViewer(
          request({ id: 'u-1', roles: ['admin'], amr: ['pat'], scopes: ['action_center:admin'] }),
        ),
      ),
    ).toEqual({ userId: 'u-1', role: 'admin', scopeKey: 'tenant-a', groupFilter: expect.any(Function) });
  });

  it.each([
    ['regular users', request({ id: 'u-1', roles: ['user'] })],
    ['the static credential', request(undefined, { apiKeyAuthenticated: true })],
    ['anonymous requests', request(undefined)],
  ])('rejects %s', (_label, req) => {
    expect(() => resolveBillingActionCenterViewer(req)).toThrow(ForbiddenException);
  });

  it('limits personal access tokens to the groups of their domain scopes', () => {
    const viewer = runWithTenantId('tenant-a', () =>
      resolveBillingActionCenterViewer(
        request({ id: 'u-1', roles: ['admin'], amr: ['pat'], scopes: ['action_center:admin', 'invoices:admin'] }),
      ),
    );

    expect(viewer.groupFilter?.('decabill.invoices.unsent', 'receivables')).toBe(true);
    expect(viewer.groupFilter?.('decabill.accounting.bank_unmatched', 'accounting')).toBe(false);
    expect(viewer.groupFilter?.('decabill.datev.export_failed', 'accounting')).toBe(false);
    expect(viewer.groupFilter?.('platform.webhooks.failing', 'platform')).toBe(false);
  });

  it('gives console sessions every group (no filter)', () => {
    const viewer = runWithTenantId('tenant-a', () =>
      resolveBillingActionCenterViewer(request({ id: 'u-1', roles: ['admin'], amr: ['pwd'] })),
    );

    expect(viewer.groupFilter).toBeUndefined();
  });

  it('delegates to the action center with the resolved viewer', async () => {
    const actionCenter = {
      getView: jest.fn().mockResolvedValue('view'),
      silence: jest.fn().mockResolvedValue('view'),
      unsilence: jest.fn().mockResolvedValue('view'),
    };
    const controller = new AdminActionCenterController(actionCenter as never);
    const req = request({ id: 'u-1', roles: ['admin'] });

    await runWithTenantId('tenant-a', async () => {
      await controller.getView(req);
      await controller.createSilence(req, { itemType: 'decabill.invoices.unsent', audience: 'everyone' });
      await controller.removeSilence(req, 's-1');
    });

    const viewer = { userId: 'u-1', role: 'admin', scopeKey: 'tenant-a' };

    expect(actionCenter.getView).toHaveBeenCalledWith(viewer);
    expect(actionCenter.silence).toHaveBeenCalledWith(viewer, {
      itemType: 'decabill.invoices.unsent',
      audience: 'everyone',
    });
    expect(actionCenter.unsilence).toHaveBeenCalledWith(viewer, 's-1');
  });
});

describe('BillingActionCenterGateway', () => {
  function setup(userInfo: unknown, user: unknown) {
    const socketAuthService = { validateAndGetUser: jest.fn().mockResolvedValue(userInfo) };
    const usersRepository = { findByIdForTenant: jest.fn().mockResolvedValue(user) };
    const gateway = new BillingActionCenterGateway({} as never, socketAuthService as never, usersRepository as never);
    const socket = {
      handshake: { headers: { authorization: 'Bearer t', 'x-tenant': 'default' }, auth: {} },
      request: { socket: {} },
    };
    const authenticate = () =>
      (gateway as unknown as { authenticate: (s: unknown) => Promise<unknown> }).authenticate(socket);

    return { authenticate, socketAuthService, usersRepository };
  }

  const interactive = { userId: 'u-1', userRole: 'admin', isApiKeyAuth: false, amr: ['pwd'] };

  it('accepts interactive admins / managers with their current role from the users table', async () => {
    const { authenticate, socketAuthService, usersRepository } = setup(interactive, {
      id: 'u-1',
      role: 'manager',
      lockedAt: null,
    });
    const result = (await authenticate()) as { viewer: unknown; revalidate: () => Promise<unknown> };

    expect(result.viewer).toEqual({ userId: 'u-1', role: 'manager', scopeKey: 'default' });
    // Machine tokens are rejected by the auth service itself: no `websocket` option.
    expect(socketAuthService.validateAndGetUser).toHaveBeenCalledWith('Bearer t', 'default', { transportSocket: {} });
    expect(usersRepository.findByIdForTenant).toHaveBeenCalledWith('u-1', 'default');

    usersRepository.findByIdForTenant.mockResolvedValueOnce({ id: 'u-1', role: 'user', lockedAt: null });
    expect(await result.revalidate()).toBeNull();
  });

  it.each([
    ['invalid tokens', null, { role: 'admin' }],
    ['the static credential', { isApiKeyAuth: true }, { role: 'admin' }],
    ['machine tokens', { ...interactive, amr: ['pat'] }, { role: 'admin' }],
    ['regular users', interactive, { role: 'user', lockedAt: null }],
    ['locked users', interactive, { role: 'admin', lockedAt: new Date() }],
    ['users of another tenant', interactive, null],
  ])('rejects %s', async (_label, userInfo, user) => {
    expect(await setup(userInfo, user).authenticate()).toBeNull();
  });
});

describe('BillingActionCenterRegistrar', () => {
  it('registers the sources, signals published events and publishes silence changes as webhooks', () => {
    const registry = { register: jest.fn() };
    let silenceListener: ((change: unknown) => void) | undefined;
    let publishListener: ((type: string, scope: string) => void) | undefined;
    const claims = new Set<string>();
    const actionCenter = {
      claimWiring: jest.fn((key: string) => (claims.has(key) ? false : (claims.add(key), true))),
      signalChange: jest.fn(),
      onSilenceChange: jest.fn((listener) => ((silenceListener = listener), () => undefined)),
    };
    const publisher = {
      publish: jest.fn(),
      addListener: jest.fn((listener) => ((publishListener = listener), () => undefined)),
    };
    const registrar = new BillingActionCenterRegistrar(
      registry as never,
      actionCenter as never,
      publisher as never,
      {} as never,
      { getStatusSummary: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    registrar.onModuleInit();
    // A second instance of the billing module (app + queue module) must not wire twice.
    registrar.onModuleInit();

    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(publisher.addListener).toHaveBeenCalledTimes(1);
    expect(registry.register.mock.calls[0]).toHaveLength(7);
    publishListener?.('invoice.issued', 'tenant-a');
    expect(actionCenter.signalChange).toHaveBeenCalledWith('tenant-a');

    // Personal silences stay private: no webhook.
    silenceListener?.({
      change: 'created',
      actor: { userId: 'u-1' },
      silence: { id: 's-0', itemType: 'decabill.invoices.unsent', itemId: null, audience: 'self', until: null },
    });
    expect(publisher.publish).not.toHaveBeenCalled();

    silenceListener?.({
      change: 'removed',
      actor: { userId: 'u-1' },
      silence: { id: 's-1', itemType: 'decabill.invoices.unsent', itemId: 'inv-1', audience: 'everyone', until: null },
    });
    expect(publisher.publish).toHaveBeenCalledWith('action_center.silence.removed', {
      silenceId: 's-1',
      itemType: 'decabill.invoices.unsent',
      itemId: 'inv-1',
      audience: 'everyone',
      until: null,
      actorUserId: 'u-1',
    });
  });
});
