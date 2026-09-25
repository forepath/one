import { ForbiddenException } from '@nestjs/common';

import {
  KnowledgeActionType,
  KnowledgeActorType,
  KnowledgeNodeType,
  KnowledgeRelationSourceType,
  KnowledgeRelationTargetType,
} from '../entities/knowledge-node.enums';

import { ExternalImportSyncMarkerService } from './external-import-sync-marker.service';
import { KnowledgeTreeService } from './knowledge-tree.service';

describe('KnowledgeTreeService', () => {
  const nodeRepo: any = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    delete: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {
      transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => {
        const em = {
          getRepository: jest.fn(() => ({
            delete: jest.fn().mockResolvedValue(undefined),
          })),
        };

        return fn(em);
      }),
    },
  };
  const relationRepo: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    delete: jest.fn(),
  };
  const pageActivityRepo: any = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const clientsRepository = {} as never;
  const clientUsersRepository = {} as never;
  const usersRepository: any = { findById: jest.fn() };
  const ticketsService: any = {
    getPrototypePromptByClientSha: jest.fn(),
  };
  const ticketBoardRealtime: any = {
    emitToClient: jest.fn(),
  };
  const knowledgeBoardRealtime: any = {
    emitToClient: jest.fn(),
  };
  const knowledgeEmbeddingIndexService: any = {
    reindexPage: jest.fn(),
    deleteForNode: jest.fn(),
  };
  const searchIndex: any = {
    upsertSafe: jest.fn().mockResolvedValue(undefined),
    deleteSafe: jest.fn().mockResolvedValue(undefined),
  };
  const externalImportSyncMarkerService: Partial<ExternalImportSyncMarkerService> = {
    applyKnowledgeNodeDeleteInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const service = new KnowledgeTreeService(
    nodeRepo,
    relationRepo,
    pageActivityRepo,
    clientsRepository,
    clientUsersRepository,
    usersRepository,
    ticketsService,
    ticketBoardRealtime,
    knowledgeBoardRealtime,
    knowledgeEmbeddingIndexService,
    searchIndex,
    externalImportSyncMarkerService as ExternalImportSyncMarkerService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('collects prompt sections for folder subtree and deduplicates pages', async () => {
    (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
    relationRepo.find.mockResolvedValue([
      {
        targetType: KnowledgeRelationTargetType.FOLDER,
        targetNodeId: 'folder-1',
      },
      {
        targetType: KnowledgeRelationTargetType.PAGE,
        targetNodeId: 'page-2',
      },
    ]);
    nodeRepo.findOne
      .mockResolvedValueOnce({ id: 'folder-1', clientId: 'c1', nodeType: KnowledgeNodeType.FOLDER })
      .mockResolvedValueOnce({
        id: 'page-2',
        clientId: 'c1',
        nodeType: KnowledgeNodeType.PAGE,
        title: 'P2',
        content: 'B',
      });
    (service as any).collectSubtreePages = jest.fn().mockResolvedValue([
      { id: 'page-1', title: 'P1', content: 'A' },
      { id: 'page-2', title: 'P2', content: 'B' },
    ]);

    const result = await service.collectPromptContextsForSource('c1', KnowledgeRelationSourceType.PAGE, 's1');

    expect(result.promptSections.length).toBe(2);
    expect(result.promptSections[0]).toContain('Knowledge Page: P1');
    expect(result.promptSections[1]).toContain('Knowledge Page: P2');
  });

  it('rejects relation creation for mismatched workspace target', async () => {
    (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
    (service as any).getNodeOrThrow = jest.fn().mockResolvedValue({
      id: 'page-1',
      clientId: 'other',
      nodeType: KnowledgeNodeType.PAGE,
    });

    await expect(
      service.createRelation({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 's1',
        targetType: KnowledgeRelationTargetType.PAGE,
        targetNodeId: 'page-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('importCreateRelation rejects mismatched workspace target without user context', async () => {
    (service as any).getNodeOrThrow = jest.fn().mockResolvedValue({
      id: 'page-1',
      clientId: 'other',
      nodeType: KnowledgeNodeType.PAGE,
    });

    await expect(
      service.importCreateRelation({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 's1',
        targetType: KnowledgeRelationTargetType.PAGE,
        targetNodeId: 'page-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates page-source relation and emits relation + activity events', async () => {
    (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
    (service as any).getNodeOrThrow = jest.fn().mockResolvedValue({
      id: 'page-target',
      clientId: 'c1',
      nodeType: KnowledgeNodeType.PAGE,
    });
    relationRepo.save.mockResolvedValue({
      id: 'rel-1',
      clientId: 'c1',
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: 'page-source',
      targetType: KnowledgeRelationTargetType.PAGE,
      targetNodeId: 'page-target',
      targetTicketLongSha: null,
      createdAt: '2024-01-01T00:00:00Z',
    });
    pageActivityRepo.save.mockResolvedValue({
      id: 'act-1',
      pageId: 'page-source',
      occurredAt: '2024-01-01T00:00:00Z',
      actorType: KnowledgeActorType.SYSTEM,
      actorUserId: null,
      actionType: KnowledgeActionType.RELATION_ADDED,
      payload: {},
    });

    await service.createRelation({
      clientId: 'c1',
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: 'page-source',
      targetType: KnowledgeRelationTargetType.PAGE,
      targetNodeId: 'page-target',
    });

    expect(ticketBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgeRelationChanged',
      expect.objectContaining({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 'page-source',
      }),
    );
    expect(knowledgeBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgeRelationChanged',
      expect.objectContaining({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 'page-source',
      }),
    );
    expect(pageActivityRepo.save).toHaveBeenCalled();
    expect(knowledgeBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgePageActivityCreated',
      expect.objectContaining({
        id: 'act-1',
        pageId: 'page-source',
        actionType: KnowledgeActionType.RELATION_ADDED,
      }),
    );
  });

  it('importCreateRelation persists when target is valid (no user request)', async () => {
    (service as any).getNodeOrThrow = jest.fn().mockResolvedValue({
      id: 'page-target',
      clientId: 'c1',
      nodeType: KnowledgeNodeType.PAGE,
    });
    relationRepo.save.mockResolvedValue({
      id: 'rel-1',
      clientId: 'c1',
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: 'page-source',
      targetType: KnowledgeRelationTargetType.PAGE,
      targetNodeId: 'page-target',
      targetTicketLongSha: null,
      createdAt: '2024-01-01T00:00:00Z',
    });
    pageActivityRepo.save.mockResolvedValue({
      id: 'act-1',
      pageId: 'page-source',
      occurredAt: '2024-01-01T00:00:00Z',
      actorType: KnowledgeActorType.SYSTEM,
      actorUserId: null,
      actionType: KnowledgeActionType.RELATION_ADDED,
      payload: {},
    });

    await service.importCreateRelation({
      clientId: 'c1',
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: 'page-source',
      targetType: KnowledgeRelationTargetType.PAGE,
      targetNodeId: 'page-target',
    });

    expect(ticketBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgeRelationChanged',
      expect.objectContaining({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 'page-source',
      }),
    );
    expect(knowledgeBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgeRelationChanged',
      expect.objectContaining({
        clientId: 'c1',
        sourceType: KnowledgeRelationSourceType.PAGE,
        sourceId: 'page-source',
      }),
    );
    expect(pageActivityRepo.save).toHaveBeenCalled();
    expect(knowledgeBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgePageActivityCreated',
      expect.objectContaining({
        id: 'act-1',
        pageId: 'page-source',
        actionType: KnowledgeActionType.RELATION_ADDED,
      }),
    );
  });

  it('deletes page-source relation and appends relation removed activity', async () => {
    (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
    relationRepo.findOne.mockResolvedValue({
      id: 'rel-2',
      clientId: 'c1',
      sourceType: KnowledgeRelationSourceType.PAGE,
      sourceId: 'page-source',
      targetType: KnowledgeRelationTargetType.TICKET,
      targetNodeId: null,
      targetTicketLongSha: 'abc'.padEnd(40, '0'),
      createdAt: '2024-01-01T00:00:00Z',
    });
    pageActivityRepo.save.mockResolvedValue({
      id: 'act-2',
      pageId: 'page-source',
      occurredAt: '2024-01-01T00:00:00Z',
      actorType: KnowledgeActorType.SYSTEM,
      actorUserId: null,
      actionType: KnowledgeActionType.RELATION_REMOVED,
      payload: {},
    });

    await service.deleteRelation('rel-2');

    expect(relationRepo.delete).toHaveBeenCalledWith('rel-2');
    expect(pageActivityRepo.save).toHaveBeenCalled();
    expect(knowledgeBoardRealtime.emitToClient).toHaveBeenCalledWith(
      'c1',
      'knowledgePageActivityCreated',
      expect.objectContaining({
        id: 'act-2',
        pageId: 'page-source',
        actionType: KnowledgeActionType.RELATION_REMOVED,
      }),
    );
  });

  it('maps activity rows with actor email in listPageActivity', async () => {
    (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
    (service as any).getNodeOrThrow = jest.fn().mockResolvedValue({
      id: 'page-1',
      clientId: 'c1',
      nodeType: KnowledgeNodeType.PAGE,
    });
    pageActivityRepo.find.mockResolvedValue([
      {
        id: 'act-3',
        pageId: 'page-1',
        occurredAt: '2024-01-01T00:00:00Z',
        actorType: KnowledgeActorType.HUMAN,
        actorUserId: 'u1',
        actionType: KnowledgeActionType.CREATED,
        payload: { title: 'Hello' },
      },
    ]);
    usersRepository.findById.mockResolvedValue({ email: 'actor@example.com' });

    const rows = await service.listPageActivity('page-1', 20, 0);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'act-3',
        pageId: 'page-1',
        actorEmail: 'actor@example.com',
        actionType: KnowledgeActionType.CREATED,
      }),
    ]);
    expect(pageActivityRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageId: 'page-1' },
        take: 20,
        skip: 0,
      }),
    );
  });

  describe('suggestNumberedTitle', () => {
    it('returns the original title when free', () => {
      expect(service.suggestNumberedTitle('Guide', ['Other'])).toBe('Guide');
    });

    it('appends (1) / (2) on collision', () => {
      expect(service.suggestNumberedTitle('Guide', ['Guide'])).toBe('Guide (1)');
      expect(service.suggestNumberedTitle('Guide', ['Guide', 'Guide (1)'])).toBe('Guide (2)');
    });
  });

  describe('uploadTextFiles', () => {
    it('rejects disallowed extensions and binary content', async () => {
      (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
      nodeRepo.find.mockResolvedValue([]);

      const result = await service.uploadTextFiles({
        clientId: 'client-1',
        files: [
          { filename: 'notes.pdf', content: 'x' },
          { filename: 'ok.md', content: 'hello\0world' },
        ],
      });

      expect(result.created).toHaveLength(0);
      expect(result.rejected).toEqual([
        expect.objectContaining({ filename: 'notes.pdf' }),
        expect.objectContaining({ filename: 'ok.md' }),
      ]);
    });

    it('creates a page from allowed text when no conflict', async () => {
      (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
      (service as any).assertValidParent = jest.fn().mockResolvedValue(undefined);
      (service as any).nextSortOrder = jest.fn().mockResolvedValue(0);
      nodeRepo.find.mockResolvedValue([]);
      nodeRepo.save.mockImplementation(async (row: any) => ({
        ...row,
        id: row.id ?? 'new-page',
        longSha: row.longSha ?? 'sha',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }));
      pageActivityRepo.save.mockImplementation(async (row: any) => row);

      const result = await service.uploadTextFiles({
        clientId: 'client-1',
        files: [{ filename: 'Guide.md', content: '# Hello' }],
      });

      expect(result.rejected).toHaveLength(0);
      expect(result.created).toHaveLength(1);
      expect(result.created[0].title).toBe('Guide');
      expect(result.created[0].content).toBe('# Hello');
    });

    it('numbers title when onConflict is number', async () => {
      (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
      (service as any).assertValidParent = jest.fn().mockResolvedValue(undefined);
      (service as any).nextSortOrder = jest.fn().mockResolvedValue(1);
      nodeRepo.find.mockResolvedValue([
        {
          id: 'existing',
          title: 'Guide',
          nodeType: KnowledgeNodeType.PAGE,
          parentId: null,
          clientId: 'client-1',
        },
      ]);
      nodeRepo.save.mockImplementation(async (row: any) => ({
        ...row,
        id: row.id ?? 'new-page',
        longSha: row.longSha ?? 'sha',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }));
      pageActivityRepo.save.mockImplementation(async (row: any) => row);

      const result = await service.uploadTextFiles({
        clientId: 'client-1',
        onConflict: 'number' as any,
        files: [{ filename: 'Guide.md', content: 'body' }],
      });

      expect(result.created[0].title).toBe('Guide (1)');
      expect(result.updated).toHaveLength(0);
    });

    it('rejects path separators in filename', async () => {
      (service as any).assertClientAccess = jest.fn().mockResolvedValue(undefined);
      nodeRepo.find.mockResolvedValue([]);

      const result = await service.uploadTextFiles({
        clientId: 'client-1',
        files: [{ filename: '../evil.md', content: 'x' }],
      });

      expect(result.rejected[0].reason).toMatch(/path separators/i);
    });
  });
});
