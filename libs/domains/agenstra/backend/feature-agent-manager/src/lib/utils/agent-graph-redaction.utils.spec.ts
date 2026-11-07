import type { AgentGraphNode } from '@forepath/agenstra/shared/util-opencode-config';

import { redactAgentGraphNodeForCaller } from './agent-graph-redaction.utils';

const environment: AgentGraphNode = { id: 'environment', type: 'environment', label: 'Secret Project' };
const rootModule: AgentGraphNode = { id: 'module:', type: 'module', label: 'Secret Project', path: '.' };
const namedModule: AgentGraphNode = { id: 'module:web', type: 'module', label: '@acme/web', path: 'web' };
const ticket: AgentGraphNode = { id: 'ticket:t1', type: 'ticket', label: 'Fire the CEO' };
const prompt: AgentGraphNode = {
  id: 'prompt:p1',
  type: 'prompt',
  label: 'Please delete the prod database',
  attrs: { startedAt: '2026-11-07T10:00:00.000Z' },
};
const foreign = { self: false, workspacePeer: false, mountId: 'mount-b', environmentName: 'Secret Project' };
const peer = { self: false, workspacePeer: true, mountId: 'mount-p', environmentName: 'Peer' };

describe('redactAgentGraphNodeForCaller', () => {
  it('keeps everything for the own environment', () => {
    for (const node of [environment, rootModule, ticket, prompt]) {
      expect(redactAgentGraphNodeForCaller(node, { self: true, workspacePeer: false }, 'references')).toBe(node);
    }
  });

  it('anonymises environments outside the workspace in every layer', () => {
    for (const layer of ['code', 'paths', 'references'] as const) {
      expect(redactAgentGraphNodeForCaller(environment, foreign, layer).label).toBe('mount-b');
      expect(redactAgentGraphNodeForCaller(rootModule, foreign, layer).label).toBe('mount-b');
      expect(redactAgentGraphNodeForCaller(namedModule, foreign, layer).label).toBe('@acme/web');
    }
  });

  it('keeps workspace peer names but redacts prompt text and controller content titles', () => {
    expect(redactAgentGraphNodeForCaller(environment, peer, 'code').label).toBe('Secret Project');
    expect(redactAgentGraphNodeForCaller(ticket, peer, 'references').label).toBe('ticket:t1');
    expect(redactAgentGraphNodeForCaller(prompt, peer, 'references').label).toBe('Prompt 2026-11-07T10:00:00.000Z');
  });
});
