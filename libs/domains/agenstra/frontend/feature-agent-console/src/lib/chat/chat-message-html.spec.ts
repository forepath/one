import { escapeChatMessageHtml, formatUserChatMessageHtml } from './chat-message-html';

describe('chat message html', () => {
  it('escapes markup and keeps line breaks', () => {
    expect(escapeChatMessageHtml(`<b>"a" & 'b'</b>\nnext`)).toBe(
      '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;<br>next',
    );
  });

  it('renders a leading slash command as badge', () => {
    expect(formatUserChatMessageHtml('/ship now')).toBe(
      '<span class="badge bg-white text-primary me-2">/ship</span> now',
    );
  });

  it('escapes the command token itself (no markup injection through the badge)', () => {
    const html = formatUserChatMessageHtml('/<img/src/onerror=alert(1)> hi');

    expect(html).not.toContain('<img');
    expect(html).toContain('/&lt;img/src/onerror=alert(1)&gt;');
  });

  it('escapes messages without a command', () => {
    expect(formatUserChatMessageHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
});
