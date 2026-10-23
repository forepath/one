import { AGENT_RUNTIME_KINDS, resolveAgentRuntimeKind } from './agent-runtime';

describe('resolveAgentRuntimeKind', () => {
  it('defaults to docker when AGENT_RUNTIME is unset or blank', () => {
    expect(resolveAgentRuntimeKind({})).toBe('docker');
    expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: '' })).toBe('docker');
    expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: '   ' })).toBe('docker');
  });

  it('accepts every supported runtime kind', () => {
    for (const kind of AGENT_RUNTIME_KINDS) {
      expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: kind })).toBe(kind);
    }

    expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: 'loadweaver' })).toBe('loadweaver');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: '  LoadWeaver ' })).toBe('loadweaver');
    expect(resolveAgentRuntimeKind({ AGENT_RUNTIME: 'DOCKER' })).toBe('docker');
  });

  it('throws for an unknown runtime', () => {
    expect(() => resolveAgentRuntimeKind({ AGENT_RUNTIME: 'kubernetes' })).toThrow(
      "AGENT_RUNTIME must be one of docker, loadweaver (got 'kubernetes')",
    );
  });
});
