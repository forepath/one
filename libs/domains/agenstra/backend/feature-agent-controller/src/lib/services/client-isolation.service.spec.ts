import type { HostIsolationCapabilitiesDto } from '@forepath/agenstra/backend/feature-agent-manager';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import type { ClientIsolationSnapshotEntity } from '../entities/client-isolation-snapshot.entity';
import type { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';

import { ClientIsolationService, redactErrorMessage } from './client-isolation.service';

function capabilities(
  standard = 'ready',
  sandboxed = 'ready',
  revision = 'sha256:current',
  probedAt: string | null = '2026-10-15T20:00:00.000Z',
): HostIsolationCapabilitiesDto {
  const levels = {
    standard: { rank: 1, runtime: 'runc', state: standard as 'ready' },
    sandboxed: { rank: 2, runtime: 'runsc-systrap', state: sandboxed as 'ready' },
  };
  const available = (['sandboxed', 'standard'] as const).filter((level) => levels[level].state === 'ready');

  return {
    revision,
    probedAt,
    probing: false,
    levels,
    recommendedLevel: standard === 'ready' ? (available[0] ?? null) : null,
    availableLevels: standard === 'ready' ? [...available] : [],
  };
}

describe('ClientIsolationService', () => {
  let proxy: { getClientIsolation: jest.Mock; probeClientIsolation: jest.Mock };
  let clientsRepository: { findById: jest.Mock; findAllIds: jest.Mock };
  let snapshotRow: Partial<ClientIsolationSnapshotEntity> | null;
  let queryBuilder: Record<string, jest.Mock>;
  let snapshots: { findOne: jest.Mock; find: jest.Mock; createQueryBuilder: jest.Mock };
  let publisher: {
    publishIsolationHostTransition: jest.Mock;
    publishAgentIsolationOverride: jest.Mock;
    publishAgentSandboxCreationFailed: jest.Mock;
  };
  let service: ClientIsolationService;
  let writeSucceeds: boolean;

  beforeEach(() => {
    snapshotRow = null;
    writeSucceeds = true;
    proxy = {
      getClientIsolation: jest.fn().mockResolvedValue(capabilities()),
      probeClientIsolation: jest.fn().mockResolvedValue(capabilities()),
    };
    clientsRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'client-1', name: 'Workspace' }),
      findAllIds: jest.fn().mockResolvedValue(['client-1', 'client-2', 'client-3']),
    };
    queryBuilder = {};

    for (const method of ['update', 'set', 'where', 'insert', 'into', 'values', 'orIgnore', 'orUpdate', 'returning']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }

    queryBuilder['execute'] = jest
      .fn()
      .mockImplementation(async () =>
        writeSucceeds ? { affected: 1, raw: [{ client_id: 'client-1' }] } : { affected: 0, raw: [] },
      );
    snapshots = {
      findOne: jest.fn().mockImplementation(async () => snapshotRow),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    publisher = {
      publishIsolationHostTransition: jest.fn(),
      publishAgentIsolationOverride: jest.fn(),
      publishAgentSandboxCreationFailed: jest.fn(),
    };
    service = new ClientIsolationService(
      proxy as never,
      clientsRepository as never,
      snapshots as never,
      publisher as unknown as AgenstraNotificationPublisher,
    );
  });

  describe('summaries', () => {
    it('summarizes manager capabilities', () => {
      const summary = service.summarize(capabilities());

      expect(summary).toEqual(
        expect.objectContaining({
          supported: true,
          recommendedLevel: 'sandboxed',
          availableLevels: ['sandboxed', 'standard'],
          revision: 'sha256:current',
          stale: false,
        }),
      );
    });

    it('treats agent managers without isolation support as standard-only', () => {
      const summary = service.summarize(undefined);

      expect(summary.supported).toBe(false);
      expect(summary.recommendedLevel).toBe('standard');
      expect(summary.availableLevels).toEqual(['standard']);
      expect(summary.levels.sandboxed.state).toBe('unsupported');
    });

    it('uses config capabilities for workspace responses and records them', async () => {
      const summary = await service.summaryForClient('client-1', { isolation: capabilities() });

      expect(summary?.recommendedLevel).toBe('sandboxed');
      await new Promise((resolve) => setImmediate(resolve));
      expect(queryBuilder['insert']).toHaveBeenCalled();
    });

    it('falls back to the stale snapshot when the manager config is unavailable', async () => {
      snapshotRow = {
        clientId: 'client-1',
        revision: 'sha256:old',
        capabilities: capabilities('ready', 'ready', 'sha256:old'),
      };

      const summary = await service.summaryForClient('client-1', undefined);

      expect(summary).toEqual(expect.objectContaining({ stale: true, revision: 'sha256:old' }));
    });

    it('returns the live summary and falls back to the snapshot', async () => {
      await expect(service.getSummary('client-1')).resolves.toEqual(expect.objectContaining({ stale: false }));

      proxy.getClientIsolation.mockRejectedValue(new Error('unreachable'));
      snapshotRow = {
        clientId: 'client-1',
        revision: 'sha256:old',
        capabilities: capabilities('ready', 'unsupported', 'sha256:old'),
      };

      await expect(service.getSummary('client-1')).resolves.toEqual(
        expect.objectContaining({ stale: true, recommendedLevel: 'standard' }),
      );
    });

    it('re-probes on demand and reports legacy managers as unsupported', async () => {
      await expect(service.probe('client-1')).resolves.toEqual(expect.objectContaining({ supported: true }));

      proxy.probeClientIsolation.mockRejectedValue(new NotFoundException('Cannot POST /api/isolation/probe'));

      await expect(service.probe('client-1')).resolves.toEqual(expect.objectContaining({ supported: false }));
    });
  });

  describe('planCreation', () => {
    it('pins the current revision and the selecting user', async () => {
      const plan = await service.planCreation('client-1', {}, 'user-1');

      expect(plan.forward).toEqual({
        capabilityRevision: 'sha256:current',
        isolationSelection: { selectedBy: 'user-1' },
      });
      expect(plan.resolution).toEqual({
        level: 'sandboxed',
        automaticSelection: 'sandboxed',
        selectionSource: 'automatic',
      });
    });

    it('forwards an explicit override', async () => {
      const plan = await service.planCreation('client-1', { isolationLevel: 'standard' }, 'user-1');

      expect(plan.forward.isolationLevel).toBe('standard');
      expect(plan.resolution?.selectionSource).toBe('user-override');
    });

    it('rejects stale revisions and unavailable levels', async () => {
      await expect(service.planCreation('client-1', { capabilityRevision: 'sha256:old' })).rejects.toBeInstanceOf(
        ConflictException,
      );

      proxy.getClientIsolation.mockResolvedValue(capabilities('ready', 'probe-failed'));

      await expect(service.planCreation('client-1', { isolationLevel: 'sandboxed' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses hosts without the runc baseline and invalid levels', async () => {
      proxy.getClientIsolation.mockResolvedValue(capabilities('probe-failed', 'ready'));
      proxy.probeClientIsolation.mockResolvedValue(capabilities('probe-failed', 'ready'));

      await expect(service.planCreation('client-1', {})).rejects.toBeInstanceOf(ServiceUnavailableException);

      proxy.getClientIsolation.mockResolvedValue(capabilities());

      await expect(service.planCreation('client-1', { isolationLevel: 'vm' as never })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('re-probes instead of rejecting while the first probe is pending or the floor failed', async () => {
      proxy.getClientIsolation.mockResolvedValue(capabilities('probe-failed', 'probe-failed', 'sha256:pending', null));
      proxy.probeClientIsolation.mockResolvedValue(capabilities());

      const plan = await service.planCreation('client-1', {});

      expect(proxy.probeClientIsolation).toHaveBeenCalledWith('client-1');
      expect(plan.resolution?.level).toBe('sandboxed');
      expect(plan.forward.capabilityRevision).toBe('sha256:current');

      proxy.getClientIsolation.mockResolvedValue(capabilities('probe-failed', 'ready', 'sha256:failed'));
      proxy.probeClientIsolation.mockResolvedValue(capabilities('probe-failed', 'ready', 'sha256:failed'));

      await expect(service.planCreation('client-1', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('keeps legacy agent managers working (standard only)', async () => {
      proxy.getClientIsolation.mockRejectedValue(new NotFoundException());

      await expect(service.planCreation('client-1', {}, 'user-1')).resolves.toEqual({
        forward: { isolationSelection: { selectedBy: 'user-1' } },
        resolution: null,
        capabilities: null,
      });
      await expect(service.planCreation('client-1', { isolationLevel: 'standard' })).resolves.toEqual(
        expect.objectContaining({ forward: expect.objectContaining({ isolationLevel: 'standard' }) }),
      );
      await expect(service.planCreation('client-1', { isolationLevel: 'sandboxed' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('creation notifications', () => {
    it('publishes overrides only', async () => {
      const automatic = await service.planCreation('client-1', {});

      service.notifyCreated('client-1', automatic, { id: 'agent-1' });
      expect(publisher.publishAgentIsolationOverride).not.toHaveBeenCalled();

      const override = await service.planCreation('client-1', { isolationLevel: 'standard' });

      service.notifyCreated('client-1', override, {
        id: 'agent-1',
        name: 'env',
        isolation: { level: 'standard', selection: { selectedBy: 'user-1' } },
      });
      expect(publisher.publishAgentIsolationOverride).toHaveBeenCalledWith('client-1', {
        agentId: 'agent-1',
        agentName: 'env',
        automaticSelection: 'sandboxed',
        effectiveSelection: 'standard',
        selectedBy: 'user-1',
        capabilityRevision: 'sha256:current',
      });
    });

    it('redacts credentials from failure messages', () => {
      expect(redactErrorMessage('clone https://user:secret@git.example.org/repo.git failed; token=abc123')).toBe(
        'clone https://***@git.example.org/repo.git failed; token=***',
      );
      expect(redactErrorMessage('fetch https://u:pa/ss@host/x with Authorization: Bearer abc.def')).toBe(
        'fetch https://***@host/x with Authorization: Bearer ***',
      );
      expect(redactErrorMessage('x'.repeat(1000))).toHaveLength(300);
    });

    it('publishes sandbox runtime failures but not validation errors', async () => {
      const plan = await service.planCreation('client-1', {});

      service.notifyCreationFailed('client-1', plan, 'env', new Error("Agent with name 'env' already exists"));
      expect(publisher.publishAgentSandboxCreationFailed).not.toHaveBeenCalled();

      service.notifyCreationFailed(
        'client-1',
        plan,
        'env',
        new Error('The sandboxed (gVisor) container could not be started: boom'),
      );
      expect(publisher.publishAgentSandboxCreationFailed).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({ agentName: 'env', isolationLevel: 'sandboxed', runtime: 'runsc-systrap' }),
      );
    });
  });

  describe('observe (transitions)', () => {
    it('ignores capabilities of a pending probe', async () => {
      await service.observe('client-1', capabilities('ready', 'ready', 'sha256:x', null));

      expect(snapshots.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('publishes sandbox availability on first observation', async () => {
      await service.observe('client-1', capabilities());

      expect(publisher.publishIsolationHostTransition).toHaveBeenCalledTimes(1);
      expect(publisher.publishIsolationHostTransition).toHaveBeenCalledWith(
        'isolation.sandbox_available',
        'client-1',
        expect.objectContaining({ clientName: 'Workspace', level: 'sandboxed', state: 'ready', previousState: null }),
      );
    });

    it('publishes nothing for an unchanged revision', async () => {
      snapshotRow = {
        clientId: 'client-1',
        revision: 'sha256:current',
        standardState: 'ready',
        sandboxedState: 'ready',
      };

      await service.observe('client-1', capabilities());

      expect(snapshots.createQueryBuilder).not.toHaveBeenCalled();
      expect(publisher.publishIsolationHostTransition).not.toHaveBeenCalled();
    });

    it('publishes sandbox loss and runc baseline failures', async () => {
      snapshotRow = { clientId: 'client-1', revision: 'sha256:old', standardState: 'ready', sandboxedState: 'ready' };

      await service.observe('client-1', capabilities('probe-failed', 'probe-failed', 'sha256:new'));

      const types = publisher.publishIsolationHostTransition.mock.calls.map((call) => call[0]);

      expect(types).toEqual(['isolation.sandbox_unavailable', 'isolation.baseline_failed']);
      expect(queryBuilder['where']).toHaveBeenCalledWith('client_id = :clientId AND revision = :revision', {
        clientId: 'client-1',
        revision: 'sha256:old',
      });
    });

    it('treats check-only placeholder rows as a first observation', async () => {
      snapshotRow = { clientId: 'client-1', revision: null, standardState: null, sandboxedState: null };

      await service.observe('client-1', capabilities());

      expect(queryBuilder['where']).toHaveBeenCalledWith(
        'client_id = :clientId AND revision IS NULL',
        expect.anything(),
      );
      expect(publisher.publishIsolationHostTransition).toHaveBeenCalledWith(
        'isolation.sandbox_available',
        'client-1',
        expect.anything(),
      );
    });

    it('does not publish when another observer recorded the transition first', async () => {
      snapshotRow = {
        clientId: 'client-1',
        revision: 'sha256:old',
        standardState: 'ready',
        sandboxedState: 'unsupported',
      };
      writeSucceeds = false;

      await service.observe('client-1', capabilities());

      expect(publisher.publishIsolationHostTransition).not.toHaveBeenCalled();
    });

    it('refreshes in the background job and picks the least recently checked hosts', async () => {
      await service.refresh('client-1');
      expect(publisher.publishIsolationHostTransition).toHaveBeenCalled();
      expect(queryBuilder['orUpdate']).toHaveBeenCalledWith(['checked_at'], ['client_id']);

      proxy.getClientIsolation.mockRejectedValue(new Error('unreachable'));
      queryBuilder['orUpdate'].mockClear();
      await service.refresh('client-2');
      expect(queryBuilder['orUpdate']).toHaveBeenCalledWith(['checked_at'], ['client_id']);

      snapshots.find.mockResolvedValue([
        { clientId: 'client-1', checkedAt: new Date(2000) },
        { clientId: 'client-3', checkedAt: new Date(1000) },
      ]);

      await expect(service.findClientIdsDue(2)).resolves.toEqual(['client-2', 'client-3']);
      await expect(service.findClientIdsDue(0)).resolves.toEqual([]);
    });
  });
});
