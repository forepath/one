import {
  buildPromptEnhancementMessage,
  PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX,
} from './chat-enhancement-prompt.utils';

describe('chat-enhancement-prompt.utils', () => {
  it('should expose a stable resume session suffix for cursor isolation', () => {
    expect(PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX).toBe('-prompt-enhance');
  });

  it('should include user draft in the wrapped message', () => {
    const draft = 'fix the bug';
    const out = buildPromptEnhancementMessage(draft);

    expect(out).toContain(draft);
    expect(out).toContain('<<<DRAFT>>>');
    expect(out).toContain('Output ONLY the improved prompt text');
  });
});
