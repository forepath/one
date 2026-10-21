import { resolveAgentChatToolDisplay } from './agent-chat-tool-display';

describe('resolveAgentChatToolDisplay', () => {
  it('maps the platform context tools to readable labels without the server prefix', () => {
    expect(resolveAgentChatToolDisplay('agenstra_context_list')).toEqual({
      label: 'Context overview',
      icon: 'collection',
    });
    expect(resolveAgentChatToolDisplay('agenstra_context_search')).toEqual({ label: 'Search context', icon: 'search' });
    expect(resolveAgentChatToolDisplay('agenstra_context_get')).toEqual({
      label: 'Read context',
      icon: 'journal-text',
    });
    expect(resolveAgentChatToolDisplay('agenstra_context_request_access')).toEqual({
      label: 'Request context access',
      icon: 'key',
    });
  });

  it('accepts unprefixed and differently cased context tool ids', () => {
    expect(resolveAgentChatToolDisplay('context_get').label).toBe('Read context');
    expect(resolveAgentChatToolDisplay(' Agenstra-Context_Search ').label).toBe('Search context');
  });

  it('keeps unknown tools as reported', () => {
    expect(resolveAgentChatToolDisplay('github_create_issue')).toEqual({
      label: 'github_create_issue',
      icon: 'wrench',
    });
    expect(resolveAgentChatToolDisplay(undefined)).toEqual({ label: 'Tool', icon: 'wrench' });
  });
});
