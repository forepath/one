import {
  AGENSTRA_CONTEXT_MCP_BIN_PATH,
  AGENSTRA_CONTEXT_MCP_ENV,
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION,
  agentContextShaMatches,
  injectPlatformContextMcpWire,
  isAgenstraContextToolPermission,
  isPlatformContextMcpServerKey,
  parseAgentContextRef,
} from './context-platform';
import {
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
} from './plan-platform';

describe('context-platform', () => {
  const options = { apiUrl: 'http://agent-manager-api:3000/api', agentId: 'agent-1', agentToken: 'tok' };

  it('injects the platform MCP server as a local stdio command with its environment', () => {
    const wire = injectPlatformContextMcpWire({ mcp: { other: { type: 'remote', url: 'https://x' } } }, options);

    expect(wire['mcp']).toEqual({
      other: { type: 'remote', url: 'https://x' },
      [AGENSTRA_CONTEXT_MCP_SERVER_KEY]: {
        type: 'local',
        command: ['node', AGENSTRA_CONTEXT_MCP_BIN_PATH],
        environment: {
          [AGENSTRA_CONTEXT_MCP_ENV.apiUrl]: options.apiUrl,
          [AGENSTRA_CONTEXT_MCP_ENV.agentId]: options.agentId,
          [AGENSTRA_CONTEXT_MCP_ENV.agentToken]: options.agentToken,
        },
        enabled: true,
        timeout: expect.any(Number),
      },
    });
  });

  it('overrides a user-defined server with the platform key and leaves permission untouched', () => {
    const wire = injectPlatformContextMcpWire(
      { permission: 'ask', mcp: { [AGENSTRA_CONTEXT_MCP_SERVER_KEY]: { type: 'remote', url: 'https://evil' } } },
      options,
    );

    expect((wire['mcp'] as Record<string, { type: string }>)[AGENSTRA_CONTEXT_MCP_SERVER_KEY].type).toBe('local');
    expect(wire['permission']).toBe('ask');
  });

  it('does not mutate the input wire', () => {
    const input = { mcp: {} };

    injectPlatformContextMcpWire(input, options);

    expect(input).toEqual({ mcp: {} });
  });

  it('parses ticket, knowledge and item refs', () => {
    expect(parseAgentContextRef('ticket:ABCDEF12')).toEqual({ kind: 'ticket', sha: 'abcdef12' });
    expect(parseAgentContextRef(' knowledge:abcd ')).toEqual({ kind: 'knowledge', sha: 'abcd' });
    expect(parseAgentContextRef('item:3')).toEqual({ kind: 'item', index: 3 });
    expect(parseAgentContextRef('ticket:xyz')).toBeNull();
    expect(parseAgentContextRef('ticket:abc')).toBeNull();
    expect(parseAgentContextRef('file:/etc/passwd')).toBeNull();
  });

  it('matches full SHAs against short prefixes', () => {
    expect(agentContextShaMatches('abcdef1234', 'abcdef')).toBe(true);
    expect(agentContextShaMatches('ABCDEF', 'abcdef1234')).toBe(true);
    expect(agentContextShaMatches('abcdef', 'abcdee')).toBe(false);
    expect(agentContextShaMatches('abc', 'abc')).toBe(false);
  });

  it('identifies the platform server key and its tool permissions', () => {
    expect(isPlatformContextMcpServerKey(AGENSTRA_CONTEXT_MCP_SERVER_KEY)).toBe(true);
    expect(isPlatformContextMcpServerKey('github')).toBe(false);
    expect(isAgenstraContextToolPermission('agenstra_context_get')).toBe(true);
    expect(isAgenstraContextToolPermission('agenstra_other')).toBe(false);
    expect(isAgenstraContextToolPermission(undefined)).toBe(false);
  });

  it('allows context tools in plan sessions before the final deny rule', () => {
    const index = AGENSTRA_PLAN_SESSION_PERMISSION_RULESET.findIndex(
      (rule) => rule.permission === AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION,
    );
    const finalDeny = AGENSTRA_PLAN_SESSION_PERMISSION_RULESET.findIndex((rule) => rule.permission === '*');

    expect(index).toBeGreaterThanOrEqual(0);
    expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET[index].action).toBe('allow');
    expect(index).toBeLessThan(finalDeny);
    expect(isAgenstraPlanExplorePermission('agenstra_context_search')).toBe(true);
    expect(isAgenstraPlanWritePermission('agenstra_context_search')).toBe(false);
  });
});
