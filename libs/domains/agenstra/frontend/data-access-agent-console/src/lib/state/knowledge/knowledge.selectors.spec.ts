import { initialKnowledgeState, type KnowledgeState } from './knowledge.reducer';
import {
  selectKnowledgeError,
  selectKnowledgeLoading,
  selectKnowledgeRelations,
  selectKnowledgeRelationsLoading,
  selectKnowledgeSelectedNode,
  selectKnowledgeSelectedNodeId,
  selectKnowledgeState,
  selectKnowledgeTree,
} from './knowledge.selectors';
import { type KnowledgeNodeDto } from './knowledge.types';

describe('knowledge selectors', () => {
  const rootNode: KnowledgeNodeDto = {
    id: 'folder-1',
    shas: { short: 'aaaa111', long: 'aaaa111122223333' },
    clientId: 'client-1',
    nodeType: 'folder',
    parentId: null,
    title: 'Root',
    content: null,
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    children: [
      {
        id: 'page-1',
        shas: { short: 'bbbb222', long: 'bbbb222233334444' },
        clientId: 'client-1',
        nodeType: 'page',
        parentId: 'folder-1',
        title: 'Child page',
        content: 'hello',
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ],
  };
  const createState = (overrides?: Partial<KnowledgeState>): KnowledgeState => ({
    ...initialKnowledgeState,
    ...overrides,
  });
  const root = (knowledge: KnowledgeState) => ({ knowledge }) as { knowledge: KnowledgeState };

  it('selectKnowledgeState returns feature slice', () => {
    const state = createState({ error: 'x' });

    expect(selectKnowledgeState(root(state))).toEqual(state);
  });

  it('selectKnowledgeTree returns tree', () => {
    expect(selectKnowledgeTree(root(createState({ tree: [rootNode] })))).toEqual([rootNode]);
  });

  it('selectKnowledgeLoading returns loading', () => {
    expect(selectKnowledgeLoading(root(createState({ loading: true })))).toBe(true);
  });

  it('selectKnowledgeError returns error', () => {
    expect(selectKnowledgeError(root(createState({ error: 'oops' })))).toBe('oops');
  });

  it('selectKnowledgeRelations returns relations', () => {
    const relation = {
      id: 'relation-1',
      clientId: 'client-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      targetType: 'page' as const,
      targetNodeId: 'folder-1',
      targetTicketLongSha: null,
      createdAt: '2024-01-01T00:00:00Z',
    };

    expect(selectKnowledgeRelations(root(createState({ relations: [relation] })))).toEqual([relation]);
  });

  it('selectKnowledgeRelationsLoading returns relations loading', () => {
    expect(selectKnowledgeRelationsLoading(root(createState({ relationsLoading: true })))).toBe(true);
  });

  it('selectKnowledgeSelectedNodeId returns selected id', () => {
    expect(selectKnowledgeSelectedNodeId(root(createState({ selectedNodeId: 'page-1' })))).toBe('page-1');
  });

  it('selectKnowledgeSelectedNode resolves nested node', () => {
    const state = createState({ tree: [rootNode], selectedNodeId: 'page-1' });

    expect(selectKnowledgeSelectedNode(root(state))?.id).toBe('page-1');
  });
});
