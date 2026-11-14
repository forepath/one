import type {
  AgentGraphDocument,
  AgentGraphNode,
  AgentGraphNodeDetail,
  AgentGraphReferencesResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { NotFoundException } from '@nestjs/common';

import {
  filterGraphByScopes,
  filterNodeDetailByScopes,
  filterPathByScopes,
  filterPromptReferencesByScopes,
  filterSearchByScopes,
  type GraphScopeCheck,
} from './workspace-graph.utils';

const only =
  (...scopes: string[]): GraphScopeCheck =>
  (scope) =>
    scopes.includes(scope);
const FILES_AND_CHATS = only('agent_files:read', 'agent_chats:read');
const file: AgentGraphNode = { id: 'file:a.ts', type: 'file', label: 'a.ts' };
const prompt: AgentGraphNode = { id: 'prompt:p1', type: 'prompt', label: 'Fix it' };
const ticket: AgentGraphNode = { id: 'ticket:t1', type: 'ticket', label: 'Secret ticket title' };
const page: AgentGraphNode = { id: 'knowledge:k1', type: 'knowledge', label: 'Secret page title' };
const envA: AgentGraphNode = {
  id: 'environment:a',
  type: 'environment',
  label: 'A',
  attrs: { mountId: 'ma', referencedMountIds: ['mb'] },
};
const envB: AgentGraphNode = { id: 'environment:b', type: 'environment', label: 'B', attrs: { mountId: 'mb' } };

function document(overrides: Partial<AgentGraphDocument> = {}): AgentGraphDocument {
  return {
    version: 1,
    scope: 'environment',
    layer: 'references',
    generatedAt: '2026-11-07T00:00:00.000Z',
    nodes: [file, prompt, ticket, page, envA, envB],
    edges: [
      { from: 'prompt:p1', to: 'file:a.ts', type: 'used' },
      { from: 'prompt:p1', to: 'ticket:t1', type: 'attached' },
      { from: 'prompt:p1', to: 'knowledge:k1', type: 'attached' },
      { from: 'environment:a', to: 'environment:b', type: 'references' },
    ],
    truncated: false,
    totalNodes: 6,
    totalEdges: 4,
    ...overrides,
  } as AgentGraphDocument;
}

describe('graph scope filters', () => {
  it('drops ticket / knowledge nodes without their scopes and keeps everything with full scopes', () => {
    const filtered = filterGraphByScopes(document(), FILES_AND_CHATS);

    expect(filtered.nodes.map((node) => node.id)).toEqual(['file:a.ts', 'prompt:p1', 'environment:a', 'environment:b']);
    expect(filtered.edges.map((edge) => edge.to)).toEqual(['file:a.ts', 'environment:b']);
    expect(JSON.stringify(filtered)).not.toContain('Secret');

    const full = document();

    expect(
      filterGraphByScopes(full, only('agent_files:read', 'agent_chats:read', 'tickets:read', 'knowledge:read')),
    ).toBe(full);
  });

  it('removes prompt-derived environment links without the chats scope', () => {
    const filtered = filterGraphByScopes(document(), only('agent_files:read', 'tickets:read', 'knowledge:read'));

    expect(filtered.nodes.some((node) => node.type === 'prompt')).toBe(false);
    expect(filtered.nodes.find((node) => node.id === 'environment:a')?.attrs).toEqual({ mountId: 'ma' });
    expect(filtered.edges.some((edge) => edge.type === 'references')).toBe(false);
  });

  it('keeps edges to allowed nodes of other pages and drops edges to hidden ones', () => {
    const page = document({
      nodes: [prompt],
      edges: [
        { from: 'prompt:p1', to: 'file:a.ts', type: 'used' },
        { from: 'prompt:p1', to: 'ticket:t1', type: 'attached' },
        { from: 'env-1::prompt:p1', to: 'env-1::knowledge:k1', type: 'attached' },
      ],
      offset: 7,
      nextOffset: 14,
    });

    expect(filterGraphByScopes(page, FILES_AND_CHATS).edges.map((edge) => edge.to)).toEqual(['file:a.ts']);
  });

  it('keeps paging fields of a page and subtracts what it removed', () => {
    const filtered = filterGraphByScopes(document({ offset: 0, nextOffset: 6, totalNodes: 20 }), FILES_AND_CHATS);

    expect(filtered.nextOffset).toBe(6);
    expect(filtered.totalNodes).toBe(18);
  });

  it('hides node details, search hits, paths and prompt references outside the scopes', () => {
    const detail: AgentGraphNodeDetail = {
      node: prompt,
      outgoing: [
        { edge: { from: 'prompt:p1', to: 'file:a.ts', type: 'used' }, node: file },
        { edge: { from: 'prompt:p1', to: 'ticket:t1', type: 'attached' }, node: ticket },
      ],
      incoming: [],
      truncated: false,
    };

    expect(filterNodeDetailByScopes(detail, FILES_AND_CHATS).outgoing.map((entry) => entry.node.id)).toEqual([
      'file:a.ts',
    ]);
    expect(() => filterNodeDetailByScopes({ ...detail, node: ticket }, FILES_AND_CHATS)).toThrow(NotFoundException);

    const search = filterSearchByScopes(
      {
        query: 'secret',
        hits: [
          { environmentId: 'a', node: ticket, score: 1 },
          { environmentId: 'a', node: file, score: 0.5 },
        ],
        byType: { ticket: 1, file: 1 },
      },
      FILES_AND_CHATS,
    );

    expect(search.hits.map((hit) => hit.node.id)).toEqual(['file:a.ts']);
    expect(search.byType).toEqual({ file: 1 });

    expect(
      filterPathByScopes({ from: 'a', to: 'b', found: true, nodes: [file, ticket], edges: [] }, FILES_AND_CHATS),
    ).toEqual({ from: 'a', to: 'b', found: false, nodes: [], edges: [] });

    const references: AgentGraphReferencesResponse = {
      environmentId: 'a',
      prompts: [],
      prompt: {
        id: 'p1',
        environmentId: 'a',
        chatSessionId: null,
        messageId: null,
        origin: 'chat',
        startedAt: '2026-11-07T00:00:00.000Z',
        finishedAt: null,
        counts: { attached: 2, available: 0, used: 1, modified: 0 },
        references: [
          { kind: 'attached', type: 'ticket', ref: 'ticket:t1', label: 'Secret ticket title' },
          { kind: 'used', type: 'file', ref: 'file:a.ts', label: 'a.ts' },
        ],
      },
    };

    expect(
      filterPromptReferencesByScopes(references, FILES_AND_CHATS).prompt?.references.map((entry) => entry.ref),
    ).toEqual(['file:a.ts']);
  });
});
