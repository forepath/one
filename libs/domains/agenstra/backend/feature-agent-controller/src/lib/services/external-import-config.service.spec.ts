import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { CreateExternalImportConfigDto } from '../dto/context-import/create-external-import-config.dto';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportKind, ExternalImportProviderId } from '../entities/external-import.enums';
import { TicketStatus } from '../entities/ticket.enums';

import { ExternalImportConfigService } from './external-import-config.service';

describe('ExternalImportConfigService', () => {
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  let service: ExternalImportConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExternalImportConfigService(mockRepo as unknown as Repository<ExternalImportConfigEntity>);
  });

  describe('create', () => {
    beforeEach(() => {
      mockRepo.create.mockImplementation((x: ExternalImportConfigEntity) => x);
      mockRepo.save.mockImplementation(async (r: ExternalImportConfigEntity) => r);
    });

    it('rejects Jira import without non-empty JQL', async () => {
      const dto: CreateExternalImportConfigDto = {
        provider: ExternalImportProviderId.ATLASSIAN,
        importKind: ExternalImportKind.JIRA,
        atlassianConnectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        clientId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        jql: '   ',
      };

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('rejects Confluence import without non-empty CQL', async () => {
      const dto: CreateExternalImportConfigDto = {
        provider: ExternalImportProviderId.ATLASSIAN,
        importKind: ExternalImportKind.CONFLUENCE,
        atlassianConnectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        clientId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        cql: '',
      };

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('persists importTargetTicketStatus for Jira defaults', async () => {
      const dto: CreateExternalImportConfigDto = {
        provider: ExternalImportProviderId.ATLASSIAN,
        importKind: ExternalImportKind.JIRA,
        atlassianConnectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        clientId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        jql: 'project = FOO',
      };

      await service.create(dto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          importTargetTicketStatus: TicketStatus.DRAFT,
        }),
      );
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

  describe('recordRunOutcome', () => {
    it('clears lastError when error message is null, undefined, or whitespace-only', async () => {
      const row = {
        id: 'cfg-1',
        lastError: 'previous failure',
        lastRunAt: null as Date | null,
      } as ExternalImportConfigEntity;

      mockRepo.findOne.mockResolvedValue(row);
      mockRepo.save.mockImplementation(async (r: ExternalImportConfigEntity) => r);

      await service.recordRunOutcome('cfg-1', '  \t  ');

      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'cfg-1' } });
      expect(row.lastError).toBeNull();
      expect(row.lastRunAt).toBeInstanceOf(Date);
      expect(mockRepo.save).toHaveBeenCalledWith(row);
    });

    it('stores trimmed non-empty error messages', async () => {
      const row = {
        id: 'cfg-1',
        lastError: null,
        lastRunAt: null as Date | null,
      } as ExternalImportConfigEntity;

      mockRepo.findOne.mockResolvedValue(row);
      mockRepo.save.mockImplementation(async (r: ExternalImportConfigEntity) => r);

      await service.recordRunOutcome('cfg-1', '  timed out  ');

      expect(row.lastError).toBe('timed out');
      expect(mockRepo.save).toHaveBeenCalledWith(row);
    });

    it('no-ops when config id is unknown', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await service.recordRunOutcome('missing', null);

      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });
});
