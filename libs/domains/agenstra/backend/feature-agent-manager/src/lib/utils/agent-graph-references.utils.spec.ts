import {
  agentGraphPathReference,
  markMissingAgentGraphReferenceTargets,
  attachedAgentGraphReferences,
  availableAgentGraphReferences,
  buildAgentGraphReferencesLayer,
  countAgentGraphReferences,
  mergeAgentGraphReferences,
  referencedAgentGraphMountIds,
  summarizeAgentGraphImplicitContext,
  toolCallAgentGraphReferences,
} from './agent-graph-references.utils';

const SHA = 'a'.repeat(40);

describe('agent graph references', () => {
  it('records attached context by reference only', () => {
    const refs = attachedAgentGraphReferences({
      ticketShas: [SHA],
      ticketContexts: ['Ticket body with secrets'],
      ticketContextRefs: [{ sha: SHA, title: 'Fix login' }],
      knowledgeShas: ['not-a-sha!'],
      attachmentContexts: [
        {
          id: 'att1',
          fileName: 'spec.pdf',
          contentType: 'application/pdf',
          byteSize: 1,
          downloadUrl: 'x',
          agentPath: '/opt/agenstra/context/x',
        },
      ],
      environmentIds: ['env-2'],
      includeWorkspace: true,
    });

    expect(refs.map((entry) => [entry.kind, entry.ref, entry.label])).toEqual([
      ['attached', `ticket:${SHA}`, 'Fix login'],
      ['attached', 'attachment:att1', 'spec.pdf'],
      ['attached', 'environment:env-2', 'environment env-2'],
      ['attached', 'mount:workspace', '/opt/workspace'],
    ]);
    expect(JSON.stringify(refs)).not.toContain('secrets');
  });

  it('records attached initiatives and documents by reference only', () => {
    const refs = attachedAgentGraphReferences({
      initiativeContexts: ['## Initiative body with secrets', '## PRD body'],
      initiativeContextRefs: [
        { kind: 'initiative', sha: SHA, title: 'Checkout' },
        { kind: 'artifact', sha: SHA.replace(/^./, 'b'), title: 'PRD' },
      ],
    });

    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'attached', type: 'initiative', ref: `initiative:${SHA}` }),
        expect.objectContaining({ kind: 'attached', type: 'artifact', ref: `artifact:${SHA.replace(/^./, 'b')}` }),
      ]),
    );
    expect(JSON.stringify(refs)).not.toContain('secrets');
  });

  it('summarizes implicit configuration by names only', () => {
    const implicit = summarizeAgentGraphImplicitContext(
      {
        instructions: ['AGENTS.md', { path: 'docs/rules.md' }],
        skills: [{ name: 'deploy', content: 'secret steps' }],
        mcp: { github: { command: ['x'], environment: { TOKEN: 'secret' } }, off: { disabled: true } },
        commands: { ship: { template: 'x' } },
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(implicit).toEqual({
      instructions: ['AGENTS.md', 'docs/rules.md'],
      skills: ['deploy'],
      mcpServers: ['github'],
      commands: ['ship'],
      agents: [],
      plugins: [],
      capturedAt: '2026-01-01T00:00:00.000Z',
    });

    const available = availableAgentGraphReferences(implicit, [{ path: 'AGENTS.md', label: 'AGENTS.md' }]);

    expect(available.map((entry) => entry.ref)).toEqual([
      'file:AGENTS.md',
      'instruction:AGENTS.md',
      'instruction:docs/rules.md',
      'skill:deploy',
      'mcp-server:github',
      'command:ship',
    ]);
  });

  it('maps tool calls to used / modified references without commands or patterns', () => {
    const options = { workingDirectory: '/app', mcpServers: ['github'] };

    expect(toolCallAgentGraphReferences('read', { filePath: '/app/src/a.ts' }, options)).toEqual([
      expect.objectContaining({ kind: 'used', type: 'tool', ref: 'tool:read' }),
      expect.objectContaining({ kind: 'used', type: 'file', ref: 'file:src/a.ts', path: 'src/a.ts' }),
    ]);
    expect(toolCallAgentGraphReferences('edit', { filePath: 'src/b.ts' }, options)[1]).toMatchObject({
      kind: 'modified',
      ref: 'file:src/b.ts',
    });
    expect(toolCallAgentGraphReferences('read', { filePath: '/opt/workspace/m1/x.ts' }, options)[1]).toMatchObject({
      ref: 'file:/opt/workspace/m1/x.ts',
    });
    expect(
      toolCallAgentGraphReferences(
        'apply_patch',
        { patchText: '*** Update File: src/c.ts\n*** Add File: src/d.ts' },
        options,
      )
        .filter((entry) => entry.kind === 'modified')
        .map((entry) => entry.ref),
    ).toEqual(['file:src/c.ts', 'file:src/d.ts']);
    expect(toolCallAgentGraphReferences('grep', { pattern: 'password=.*', path: 'src' }, options)[1]).toMatchObject({
      type: 'directory',
      ref: 'directory:src',
    });
    expect(
      JSON.stringify(toolCallAgentGraphReferences('bash', { command: 'export TOKEN=secret' }, options)),
    ).not.toContain('secret');
    expect(toolCallAgentGraphReferences('agenstra_context_get', { ref: `knowledge:${SHA}` }, options)[1]).toMatchObject(
      {
        kind: 'used',
        ref: `knowledge:${SHA}`,
      },
    );
    expect(
      toolCallAgentGraphReferences('agenstra_content_ticket_update', { ref: `ticket:${SHA}` }, options)[1],
    ).toMatchObject({
      kind: 'modified',
    });
    // Initiatives and their documents are context like tickets: read with context_get, changed with content tools.
    expect(toolCallAgentGraphReferences('agenstra_context_get', { ref: `artifact:${SHA}` }, options)[1]).toMatchObject({
      kind: 'used',
      type: 'artifact',
      ref: `artifact:${SHA}`,
    });
    expect(
      toolCallAgentGraphReferences('agenstra_content_initiative_propose', { ref: `initiative:${SHA}` }, options)[1],
    ).toMatchObject({ kind: 'modified', type: 'initiative', ref: `initiative:${SHA}` });
    expect(toolCallAgentGraphReferences('github_create_issue', {}, options)[1]).toMatchObject({
      ref: 'mcp-server:github',
    });
    expect(toolCallAgentGraphReferences('enrichment', {}, options)).toEqual([]);
  });

  it('merges, counts and builds the references layer', () => {
    const merged = mergeAgentGraphReferences(
      [{ kind: 'used', type: 'file', ref: 'file:a', label: 'a' }],
      [
        { kind: 'used', type: 'file', ref: 'file:a', label: 'a' },
        { kind: 'modified', type: 'file', ref: 'file:a', label: 'a' },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].count).toBe(2);
    expect(countAgentGraphReferences(merged)).toEqual({ attached: 0, available: 0, used: 1, modified: 1 });

    const layer = buildAgentGraphReferencesLayer([
      {
        id: 'c1',
        environmentId: 'e',
        chatSessionId: 's1',
        messageId: null,
        origin: 'chat',
        excerpt: 'Fix it',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        counts: countAgentGraphReferences(merged),
        references: merged,
      },
    ]);

    expect(layer.nodes.map((node) => node.id).sort()).toEqual(['file:a', 'prompt:c1', 'session:s1']);
    expect(layer.edges.map((edge) => edge.type).sort()).toEqual(['contains', 'modified', 'used']);
  });

  it('maps paths and finds referenced mounts', () => {
    expect(agentGraphPathReference('/app', '/app')).toEqual({ ref: 'directory:.', path: '.' });
    expect(agentGraphPathReference('../etc/passwd', '/app')).toEqual({ ref: 'file:/etc/passwd', path: '/etc/passwd' });
    expect(referencedAgentGraphMountIds(['/opt/workspace/m1/a.ts', 'src/a.ts', '/opt/workspace/m2'])).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('marks reference targets that no longer exist, keeping the history', () => {
    const layer = markMissingAgentGraphReferenceTargets(
      {
        nodes: [
          { id: 'prompt:p1', type: 'prompt', label: 'p' },
          { id: 'file:src/kept.ts', type: 'file', label: 'kept' },
          { id: 'file:src/deleted.ts', type: 'file', label: 'deleted' },
          { id: 'directory:gone', type: 'directory', label: 'gone' },
          { id: 'file:/opt/workspace/m2/a.ts', type: 'file', label: 'other env' },
          { id: 'ticket:abc1234', type: 'ticket', label: 't' },
        ],
        edges: [{ from: 'prompt:p1', to: 'file:src/deleted.ts', type: 'used' }],
      },
      new Set(['file:src/kept.ts']),
    );

    expect(layer.nodes.filter((node) => node.attrs?.['missing']).map((node) => node.id)).toEqual([
      'file:src/deleted.ts',
      'directory:gone',
    ]);
    expect(layer.edges).toHaveLength(1);
  });
});
