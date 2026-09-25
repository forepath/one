import { TestBed } from '@angular/core/testing';
import {
  KnowledgeFacade,
  deleteKnowledgeNodeFailure,
  deleteKnowledgeNodeSuccess,
  duplicateKnowledgeNodeFailure,
  duplicateKnowledgeNodeSuccess,
  updateKnowledgeNodeFailure,
  updateKnowledgeNodeSuccess,
  type KnowledgeNodeDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';

import { KnowledgeTreeClipboardService } from './knowledge-tree-clipboard.service';

describe('KnowledgeTreeClipboardService', () => {
  let service: KnowledgeTreeClipboardService;
  let actions$: Subject<unknown>;
  let knowledgeFacade: {
    deleteNode: jest.Mock;
    duplicateNode: jest.Mock;
    updateNode: jest.Mock;
  };

  const sampleNode = (overrides: Partial<KnowledgeNodeDto> = {}): KnowledgeNodeDto => ({
    id: 'node-1',
    shas: { short: 'abc1234', long: 'abc1234long' },
    clientId: 'client-1',
    nodeType: 'page',
    parentId: null,
    title: 'Page',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    actions$ = new Subject();
    knowledgeFacade = {
      deleteNode: jest.fn(),
      duplicateNode: jest.fn(),
      updateNode: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        KnowledgeTreeClipboardService,
        { provide: KnowledgeFacade, useValue: knowledgeFacade },
        { provide: Actions, useValue: actions$ },
      ],
    });

    service = TestBed.inject(KnowledgeTreeClipboardService);
  });

  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('copies via duplicate then moves under the paste target when needed', async () => {
    const duplicated = sampleNode({ id: 'copy-1', parentId: null, title: 'Page (1)' });

    service.setCollisionHelpers({
      resolveNameCollision: null,
      listSiblings: () => [],
      getNodeContent: () => null,
    });
    service.setClipboard('copy', [{ id: 'node-1', nodeType: 'page', parentId: null, title: 'Page' }]);

    const done = jest.fn();
    const resolveParentId = (id: string) => (id === 'node-1' ? null : null);

    service.enqueuePaste('folder-1', resolveParentId, done);
    await flushMicrotasks();

    expect(knowledgeFacade.duplicateNode).toHaveBeenCalledWith('node-1');
    actions$.next(duplicateKnowledgeNodeSuccess({ sourceId: 'node-1', node: duplicated }));
    await flushMicrotasks();

    expect(knowledgeFacade.updateNode).toHaveBeenCalledWith('copy-1', { parentId: 'folder-1' });
    actions$.next(
      updateKnowledgeNodeSuccess({ node: sampleNode({ id: 'copy-1', parentId: 'folder-1', title: 'Page (1)' }) }),
    );
    await flushMicrotasks();

    // Destination has no collision — restore original title after move.
    expect(knowledgeFacade.updateNode).toHaveBeenCalledWith('copy-1', { title: 'Page' });
    actions$.next(
      updateKnowledgeNodeSuccess({ node: sampleNode({ id: 'copy-1', parentId: 'folder-1', title: 'Page' }) }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(done).toHaveBeenCalledWith({
      mode: 'copy',
      moves: [
        {
          sourceId: 'node-1',
          destinationParentId: 'folder-1',
          resultId: 'copy-1',
          mode: 'copy',
        },
      ],
    });
    expect(service.clipboard()).not.toBeNull();
  });

  it('moves queued cut entries via facade update', async () => {
    service.setClipboard('cut', [
      { id: 'page-1', nodeType: 'page', parentId: null, title: 'Page' },
      { id: 'folder-1', nodeType: 'folder', parentId: null, title: 'Folder' },
    ]);

    const done = jest.fn();
    const resolveParentId = (): string | null => null;

    service.enqueuePaste('dest', resolveParentId, done);
    await flushMicrotasks();

    expect(knowledgeFacade.updateNode).toHaveBeenCalledWith('page-1', { parentId: 'dest' });
    actions$.next(updateKnowledgeNodeSuccess({ node: sampleNode({ id: 'page-1', parentId: 'dest' }) }));
    await flushMicrotasks();

    expect(knowledgeFacade.updateNode).toHaveBeenCalledWith('folder-1', { parentId: 'dest' });
    actions$.next(
      updateKnowledgeNodeSuccess({
        node: sampleNode({ id: 'folder-1', nodeType: 'folder', parentId: 'dest', title: 'Folder' }),
      }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.clipboard()).toBeNull();
    expect(done).toHaveBeenCalledWith({
      mode: 'cut',
      moves: [
        { sourceId: 'page-1', destinationParentId: 'dest', resultId: 'page-1', mode: 'cut' },
        { sourceId: 'folder-1', destinationParentId: 'dest', resultId: 'folder-1', mode: 'cut' },
      ],
    });
  });

  it('rejects moving a folder into itself without calling update', async () => {
    service.setClipboard('cut', [{ id: 'folder', nodeType: 'folder', parentId: null, title: 'Folder' }]);

    const done = jest.fn();
    const resolveParentId = (id: string): string | null => (id === 'nested' ? 'folder' : id === 'folder' ? null : null);

    service.enqueuePaste('nested', resolveParentId, done);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(knowledgeFacade.updateNode).not.toHaveBeenCalled();
    expect(service.lastError()).toContain('Cannot move');
    expect(done).not.toHaveBeenCalled();
  });

  it('deletes queued ids via facade', async () => {
    const done = jest.fn();

    service.enqueueDelete(['a', 'b'], { releaseExternalSyncMarker: true }, done);
    await flushMicrotasks();

    expect(knowledgeFacade.deleteNode).toHaveBeenCalledWith('a', true);
    actions$.next(deleteKnowledgeNodeSuccess({ id: 'a' }));
    await flushMicrotasks();

    expect(knowledgeFacade.deleteNode).toHaveBeenCalledWith('b', true);
    actions$.next(deleteKnowledgeNodeSuccess({ id: 'b' }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(done).toHaveBeenCalledWith(['a', 'b']);
  });

  it('surfaces move failures on the error signal', async () => {
    service.setClipboard('cut', [{ id: 'a', nodeType: 'page', parentId: null, title: 'A' }]);
    service.enqueuePaste('lib', () => null);
    await flushMicrotasks();

    actions$.next(updateKnowledgeNodeFailure({ id: 'a', error: 'Move failed' }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Move failed');
  });

  it('surfaces duplicate failures while copying', async () => {
    service.setClipboard('copy', [{ id: 'a', nodeType: 'page', parentId: null, title: 'A' }]);
    service.enqueuePaste('lib', () => null);
    await flushMicrotasks();

    actions$.next(duplicateKnowledgeNodeFailure({ sourceId: 'a', error: 'Duplicate failed' }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Duplicate failed');
  });

  it('surfaces delete failures on the error signal', async () => {
    service.enqueueDelete(['a']);
    await flushMicrotasks();

    actions$.next(deleteKnowledgeNodeFailure({ id: 'a', error: 'Delete failed' }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Delete failed');
  });
});
