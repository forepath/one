import { resolveAgentChatToolDisplay } from '../chat/agent-chat-tool-display';

import {
  AGENT_GRAPH_HIDDEN_ATTRIBUTES,
  agentGraphAttributeLabel,
  agentGraphAttributeValue,
  agentGraphNodeDisplayLabel,
  agentGraphRelationLabel,
  agentGraphToolLabel,
  humanizeAgentGraphId,
} from './graph-labels';

describe('graph labels', () => {
  const formatDate = (value: string) => `date(${value})`;

  it('phrases relations for their direction', () => {
    expect(agentGraphRelationLabel('contains', 'outgoing')).toBe('Contains');
    expect(agentGraphRelationLabel('contains', 'incoming')).toBe('Part of');
    expect(agentGraphRelationLabel('mounted_at', 'outgoing')).toBe('Shared with other environments at');
    expect(agentGraphRelationLabel('imports', 'incoming')).toBe('Imported by');
    expect(agentGraphRelationLabel('some_new_edge', 'outgoing')).toBe('Some new edge');
  });

  it('names attributes and formats their values for people', () => {
    expect(agentGraphAttributeLabel('fileCount')).toBe('Files');
    expect(agentGraphAttributeLabel('workingDirectory')).toBe('Working directory');
    expect(agentGraphAttributeLabel('someFutureKey')).toBe('Some future key');
    expect(agentGraphAttributeValue('exported', true, 'en', formatDate)).toBe('Yes');
    expect(agentGraphAttributeValue('readOnly', false, 'en', formatDate)).toBe('No');
    expect(agentGraphAttributeValue('size', 12_345, 'en', formatDate)).toBe('12.3 kB');
    expect(agentGraphAttributeValue('bytes', 512, 'en', formatDate)).toBe('512 B');
    expect(agentGraphAttributeValue('files', 1200, 'en', formatDate)).toBe('1,200');
    expect(agentGraphAttributeValue('language', 'csharp', 'en', formatDate)).toBe('C#');
    expect(agentGraphAttributeValue('kind', 'enum', 'en', formatDate)).toBe('Enumeration');
    expect(agentGraphAttributeValue('ecosystems', ['npm', 'nx'], 'en', formatDate)).toBe('npm package, Nx project');
    expect(agentGraphAttributeValue('origin', 'hidden', 'en', formatDate)).toBe('Background run (task, handoff, plan)');
    expect(agentGraphAttributeValue('status', 'stale', 'en', formatDate)).toBe('Outdated');
    expect(agentGraphAttributeValue('startedAt', '2026-11-07T10:00:00.000Z', 'en', formatDate)).toBe(
      'date(2026-11-07T10:00:00.000Z)',
    );
    expect(agentGraphAttributeValue('title', null, 'en', formatDate)).toBe('—');
    expect(AGENT_GRAPH_HIDDEN_ATTRIBUTES.has('environmentId')).toBe(true);
  });

  it('names tools and readable node labels', () => {
    expect(agentGraphToolLabel('apply_patch')).toBe('Apply changes');
    expect(agentGraphToolLabel('read')).toBe('Read file');
    expect(agentGraphToolLabel('agenstra_graph_file')).toBe('Read file in graph');
    expect(agentGraphToolLabel('agenstra_graph_environments')).toBe('List environment graphs');
    expect(agentGraphToolLabel('agenstra_content_ticket_update')).toBe(
      resolveAgentChatToolDisplay('agenstra_content_ticket_update').label,
    );
    expect(agentGraphToolLabel('github_create_issue')).toBe('Github create issue');
    expect(agentGraphNodeDisplayLabel({ type: 'language', label: 'typescript' })).toBe('TypeScript');
    expect(agentGraphNodeDisplayLabel({ type: 'tool', label: 'grep' })).toBe('Search file contents');
    expect(agentGraphNodeDisplayLabel({ type: 'file', label: 'a.ts' })).toBe('a.ts');
    expect(humanizeAgentGraphId('mcp-server')).toBe('Mcp server');
  });
});
