/** Escape text for insertion into trusted chat HTML (line breaks become `<br>`). */
export function escapeChatMessageHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

/**
 * HTML of a user chat message: escaped text, a leading slash command shown as badge. Every part of the message is
 * escaped (the result is trusted by the caller).
 */
export function formatUserChatMessageHtml(text: string): string {
  const commandMatch = text.match(/^(\/[^\s\n]+)(.*)$/s);

  if (!commandMatch) {
    return escapeChatMessageHtml(text);
  }

  const command = commandMatch[1] ?? '';
  const restOfMessage = commandMatch[2] ?? '';

  return `<span class="badge bg-white text-primary me-2">${escapeChatMessageHtml(command)}</span>${escapeChatMessageHtml(restOfMessage)}`;
}
