import { Test } from '@nestjs/testing';

import { PresentationsRepository } from '../repositories/presentations.repository';
import { PresentationsService } from './presentations.service';

describe('PresentationsService', () => {
  let service: PresentationsService;
  let repository: jest.Mocked<PresentationsRepository>;

  beforeEach(async () => {
    repository = {
      findAllByUser: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<PresentationsRepository>;

    const moduleRef = await Test.createTestingModule({
      providers: [PresentationsService, { provide: PresentationsRepository, useValue: repository }],
    }).compile();

    service = moduleRef.get(PresentationsService);
  });

  it('lists presentations for user', async () => {
    repository.findAllByUser.mockResolvedValue({
      items: [
        {
          id: 'p1',
          userId: 'user-1',
          title: 'Deck',
          markdown: '# Hi',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        } as never,
      ],
      total: 1,
    });

    const result = await service.listForUser('user-1', 10, 0);

    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('Deck');
  });
});
