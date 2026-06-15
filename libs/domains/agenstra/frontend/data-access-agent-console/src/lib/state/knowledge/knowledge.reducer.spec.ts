import * as KnowledgeActions from './knowledge.actions';
import { initialKnowledgeState, knowledgeReducer, type KnowledgeState } from './knowledge.reducer';
import { type KnowledgeNodeDto } from './knowledge.types';

describe('knowledgeReducer', () => {
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

  it('returns initial state for unknown action', () => {
    const state = knowledgeReducer(undefined, { type: 'UNKNOWN' } as never);

    expect(state).toEqual(initialKnowledgeState);
  });

  it('handles loadKnowledgeTree', () => {
    const prev: KnowledgeState = { ...initialKnowledgeState, error: 'x' };
    const next = knowledgeReducer(prev, KnowledgeActions.loadKnowledgeTree({ clientId: 'client-1' }));

    expect(next.activeClientId).toBe('client-1');
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('handles loadKnowledgeTreeSuccess', () => {
    const prev: KnowledgeState = { ...initialKnowledgeState, loading: true };
    const next = knowledgeReducer(
      prev,
      KnowledgeActions.loadKnowledgeTreeSuccess({ clientId: 'client-1', tree: [mockNode] }),
    );

    expect(next.loading).toBe(false);
    expect(next.tree).toEqual([mockNode]);
  });

  it('handles selectKnowledgeNode', () => {
    const next = knowledgeReducer(initialKnowledgeState, KnowledgeActions.selectKnowledgeNode({ nodeId: 'node-1' }));

    expect(next.selectedNodeId).toBe('node-1');
  });

  it('handles deleteKnowledgeNodeSuccess and clears selected id', () => {
    const prev: KnowledgeState = { ...initialKnowledgeState, selectedNodeId: 'node-1', loading: true };
    const next = knowledgeReducer(prev, KnowledgeActions.deleteKnowledgeNodeSuccess({ id: 'node-1' }));

    expect(next.selectedNodeId).toBeNull();
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it('keeps selection/activity when deleting a different node', () => {
    const activity = [
      {
        id: 'a1',
        pageId: 'node-1',
        occurredAt: '2024-01-01T00:00:00Z',
        actorType: 'human' as const,
        actorUserId: 'u1',
        actorEmail: 'user@example.com',
        actionType: 'CREATED' as const,
        payload: {},
      },
    ];
    const prev: KnowledgeState = {
      ...initialKnowledgeState,
      selectedNodeId: 'node-1',
      activity,
      loading: true,
    };
    const next = knowledgeReducer(prev, KnowledgeActions.deleteKnowledgeNodeSuccess({ id: 'other-node' }));

    expect(next.selectedNodeId).toBe('node-1');
    expect(next.activity).toEqual(activity);
    expect(next.loading).toBe(false);
  });

  it('handles loadKnowledgeRelationsSuccess', () => {
    const relation = {
      id: 'relation-1',
      clientId: 'client-1',
      sourceType: 'page' as const,
      sourceId: 'node-1',
      targetType: 'page' as const,
      targetNodeId: 'node-2',
      targetTicketLongSha: null,
      createdAt: '2024-01-01T00:00:00Z',
    };
    const prev: KnowledgeState = { ...initialKnowledgeState, relationsLoading: true };
    const next = knowledgeReducer(prev, KnowledgeActions.loadKnowledgeRelationsSuccess({ relations: [relation] }));

    expect(next.relationsLoading).toBe(false);
    expect(next.relations).toEqual([relation]);
  });

  it('clears activity when selecting null node', () => {
    const prev: KnowledgeState = {
      ...initialKnowledgeState,
      selectedNodeId: 'node-1',
      activity: [
        {
          id: 'a1',
          pageId: 'node-1',
          occurredAt: '2024-01-01T00:00:00Z',
          actorType: 'human',
          actorUserId: null,
          actorEmail: null,
          actionType: 'CREATED',
          payload: {},
        },
      ],
    };
    const next = knowledgeReducer(prev, KnowledgeActions.selectKnowledgeNode({ nodeId: null }));

    expect(next.selectedNodeId).toBeNull();
    expect(next.activity).toEqual([]);
  });

  it('handles loadKnowledgeTreeFailure', () => {
    const prev: KnowledgeState = { ...initialKnowledgeState, loading: true };
    const next = knowledgeReducer(prev, KnowledgeActions.loadKnowledgeTreeFailure({ error: 'e' }));

    expect(next.loading).toBe(false);
    expect(next.error).toBe('e');
  });

  it('handles loadKnowledgeRelations and failure', () => {
    let next = knowledgeReducer(
      initialKnowledgeState,
      KnowledgeActions.loadKnowledgeRelations({ clientId: 'c1', sourceType: 'page', sourceId: 'n1' }),
    );

    expect(next.relationsLoading).toBe(true);

    next = knowledgeReducer(next, KnowledgeActions.loadKnowledgeRelationsFailure({ error: 'rel' }));
    expect(next.relationsLoading).toBe(false);
    expect(next.error).toBe('rel');
  });

  it('handles loadKnowledgeActivity success only for selected page', () => {
    const activity = [
      {
        id: 'a1',
        pageId: 'node-1',
        occurredAt: '2024-01-01T00:00:00Z',
        actorType: 'human' as const,
        actorUserId: 'u1',
        actorEmail: null,
        actionType: 'CREATED' as const,
        payload: {},
      },
    ];
    const prev: KnowledgeState = {
      ...initialKnowledgeState,
      selectedNodeId: 'node-1',
      activity: [],
      activityLoading: true,
    };
    const samePage = knowledgeReducer(
      prev,
      KnowledgeActions.loadKnowledgeActivitySuccess({ pageId: 'node-1', activity }),
    );

    expect(samePage.activity).toEqual(activity);
    expect(samePage.activityLoading).toBe(false);

    const staleActivity = [{ ...activity[0], id: 'old' }];
    const otherPage = knowledgeReducer(
      { ...prev, activity: staleActivity },
      KnowledgeActions.loadKnowledgeActivitySuccess({ pageId: 'other', activity }),
    );

    expect(otherPage.activity).toEqual(staleActivity);

    const failed = knowledgeReducer(prev, KnowledgeActions.loadKnowledgeActivityFailure({ error: 'a' }));

    expect(failed.activityLoading).toBe(false);
    expect(failed.error).toBe('a');
  });

  it('sets loading on mutate actions and clears on success', () => {
    let next = knowledgeReducer(
      initialKnowledgeState,
      KnowledgeActions.createKnowledgeNode({ dto: { nodeType: 'page', title: 'T' } }),
    );

    expect(next.loading).toBe(true);

    next = knowledgeReducer(next, KnowledgeActions.createKnowledgeNodeSuccess({ node: mockNode }));
    expect(next.loading).toBe(false);

    next = knowledgeReducer(next, KnowledgeActions.updateKnowledgeNode({ id: 'node-1', dto: { title: 'X' } }));
    expect(next.loading).toBe(true);

    next = knowledgeReducer(next, KnowledgeActions.updateKnowledgeNodeSuccess({ node: { ...mockNode, title: 'X' } }));
    expect(next.loading).toBe(false);

    next = knowledgeReducer(next, KnowledgeActions.duplicateKnowledgeNode({ id: 'node-1' }));
    next = knowledgeReducer(next, KnowledgeActions.duplicateKnowledgeNodeSuccess({ node: mockNode }));
    expect(next.loading).toBe(false);

    next = knowledgeReducer(next, KnowledgeActions.deleteKnowledgeNode({ id: 'node-1' }));
    expect(next.loading).toBe(true);
  });

  it('handles loadKnowledgeActivity', () => {
    const next = knowledgeReducer(initialKnowledgeState, KnowledgeActions.loadKnowledgeActivity({ pageId: 'p1' }));

    expect(next.activityLoading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('handles mutate failures', () => {
    const base = { ...initialKnowledgeState, loading: true };

    expect(knowledgeReducer(base, KnowledgeActions.createKnowledgeNodeFailure({ error: 'c' }))).toMatchObject({
      loading: false,
      error: 'c',
    });
    expect(knowledgeReducer(base, KnowledgeActions.updateKnowledgeNodeFailure({ error: 'u' }))).toMatchObject({
      loading: false,
      error: 'u',
    });
    expect(knowledgeReducer(base, KnowledgeActions.duplicateKnowledgeNodeFailure({ error: 'd' }))).toMatchObject({
      loading: false,
      error: 'd',
    });
    expect(knowledgeReducer(base, KnowledgeActions.deleteKnowledgeNodeFailure({ error: 'del' }))).toMatchObject({
      loading: false,
      error: 'del',
    });
  });

  it('handles relation create duplicate id and delete', () => {
    const relation = {
      id: 'r1',
      clientId: 'client-1',
      sourceType: 'page' as const,
      sourceId: 'node-1',
      targetType: 'page' as const,
      targetNodeId: 'node-2',
      targetTicketLongSha: null,
      createdAt: '2024-01-01T00:00:00Z',
    };
    let next = knowledgeReducer(
      { ...initialKnowledgeState, relations: [relation] },
      KnowledgeActions.createKnowledgeRelationSuccess({ relation }),
    );

    expect(next.relations).toEqual([relation]);

    next = knowledgeReducer(next, KnowledgeActions.deleteKnowledgeRelationSuccess({ id: 'r1' }));
    expect(next.relations).toEqual([]);
  });

  it('handles relation failures', () => {
    let next = knowledgeReducer(
      initialKnowledgeState,
      KnowledgeActions.createKnowledgeRelationFailure({ error: 'cr' }),
    );

    expect(next.relationsLoading).toBe(false);
    expect(next.error).toBe('cr');

    next = knowledgeReducer(next, KnowledgeActions.deleteKnowledgeRelationFailure({ error: 'dr' }));
    expect(next.error).toBe('dr');
  });

  it('handles prependKnowledgeActivity guards', () => {
    const row = {
      id: 'a-new',
      pageId: 'node-1',
      occurredAt: '2024-01-02T00:00:00Z',
      actorType: 'human' as const,
      actorUserId: 'u1',
      actorEmail: null,
      actionType: 'CREATED' as const,
      payload: {},
    };
    const prev: KnowledgeState = {
      ...initialKnowledgeState,
      selectedNodeId: 'node-2',
      activity: [],
    };
    const wrongPage = knowledgeReducer(prev, KnowledgeActions.prependKnowledgeActivity({ activity: row }));

    expect(wrongPage).toBe(prev);

    const prevWithDup: KnowledgeState = {
      ...initialKnowledgeState,
      selectedNodeId: 'node-1',
      activity: [row],
    };
    const dup = knowledgeReducer(prevWithDup, KnowledgeActions.prependKnowledgeActivity({ activity: row }));

    expect(dup).toBe(prevWithDup);

    const prepended = knowledgeReducer(
      { ...initialKnowledgeState, selectedNodeId: 'node-1', activity: [] },
      KnowledgeActions.prependKnowledgeActivity({ activity: row }),
    );

    expect(prepended.activity).toEqual([row]);
  });
});
