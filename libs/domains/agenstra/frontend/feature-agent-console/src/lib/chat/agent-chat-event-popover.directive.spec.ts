import { escapeHtmlForAgentChatPopover } from './agent-chat-event-popover.directive';

describe('escapeHtmlForAgentChatPopover', () => {
  it('escapes characters that would break HTML popover bodies', () => {
    const raw = '<tool>args & more';

    expect(escapeHtmlForAgentChatPopover(raw)).toBe('&lt;tool&gt;args &amp; more');
  });
});
