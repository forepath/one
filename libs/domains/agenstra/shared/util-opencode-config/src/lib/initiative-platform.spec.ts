import { isAgentContextElementKind, parseAgentContextRef } from './context-platform';
import {
  AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX,
  buildInitiativeResumeSessionSuffix,
  isInitiativeResumeSessionSuffix,
} from './initiative-platform';
import { isAgentTaskResumeSessionSuffix } from './task-platform';

describe('initiative platform', () => {
  it('builds and recognizes step session suffixes', () => {
    const suffix = buildInitiativeResumeSessionSuffix('3f2c6d1e-1111-4222-8333-444455556666');

    expect(suffix.startsWith(AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX)).toBe(true);
    expect(isInitiativeResumeSessionSuffix(suffix)).toBe(true);
    expect(isInitiativeResumeSessionSuffix(AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX)).toBe(false);
    expect(isInitiativeResumeSessionSuffix('-plan-123')).toBe(false);
    expect(isInitiativeResumeSessionSuffix(undefined)).toBe(false);
    expect(isAgentTaskResumeSessionSuffix(suffix)).toBe(false);
  });

  it('adds initiative and artifact context refs', () => {
    expect(parseAgentContextRef('initiative:ABCDEF12')).toEqual({ kind: 'initiative', sha: 'abcdef12' });
    expect(parseAgentContextRef('artifact:0123456789abcdef0123456789abcdef01234567')).toEqual({
      kind: 'artifact',
      sha: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(parseAgentContextRef('workitem:abcd')).toBeNull();
    expect(isAgentContextElementKind('initiative')).toBe(true);
    expect(isAgentContextElementKind('artifact')).toBe(true);
  });
});
