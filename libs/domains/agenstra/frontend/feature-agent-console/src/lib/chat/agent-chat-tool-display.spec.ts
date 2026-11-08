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

  it('maps the platform deployment tools to readable labels with and without the server prefix', () => {
    expect(resolveAgentChatToolDisplay('agenstra_deployments_list_workflows')).toEqual({
      label: 'List pipelines',
      icon: 'rocket',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_get_workflow')).toEqual({
      label: 'Read pipeline',
      icon: 'diagram-3',
    });
    expect(resolveAgentChatToolDisplay('deployments_sync')).toEqual({
      label: 'Sync pipeline history',
      icon: 'arrow-repeat',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_trigger')).toEqual({
      label: 'Trigger pipeline run',
      icon: 'play-circle',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_cancel_run')).toEqual({
      label: 'Cancel pipeline run',
      icon: 'stop-circle',
    });
    expect(resolveAgentChatToolDisplay('deployments_get_run_logs').label).toBe('Read pipeline logs');
    expect(resolveAgentChatToolDisplay('agenstra_deployments_action_status')).toEqual({
      label: 'CI action status',
      icon: 'hourglass-split',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_list_connections')).toEqual({
      label: 'List CI/CD connections',
      icon: 'plug',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_create_workflow')).toEqual({
      label: 'Propose pipeline',
      icon: 'plus-circle',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_update_workflow')).toEqual({
      label: 'Update pipeline',
      icon: 'pencil-square',
    });
    expect(resolveAgentChatToolDisplay('agenstra_deployments_delete_workflow')).toEqual({
      label: 'Delete pipeline',
      icon: 'trash',
    });
    expect(resolveAgentChatToolDisplay('deployments_action_status').label).toBe('CI action status');
  });

  it('maps the platform handoff tools and their embed kinds to readable labels', () => {
    expect(resolveAgentChatToolDisplay('agenstra_handoff_agents')).toEqual({
      label: 'List environments',
      icon: 'people',
    });
    expect(resolveAgentChatToolDisplay('agenstra_handoff_create')).toEqual({
      label: 'Hand off task',
      icon: 'arrow-left-right',
    });
    expect(resolveAgentChatToolDisplay('agenstra_handoff_get')).toEqual({
      label: 'Read handoff',
      icon: 'arrow-repeat',
    });
    expect(resolveAgentChatToolDisplay('agenstra_handoff_respond')).toEqual({ label: 'Answer handoff', icon: 'reply' });
    expect(resolveAgentChatToolDisplay('agenstra_handoff_profile_get')).toEqual({
      label: 'Read environment profile',
      icon: 'person-vcard',
    });
    expect(resolveAgentChatToolDisplay('agenstra_handoff_profile_update')).toEqual({
      label: 'Update own profile',
      icon: 'person-gear',
    });
    expect(resolveAgentChatToolDisplay('handoff').label).toBe('Hand off task');
    expect(resolveAgentChatToolDisplay('handoffResponse').label).toBe('Answer handoff');
    expect(resolveAgentChatToolDisplay(' Agenstra-Handoff_Create ').label).toBe('Hand off task');
  });

  it('maps the plan content tool with and without the server prefix', () => {
    expect(resolveAgentChatToolDisplay('agenstra_content_plan_update')).toEqual({
      label: 'Update plan',
      icon: 'list-check',
    });
    expect(resolveAgentChatToolDisplay('content_plan_update')).toEqual({ label: 'Update plan', icon: 'list-check' });
  });

  it('keeps unknown tools as reported', () => {
    expect(resolveAgentChatToolDisplay('github_create_issue')).toEqual({
      label: 'github_create_issue',
      icon: 'wrench',
    });
    expect(resolveAgentChatToolDisplay(undefined)).toEqual({ label: 'Tool', icon: 'wrench' });
  });

  it('maps the platform graph tools (with and without the server prefix)', () => {
    expect(resolveAgentChatToolDisplay('agenstra_graph_environments')).toEqual({
      label: 'List environment graphs',
      icon: 'diagram-3',
    });
    expect(resolveAgentChatToolDisplay('graph_search').label).toBe('Search graph');
    expect(resolveAgentChatToolDisplay('agenstra_graph_path').label).toBe('Find graph connection');
    expect(resolveAgentChatToolDisplay('agenstra_graph_refresh').icon).toBe('arrow-repeat');
  });
});
