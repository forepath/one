import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';

import { AtlassianSiteConnectionService } from './atlassian-site-connection.service';

describe('AtlassianSiteConnectionService', () => {
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const searchIndex = {
    isEnabled: jest.fn().mockReturnValue(false),
    searchIds: jest.fn(),
    upsertSafe: jest.fn().mockResolvedValue(undefined),
    deleteSafe: jest.fn().mockResolvedValue(undefined),
  };
  const atlassianAuth = { invalidate: jest.fn() };
  const createdAt = new Date('2026-01-01T00:00:00Z');
  let service: AtlassianSiteConnectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AtlassianSiteConnectionService(
      mockRepo as unknown as Repository<AtlassianSiteConnectionEntity>,
      searchIndex as never,
      atlassianAuth as never,
    );
    mockRepo.create.mockImplementation((v: object) => ({ ...v }));
    mockRepo.save.mockImplementation(async (v: object) => ({ id: 'conn-1', createdAt, updatedAt: createdAt, ...v }));
  });

  describe('create', () => {
    it('defaults to app auth and requires OAuth credentials', async () => {
      await expect(service.create({ baseUrl: 'https://x.atlassian.net' })).rejects.toBeInstanceOf(BadRequestException);

      const res = await service.create({
        baseUrl: 'https://x.atlassian.net/wiki',
        oauthClientId: ' cid ',
        oauthClientSecret: 'secret',
        accountEmail: 'ignored@b.com',
      });

      expect(mockRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          authType: 'app',
          baseUrl: 'https://x.atlassian.net',
          oauthClientId: 'cid',
          oauthClientSecret: 'secret',
          accountEmail: null,
          apiToken: null,
          lastTestStatus: 'untested',
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          authType: 'app',
          oauthClientId: 'cid',
          accountEmail: null,
          lastTestStatus: 'untested',
        }),
      );
      expect(res).not.toHaveProperty('oauthClientSecret');
      expect(res).not.toHaveProperty('apiToken');
      expect(searchIndex.upsertSafe).toHaveBeenCalledWith(
        'atlassian-connections',
        expect.not.objectContaining({ oauthClientSecret: expect.anything() }),
      );
    });

    it('creates token connections with email + API token', async () => {
      const res = await service.create({
        baseUrl: 'https://x.atlassian.net',
        authType: 'token',
        accountEmail: 'a@b.com',
        apiToken: 'tok',
      });

      expect(res).toEqual(expect.objectContaining({ authType: 'token', accountEmail: 'a@b.com', oauthClientId: null }));
      await expect(
        service.create({ baseUrl: 'https://x.atlassian.net', authType: 'token', accountEmail: 'a@b.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    const tokenRow = () => ({
      id: 'conn-1',
      baseUrl: 'https://x.atlassian.net',
      authType: 'token',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
      lastTestStatus: 'ok',
      lastTestMessage: null,
      lastTestedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    it('keeps stored secrets when omitted and keeps the test status for label-only edits', async () => {
      mockRepo.findOne.mockResolvedValue(tokenRow());

      await service.update('conn-1', { label: 'L' });

      expect(mockRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: 'L', apiToken: 'tok', lastTestStatus: 'ok' }),
      );
      expect(atlassianAuth.invalidate).toHaveBeenCalledWith('conn-1');
    });

    it('requires the new credentials when switching auth type and resets the test status', async () => {
      mockRepo.findOne.mockResolvedValue(tokenRow());
      await expect(service.update('conn-1', { authType: 'app', oauthClientId: 'cid' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      mockRepo.findOne.mockResolvedValue(tokenRow());
      await service.update('conn-1', { authType: 'app', oauthClientId: 'cid', oauthClientSecret: 's' });

      expect(mockRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          authType: 'app',
          oauthClientId: 'cid',
          oauthClientSecret: 's',
          accountEmail: null,
          apiToken: null,
          lastTestStatus: 'untested',
          lastTestedAt: null,
        }),
      );
    });

    it('clears the cached cloud id when the site changes', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...tokenRow(),
        authType: 'app',
        accountEmail: null,
        apiToken: null,
        oauthClientId: 'cid',
        oauthClientSecret: 's',
        cloudId: 'cloud-1',
      });

      await service.update('conn-1', { baseUrl: 'https://y.atlassian.net' });

      expect(mockRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseUrl: 'https://y.atlassian.net', cloudId: null, oauthClientSecret: 's' }),
      );
    });
  });

  describe('recordTestResult', () => {
    it('persists the sanitized outcome without touching updatedAt', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'conn-1', updatedAt: createdAt });

      const res = await service.recordTestResult('conn-1', { ok: false, message: 'Jira HTTP 401\nmore' });

      expect(res).toEqual({ ok: false, message: 'Jira HTTP 401 more', testedAt: expect.any(String) });
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'conn-1' },
        expect.objectContaining({
          lastTestStatus: 'failed',
          lastTestMessage: 'Jira HTTP 401 more',
          updatedAt: createdAt,
        }),
      );
    });

    it('throws for unknown connections', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.recordTestResult('x', { ok: true })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('uses take, skip, and descending createdAt order', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll(15, 30);

      expect(mockRepo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 15,
        skip: 30,
      });
    });

    it('defaults to limit 10 and offset 0', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 0,
      });
    });
  });
});
