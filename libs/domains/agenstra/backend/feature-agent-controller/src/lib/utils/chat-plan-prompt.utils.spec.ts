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

  it('buildExecutePrompt keeps the prefix first and declares the plan authoritative', () => {
    const prompt = buildExecutePrompt('Do work', 'Original ask');

    expect(prompt.startsWith('Implement the following plan in the repository. Stay scoped to the plan below.')).toBe(
      true,
    );
    expect(prompt).toContain('supersedes every earlier draft of this plan');
    expect(prompt).not.toContain('The user edited this plan directly');
  });

  it('buildExecutePrompt calls out user edits', () => {
    expect(buildExecutePrompt('Do work', null, { editedByUser: true })).toContain('The user edited this plan directly');
  });

  it('buildRefinePrompt calls out user edits only with a plan', () => {
    expect(buildRefinePrompt('More', '# Plan', { editedByUser: true })).toContain('The user edited this plan');
    expect(buildRefinePrompt('More', null, { editedByUser: true })).not.toContain('The user edited this plan');
  });
});
