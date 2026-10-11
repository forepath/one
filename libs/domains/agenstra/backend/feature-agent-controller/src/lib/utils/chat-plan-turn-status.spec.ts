import {
  extractPlanMarkdownBlock,
  parsePlanTurnStatusFromAssistantText,
  resolvePlanMarkdownFromTurn,
} from './chat-plan-turn-status';

describe('chat-plan-turn-status', () => {
  const messyAssistantText = [
    'I’ll verify the repository root state without making changes, then provide the requested short plan in the required structured status format.',
    'No file edits will be made in this turn.status: ready',
    '',
    'planMarkdown: |',
    '',
    'Implementation Plan',
    'Add a new file at the repository root named HELLO_PLAN.md.',
    'Set its contents to exactly:',
    'hello from plan mode',
    'Verify the file contains no extra text beyond that line.',
  ].join('\n');

  it('extracts ready status and planMarkdown from YAML-ish assistant text', () => {
    expect(parsePlanTurnStatusFromAssistantText(messyAssistantText)).toEqual({
      status: 'ready',
      planMarkdown: [
        'Implementation Plan',
        'Add a new file at the repository root named HELLO_PLAN.md.',
        'Set its contents to exactly:',
        'hello from plan mode',
        'Verify the file contains no extra text beyond that line.',
      ].join('\n'),
    });
  });

  it('resolvePlanMarkdownFromTurn ignores preamble and status wrappers', () => {
    const md = resolvePlanMarkdownFromTurn(messyAssistantText, undefined);

    expect(md).toBe(
      [
        'Implementation Plan',
        'Add a new file at the repository root named HELLO_PLAN.md.',
        'Set its contents to exactly:',
        'hello from plan mode',
        'Verify the file contains no extra text beyond that line.',
      ].join('\n'),
    );
    expect(md).not.toContain('status: ready');
    expect(md).not.toContain('planMarkdown:');
    expect(md).not.toContain('I’ll verify');
  });

  it('prefers structured turnStatus.planMarkdown when present', () => {
    expect(
      resolvePlanMarkdownFromTurn('noise', {
        status: 'ready',
        planMarkdown: '# Clean Plan\n\nDo the thing.',
      }),
    ).toBe('# Clean Plan\n\nDo the thing.');
  });

  it('peels nested wrappers when structured planMarkdown is polluted', () => {
    const md = resolvePlanMarkdownFromTurn('noise', {
      status: 'ready',
      planMarkdown: messyAssistantText,
    });

    expect(md).toBe(
      [
        'Implementation Plan',
        'Add a new file at the repository root named HELLO_PLAN.md.',
        'Set its contents to exactly:',
        'hello from plan mode',
        'Verify the file contains no extra text beyond that line.',
      ].join('\n'),
    );
    expect(md).not.toContain('I’ll verify');
    expect(md).not.toContain('status: ready');
    expect(md).not.toContain('planMarkdown:');
  });

  it('extracts planMarkdown block during streaming before status arrives', () => {
    const partial = 'planMarkdown: |\n\n## Steps\n1. Add file\n';

    expect(extractPlanMarkdownBlock(partial)).toBe('## Steps\n1. Add file');
    expect(resolvePlanMarkdownFromTurn(partial, undefined)).toBe('## Steps\n1. Add file');
  });

  it('returns null when text has only preamble chatter', () => {
    expect(resolvePlanMarkdownFromTurn('I will explore the repo next.', undefined)).toBeNull();
  });

  it('parses embedded JSON plan status', () => {
    expect(
      parsePlanTurnStatusFromAssistantText(
        'Done.\n```json\n{"status":"ready","planMarkdown":"# Plan\\nDo it","summary":"Ready"}\n```',
      ),
    ).toEqual({
      status: 'ready',
      planMarkdown: '# Plan\nDo it',
      summary: 'Ready',
    });
  });
});
