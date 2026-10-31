import { NotFoundException } from '@nestjs/common';

import { SubscriptionStatus } from '../../entities/subscription.entity';
import type { SubscriptionItemsRepository } from '../../repositories/subscription-items.repository';
import type { SubscriptionsRepository } from '../../repositories/subscriptions.repository';

import { fetchLoadweaverProbe, LoadweaverClusterService } from './loadweaver-cluster.service';

describe('LoadweaverClusterService', () => {
  const subscriptions = { findByIdOrThrow: jest.fn() };
  const items = { findByIdAndSubscriptionId: jest.fn(), updateConfigSnapshot: jest.fn() };
  const token = `lwc_${'A'.repeat(43)}`;
  const probe = jest.fn();
  let service: LoadweaverClusterService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.DNS_BASE_DOMAIN = 'spirde.com';
    delete process.env.LOADWEAVER_TEARDOWN_GRACE_DAYS;
    service = new LoadweaverClusterService(
      subscriptions as unknown as SubscriptionsRepository,
      items as unknown as SubscriptionItemsRepository,
    );
    service.useProbe(probe);
    subscriptions.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      status: SubscriptionStatus.ACTIVE,
    });
    items.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      hostname: 'lw-a1b2',
      provisioningStatus: 'active',
      providerReference: 'srv-1',
      provisionedAt: new Date('2026-01-01T00:00:00Z'),
      configSnapshot: { service: 'loadweaver', loadweaverVersion: '1.4.0' },
    });
  });

  afterAll(() => {
    delete process.env.DNS_BASE_DOMAIN;
  });

  it('returns endpoint, links and health from public probes', async () => {
    probe.mockResolvedValue({ ok: true, status: 200 });

    const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

    expect(probe).toHaveBeenCalledWith('https://lw-a1b2.spirde.com/api/health');
    expect(probe).toHaveBeenCalledWith('https://lw-a1b2.spirde.com/');
    expect(info).toMatchObject({
      consoleUrl: 'https://lw-a1b2.spirde.com',
      apiUrl: 'https://lw-a1b2.spirde.com/api',
      installerUrl: 'https://lw-a1b2.spirde.com/api/install/install.sh',
      health: 'healthy',
      initialVersion: '1.4.0',
      links: { platformBackups: 'https://lw-a1b2.spirde.com/backups/platform' },
      teardown: { graceDays: 7, deletionNotBefore: null },
    });
  });

  it('shows the deletion date of a pending cancellation', async () => {
    probe.mockResolvedValue({ ok: false });
    subscriptions.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      status: SubscriptionStatus.PENDING_CANCEL,
      cancelEffectiveAt: new Date('2026-11-01T00:00:00Z'),
    });

    const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

    expect(info.health).toBe('unreachable');
    expect(info.teardown.deletionNotBefore).toBe('2026-11-08T00:00:00.000Z');
  });

  it('does not probe before provisioning finished', async () => {
    items.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      hostname: null,
      provisioningStatus: 'pending',
      configSnapshot: { service: 'loadweaver' },
    });

    const info = await service.getClusterInfo('sub-1', 'item-1', { asAdmin: true });

    expect(probe).not.toHaveBeenCalled();
    expect(info.health).toBe('provisioning');
    expect(info.consoleUrl).toBeNull();
  });

  it("hides other customers' and non-Loadweaver items", async () => {
    await expect(service.getClusterInfo('sub-1', 'item-1', { userId: 'other' })).rejects.toThrow(NotFoundException);

    items.findByIdAndSubscriptionId.mockResolvedValue({
      id: 'item-1',
      configSnapshot: { service: 'decabill-billing' },
    });

    await expect(service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' })).rejects.toThrow(NotFoundException);
  });

  describe('admin claim', () => {
    const snapshot = { service: 'loadweaver', loadweaverAdminClaimToken: token };

    beforeEach(() => {
      items.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'item-1',
        hostname: 'lw-a1b2',
        provisioningStatus: 'active',
        providerReference: 'srv-1',
        provisionedAt: new Date('2026-01-01T00:00:00Z'),
        configSnapshot: snapshot,
      });
    });

    it('shows the token to the customer while the cluster still requires the claim', async () => {
      probe.mockImplementation(async (url: string) =>
        url.endsWith('/claim-status') ? { ok: true, status: 200, claimRequired: true } : { ok: true, status: 200 },
      );

      const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

      expect(probe).toHaveBeenCalledWith('https://lw-a1b2.spirde.com/api/install/claim-status');
      expect(info.adminClaim).toEqual({ status: 'pending', token });
      expect(items.updateConfigSnapshot).not.toHaveBeenCalled();
    });

    it('never shows the token in the admin view', async () => {
      probe.mockImplementation(async (url: string) =>
        url.endsWith('/claim-status') ? { ok: true, status: 200, claimRequired: true } : { ok: true, status: 200 },
      );

      const info = await service.getClusterInfo('sub-1', 'item-1', { asAdmin: true });

      expect(info.adminClaim).toEqual({ status: 'pending', token: null });
    });

    it('keeps the token while the cluster is unreachable', async () => {
      probe.mockResolvedValue({ ok: false });

      const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

      expect(info.adminClaim).toEqual({ status: 'unknown', token });
      expect(items.updateConfigSnapshot).not.toHaveBeenCalled();
    });

    it('wipes the token once the cluster reports the claim done', async () => {
      probe.mockImplementation(async (url: string) =>
        url.endsWith('/claim-status')
          ? { ok: true, status: 200, claimRequired: false, claimConfigured: true }
          : { ok: true, status: 200 },
      );

      const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

      expect(info.adminClaim).toEqual({ status: 'claimed', token: null });
      expect(items.updateConfigSnapshot).toHaveBeenCalledWith('item-1', {
        service: 'loadweaver',
        loadweaverAdminClaimedAt: expect.any(String),
      });
    });

    it('keeps the token when the cluster does not say the claim is configured (older release / member without hash)', async () => {
      for (const claim of [
        { ok: true, status: 200, claimRequired: false },
        { ok: true, status: 200, claimRequired: false, claimConfigured: false },
      ]) {
        probe.mockImplementation(async (url: string) =>
          url.endsWith('/claim-status') ? claim : { ok: true, status: 200 },
        );

        const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

        expect(info.adminClaim).toEqual({ status: 'unknown', token });
      }

      expect(items.updateConfigSnapshot).not.toHaveBeenCalled();
    });

    it('reads claimConfigured from the public claim-status answer', async () => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ claimRequired: false, claimConfigured: true }), { status: 200 }),
        );

      try {
        await expect(fetchLoadweaverProbe('https://lw-a1b2.spirde.com/api/install/claim-status')).resolves.toEqual({
          ok: true,
          status: 200,
          claimRequired: false,
          claimConfigured: true,
        });
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ claimRequired: false }), { status: 200 }));
        await expect(fetchLoadweaverProbe('https://lw-a1b2.spirde.com/api/install/claim-status')).resolves.toEqual({
          ok: true,
          status: 200,
          claimRequired: false,
        });
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('does not probe the claim again after it was recorded', async () => {
      items.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'item-1',
        hostname: 'lw-a1b2',
        provisioningStatus: 'active',
        providerReference: 'srv-1',
        configSnapshot: { service: 'loadweaver', loadweaverAdminClaimedAt: '2026-01-02T00:00:00.000Z' },
      });
      probe.mockResolvedValue({ ok: true, status: 200 });

      const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

      expect(probe).not.toHaveBeenCalledWith('https://lw-a1b2.spirde.com/api/install/claim-status');
      expect(info.adminClaim).toEqual({ status: 'claimed', token: null });
      expect(items.updateConfigSnapshot).not.toHaveBeenCalled();
    });

    it('uses the teardown time stored at cancellation', async () => {
      probe.mockResolvedValue({ ok: false });
      subscriptions.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        status: SubscriptionStatus.PENDING_CANCEL,
        cancelEffectiveAt: new Date('2026-11-01T00:00:00Z'),
        teardownNotBefore: new Date('2026-11-04T00:00:00Z'),
      });

      const info = await service.getClusterInfo('sub-1', 'item-1', { userId: 'user-1' });

      expect(info.teardown.deletionNotBefore).toBe('2026-11-04T00:00:00.000Z');
    });
  });
});
