import {
  buildChatPlanResumeSessionSuffix,
  buildExecutePrompt,
  buildExplorePrompt,
  buildRefinePrompt,
} from './chat-plan-prompt.utils';

describe('chat-plan-prompt.utils', () => {
  it('buildChatPlanResumeSessionSuffix prefixes plan id', () => {
    expect(buildChatPlanResumeSessionSuffix('abc-123')).toBe('-plan-abc-123');
  });

  it('buildExplorePrompt includes explore-only preamble and source', () => {
    const prompt = buildExplorePrompt('Add login page');

    expect(prompt).toContain('explore-only');
    expect(prompt).toContain('Add login page');
    expect(prompt).toContain('ready');
  });

  it('buildRefinePrompt includes current plan when present', () => {
    const prompt = buildRefinePrompt('Add tests', '## Steps\n1. Foo');

    expect(prompt).toContain('Add tests');
    expect(prompt).toContain('## Steps');
  });

  it('buildExecutePrompt wraps plan for agent execute (user bubble suppressed separately)', () => {
    const prompt = buildExecutePrompt('## Plan\nDo work', 'Original ask');

    expect(prompt).toContain('Implement the following plan');
    expect(prompt).toContain('Original ask');
    expect(prompt).toContain('## Plan\nDo work');
  });
});
