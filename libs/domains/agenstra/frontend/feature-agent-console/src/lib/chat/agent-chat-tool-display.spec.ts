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

  it('maps the platform task tools to readable labels with and without the server prefix', () => {
    expect(resolveAgentChatToolDisplay('agenstra_tasks_list')).toEqual({ label: 'List tasks', icon: 'list-task' });
    expect(resolveAgentChatToolDisplay('agenstra_tasks_get')).toEqual({ label: 'Read task', icon: 'alarm' });
    expect(resolveAgentChatToolDisplay('agenstra_tasks_create')).toEqual({
      label: 'Create task',
      icon: 'calendar-plus',
    });
    expect(resolveAgentChatToolDisplay('agenstra_tasks_update')).toEqual({
      label: 'Update task',
      icon: 'calendar-check',
    });
    expect(resolveAgentChatToolDisplay('agenstra_tasks_delete')).toEqual({ label: 'Delete task', icon: 'calendar-x' });
    expect(resolveAgentChatToolDisplay('agenstra_tasks_run')).toEqual({ label: 'Run task now', icon: 'play-circle' });
    expect(resolveAgentChatToolDisplay('tasks_create').label).toBe('Create task');
    expect(resolveAgentChatToolDisplay(' Agenstra-Tasks_Run ').label).toBe('Run task now');
  });

  it('keeps unknown tools as reported', () => {
    expect(resolveAgentChatToolDisplay('github_create_issue')).toEqual({
      label: 'github_create_issue',
      icon: 'wrench',
    });
    expect(resolveAgentChatToolDisplay(undefined)).toEqual({ label: 'Tool', icon: 'wrench' });
  });
});
