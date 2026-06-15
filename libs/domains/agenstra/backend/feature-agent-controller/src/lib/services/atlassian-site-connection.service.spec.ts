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
  };
  let service: AtlassianSiteConnectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AtlassianSiteConnectionService(mockRepo as unknown as Repository<AtlassianSiteConnectionEntity>);
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
