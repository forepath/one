import { buildTicketBodyFromTitleMessage, PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX } from './ticket-body-prompt.utils';

describe('ticket-body-prompt.utils', () => {
  it('should expose a stable resume session suffix for cursor isolation', () => {
    expect(PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX).toBe('-ticket-body');
  });

  it('should include trimmed title in the wrapped message', () => {
    const title = '  Ship OAuth  ';
    const out = buildTicketBodyFromTitleMessage(title);

    expect(out).toContain('Ship OAuth');
    expect(out).toContain('<<<TITLE>>>');
    expect(out).toContain('Output ONLY the body text');
    expect(out).not.toContain('<<<END_TICKET_TREE>>>');
  });

  it('should append hierarchy context when provided', () => {
    const out = buildTicketBodyFromTitleMessage('Root task', 'Subtasks under this ticket:\n- [x] Child (todo, low)');

    expect(out).toContain('<<<TICKET_TREE>>>');
    expect(out).toContain('Child (todo, low)');
    expect(out).toContain('<<<END_TICKET_TREE>>>');
  });
});
