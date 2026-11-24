import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type { ActionCenterViewer } from '../interfaces/action-center.types';

import { ActionCenterRegistry } from './action-center-registry.service';
import { ActionCenterSilencesService } from './action-center-silences.service';

const admin: ActionCenterViewer = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin', scopeKey: 't' };
const manager: ActionCenterViewer = { userId: '22222222-2222-4222-8222-222222222222', role: 'manager', scopeKey: 't' };

function createService() {
  const repository = {
    delete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'new', createdAt: new Date(), ...value })),
  };
  const registry = new ActionCenterRegistry();

  registry.register({ key: 'test', types: ['decabill.invoices.unsent'], collect: async () => [] });

  return { service: new ActionCenterSilencesService(repository as never, registry), repository };
}

describe('ActionCenterSilencesService', () => {
  const now = new Date('2026-11-24T10:00:00Z');

  it('creates a personal silence for managers', async () => {
    const { service, repository } = createService();

    await service.create(manager, { itemType: 'decabill.invoices.unsent', itemId: 'inv-1', audience: 'self' }, now);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 't', userId: manager.userId, itemId: 'inv-1', until: null }),
    );
  });

  it('forbids managers to silence for everyone', async () => {
    const { service } = createService();

    await expect(
      service.create(manager, { itemType: 'decabill.invoices.unsent', audience: 'everyone' }, now),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets admins silence for everyone (user id null)', async () => {
    const { service, repository } = createService();

    await service.create(admin, { itemType: 'decabill.invoices.unsent', audience: 'everyone' }, now);

    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ userId: null, itemId: null }));
  });

  it('rejects unknown types and past end dates', async () => {
    const { service } = createService();

    await expect(service.create(admin, { itemType: 'decabill.nope.unknown', audience: 'self' }, now)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.create(
        admin,
        { itemType: 'decabill.invoices.unsent', audience: 'self', until: '2026-11-24T09:00:00Z' },
        now,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates the end of an existing silence instead of duplicating it', async () => {
    const { service, repository } = createService();
    const existing = { id: 's', until: null } as unknown as ActionCenterSilenceEntity;

    repository.findOne.mockResolvedValueOnce(existing);
    await service.create(
      admin,
      { itemType: 'decabill.invoices.unsent', audience: 'self', until: '2026-12-01T00:00:00Z' },
      now,
    );

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's', until: new Date('2026-12-01T00:00:00Z') }),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('enforces the per-user limit', async () => {
    const { service, repository } = createService();

    repository.count.mockResolvedValueOnce(300);

    await expect(
      service.create(manager, { itemType: 'decabill.invoices.unsent', audience: 'self' }, now),
    ).rejects.toThrow('Too many silences');
  });

  it('does not count personal silences against the scope cap for everyone silences', async () => {
    const { service, repository } = createService();

    await service.create(admin, { itemType: 'decabill.invoices.unsent', audience: 'everyone' }, now);

    expect(repository.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ scopeKey: 't', userId: expect.anything() }),
    });
    expect(repository.count).toHaveBeenCalledTimes(1);
  });

  describe('remove', () => {
    it('removes own silences', async () => {
      const { service, repository } = createService();

      repository.findOne.mockResolvedValueOnce({ id: 's', userId: manager.userId, scopeKey: 't' });
      await service.remove(manager, 's');

      expect(repository.delete).toHaveBeenCalledWith({ id: 's' });
    });

    it('hides other users’ personal silences (404) and protects everyone silences from managers (403)', async () => {
      const { service, repository } = createService();

      repository.findOne.mockResolvedValueOnce({ id: 's', userId: admin.userId, scopeKey: 't' });
      await expect(service.remove(manager, 's')).rejects.toBeInstanceOf(NotFoundException);

      repository.findOne.mockResolvedValueOnce({ id: 's', userId: null, scopeKey: 't' });
      await expect(service.remove(manager, 's')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalledWith({ id: 's' });
    });

    it('looks silences up within the viewer scope only', async () => {
      const { service, repository } = createService();

      await expect(service.remove(admin, 's')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 's', scopeKey: 't' } });
    });
  });

  it('purges expired silences when listing', async () => {
    const { service, repository } = createService();

    await service.listForScope('t', now);

    expect(repository.delete).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: 't' }));
    expect(repository.find).toHaveBeenCalledWith({ where: { scopeKey: 't' }, order: { createdAt: 'DESC' } });
  });
});
