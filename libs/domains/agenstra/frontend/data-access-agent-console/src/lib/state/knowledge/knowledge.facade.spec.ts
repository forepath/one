import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import * as KnowledgeActions from './knowledge.actions';
import { KnowledgeFacade } from './knowledge.facade';
import { type KnowledgeNodeDto } from './knowledge.types';

describe('KnowledgeFacade', () => {
  let facade: KnowledgeFacade;
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
  const createFacadeWithMock = <T>(mockSelectReturn: T): KnowledgeFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as unknown as Store;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [KnowledgeFacade, { provide: Store, useValue: mockStore }],
    });

    return TestBed.inject(KnowledgeFacade);
  };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [KnowledgeFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(KnowledgeFacade);
  });

  it('exposes tree$', (done) => {
    createFacadeWithMock([mockNode]).tree$.subscribe((result) => {
      expect(result).toEqual([mockNode]);
      done();
    });
  });

  it('dispatches loadTree', () => {
    facade.loadTree('client-1');
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.loadKnowledgeTree({ clientId: 'client-1' }));
  });

  it('dispatches selectNode', () => {
    facade.selectNode('node-1');
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.selectKnowledgeNode({ nodeId: 'node-1' }));
  });

  it('dispatches createNode', () => {
    const dto = { clientId: 'client-1', nodeType: 'page' as const, title: 'New page' };

    facade.createNode(dto);
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.createKnowledgeNode({ dto }));
  });

  it('dispatches updateNode', () => {
    const dto = { title: 'Renamed' };

    facade.updateNode('node-1', dto);
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.updateKnowledgeNode({ id: 'node-1', dto }));
  });

  it('dispatches duplicateNode', () => {
    facade.duplicateNode('node-1');
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.duplicateKnowledgeNode({ id: 'node-1' }));
  });

  it('dispatches deleteNode', () => {
    facade.deleteNode('node-1');
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.deleteKnowledgeNode({ id: 'node-1' }));
  });

  it('dispatches deleteNode with releaseExternalSyncMarker', () => {
    facade.deleteNode('node-1', true);
    expect(store.dispatch).toHaveBeenCalledWith(
      KnowledgeActions.deleteKnowledgeNode({ id: 'node-1', releaseExternalSyncMarker: true }),
    );
  });

  it('dispatches loadRelations', () => {
    facade.loadRelations('client-1', 'page', 'node-1');
    expect(store.dispatch).toHaveBeenCalledWith(
      KnowledgeActions.loadKnowledgeRelations({ clientId: 'client-1', sourceType: 'page', sourceId: 'node-1' }),
    );
  });

  it('dispatches createRelation', () => {
    const dto = {
      clientId: 'client-1',
      sourceType: 'page' as const,
      sourceId: 'node-1',
      targetType: 'page' as const,
      targetNodeId: 'node-2',
    };

    facade.createRelation(dto);
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.createKnowledgeRelation({ dto }));
  });

  it('dispatches deleteRelation', () => {
    facade.deleteRelation('relation-1');
    expect(store.dispatch).toHaveBeenCalledWith(KnowledgeActions.deleteKnowledgeRelation({ id: 'relation-1' }));
  });
});
