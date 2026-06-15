import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import { KnowledgeService } from '../../services/knowledge.service';

import * as KnowledgeActions from './knowledge.actions';
import {
  createKnowledgeRelation$,
  createKnowledgeNode$,
  deleteKnowledgeRelation$,
  deleteKnowledgeNode$,
  duplicateKnowledgeNode$,
  loadKnowledgeRelations$,
  loadKnowledgeTree$,
  reloadRelationsAfterWrite$,
  reloadTreeAfterWrite$,
  updateKnowledgeNode$,
} from './knowledge.effects';
import { type KnowledgeNodeDto, type KnowledgeRelationDto } from './knowledge.types';

describe('knowledge effects', () => {
  let actions$: Actions;
  let knowledgeService: jest.Mocked<KnowledgeService>;
  let store: jest.Mocked<Store>;
  const mockNode: KnowledgeNodeDto = {
    id: 'node-1',
    shas: { short: 'abc1234', long: 'abc1234567890' },
    clientId: 'client-1',
    nodeType: 'page',
    parentId: null,
    title: 'Page',
    content: 'content',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockRelation: KnowledgeRelationDto = {
    id: 'relation-1',
    clientId: 'client-1',
    sourceType: 'page',
    sourceId: 'node-1',
    targetType: 'page',
    targetNodeId: 'node-2',
    targetTicketLongSha: null,
    createdAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    knowledgeService = {
      listByClient: jest.fn(),
      getTree: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      duplicate: jest.fn(),
      delete: jest.fn(),
      listRelations: jest.fn(),
      createRelation: jest.fn(),
      deleteRelation: jest.fn(),
    } as unknown as jest.Mocked<KnowledgeService>;

    store = {
      select: jest.fn().mockReturnValue(of('client-1')),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: KnowledgeService, useValue: knowledgeService },
        { provide: Store, useValue: store },
      ],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loadKnowledgeTree$ emits success', (done) => {
    actions$ = of(KnowledgeActions.loadKnowledgeTree({ clientId: 'client-1' }));
    knowledgeService.getTree.mockReturnValue(of([mockNode]));

    loadKnowledgeTree$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.loadKnowledgeTreeSuccess({ clientId: 'client-1', tree: [mockNode] }));
      done();
    });
  });

  it('createKnowledgeNode$ emits failure on error', (done) => {
    actions$ = of(
      KnowledgeActions.createKnowledgeNode({ dto: { clientId: 'client-1', nodeType: 'page', title: 'x' } }),
    );
    knowledgeService.create.mockReturnValue(throwError(() => new Error('boom')));

    createKnowledgeNode$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.createKnowledgeNodeFailure({ error: 'boom' }));
      done();
    });
  });

  it('updateKnowledgeNode$ emits success', (done) => {
    actions$ = of(KnowledgeActions.updateKnowledgeNode({ id: 'node-1', dto: { title: 'renamed' } }));
    knowledgeService.update.mockReturnValue(of(mockNode));

    updateKnowledgeNode$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.updateKnowledgeNodeSuccess({ node: mockNode }));
      done();
    });
  });

  it('duplicateKnowledgeNode$ emits success', (done) => {
    actions$ = of(KnowledgeActions.duplicateKnowledgeNode({ id: 'node-1' }));
    knowledgeService.duplicate.mockReturnValue(of(mockNode));

    duplicateKnowledgeNode$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.duplicateKnowledgeNodeSuccess({ node: mockNode }));
      done();
    });
  });

  it('deleteKnowledgeNode$ emits success', (done) => {
    actions$ = of(KnowledgeActions.deleteKnowledgeNode({ id: 'node-1' }));
    knowledgeService.delete.mockReturnValue(of(undefined));

    deleteKnowledgeNode$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.deleteKnowledgeNodeSuccess({ id: 'node-1' }));
      expect(knowledgeService.delete).toHaveBeenCalledWith('node-1', undefined);
      done();
    });
  });

  it('deleteKnowledgeNode$ passes releaseExternalSyncMarker', (done) => {
    actions$ = of(KnowledgeActions.deleteKnowledgeNode({ id: 'node-1', releaseExternalSyncMarker: true }));
    knowledgeService.delete.mockReturnValue(of(undefined));

    deleteKnowledgeNode$(actions$, knowledgeService).subscribe(() => {
      expect(knowledgeService.delete).toHaveBeenCalledWith('node-1', true);
      done();
    });
  });

  it('loadKnowledgeRelations$ emits success', (done) => {
    actions$ = of(
      KnowledgeActions.loadKnowledgeRelations({ clientId: 'client-1', sourceType: 'page', sourceId: 'node-1' }),
    );
    knowledgeService.listRelations.mockReturnValue(of([mockRelation]));

    loadKnowledgeRelations$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.loadKnowledgeRelationsSuccess({ relations: [mockRelation] }));
      done();
    });
  });

  it('createKnowledgeRelation$ emits success', (done) => {
    actions$ = of(
      KnowledgeActions.createKnowledgeRelation({
        dto: {
          clientId: 'client-1',
          sourceType: 'page',
          sourceId: 'node-1',
          targetType: 'page',
          targetNodeId: 'node-2',
        },
      }),
    );
    knowledgeService.createRelation.mockReturnValue(of(mockRelation));

    createKnowledgeRelation$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.createKnowledgeRelationSuccess({ relation: mockRelation }));
      done();
    });
  });

  it('deleteKnowledgeRelation$ emits success', (done) => {
    actions$ = of(KnowledgeActions.deleteKnowledgeRelation({ id: 'relation-1' }));
    knowledgeService.deleteRelation.mockReturnValue(of(undefined));

    deleteKnowledgeRelation$(actions$, knowledgeService).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.deleteKnowledgeRelationSuccess({ id: 'relation-1' }));
      done();
    });
  });

  it('reloadTreeAfterWrite$ emits loadKnowledgeTree for active client', (done) => {
    actions$ = of(KnowledgeActions.createKnowledgeNodeSuccess({ node: mockNode }));
    store.select.mockReturnValue(of('client-1'));

    reloadTreeAfterWrite$(actions$, store).subscribe((result) => {
      expect(result).toEqual(KnowledgeActions.loadKnowledgeTree({ clientId: 'client-1' }));
      done();
    });
  });

  it('reloadRelationsAfterWrite$ emits loadKnowledgeRelations for active client and node', (done) => {
    actions$ = of(KnowledgeActions.createKnowledgeRelationSuccess({ relation: mockRelation }));
    store.select.mockReturnValueOnce(of('client-1')).mockReturnValueOnce(of('node-1'));

    reloadRelationsAfterWrite$(actions$, store).subscribe((result) => {
      expect(result).toEqual(
        KnowledgeActions.loadKnowledgeRelations({ clientId: 'client-1', sourceType: 'page', sourceId: 'node-1' }),
      );
      done();
    });
  });
});
