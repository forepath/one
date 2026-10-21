import {
  agentContextTokensEqual,
  deriveAgentContextToken,
  resolveAgentContextTokenSecret,
} from './agent-context-token.utils';

describe('agent-context-token.utils', () => {
  it('prefers the dedicated secret and falls back to ENCRYPTION_KEY', () => {
    expect(resolveAgentContextTokenSecret({ AGENT_CONTEXT_TOKEN_SECRET: ' s1 ', ENCRYPTION_KEY: 'k' })).toBe('s1');
    expect(resolveAgentContextTokenSecret({ ENCRYPTION_KEY: 'k' })).toBe('k');
    expect(resolveAgentContextTokenSecret({ AGENT_CONTEXT_TOKEN_SECRET: '  ' })).toBeNull();
    expect(resolveAgentContextTokenSecret({})).toBeNull();
  });

  it('derives stable tokens bound to agent and credential hash', () => {
    const token = deriveAgentContextToken('secret', 'agent-1', 'hash-1');

    expect(token).toBe(deriveAgentContextToken('secret', 'agent-1', 'hash-1'));
    expect(token).not.toBe(deriveAgentContextToken('secret', 'agent-2', 'hash-1'));
    expect(token).not.toBe(deriveAgentContextToken('secret', 'agent-1', 'hash-2'));
    expect(token).not.toBe(deriveAgentContextToken('other', 'agent-1', 'hash-1'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('compares tokens in constant time without throwing on length mismatch', () => {
    expect(agentContextTokensEqual('abc', 'abc')).toBe(true);
    expect(agentContextTokensEqual('abc', 'abd')).toBe(false);
    expect(agentContextTokensEqual('abc', 'abcd')).toBe(false);
  });
});
