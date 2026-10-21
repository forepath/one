/** Presentational chrome for tool rows (accordion heading / summary title). */
export interface AgentChatToolDisplayMeta {
  /** Short human label, e.g. "Apply patch". */
  label: string;
  /** Bootstrap Icons name without `bi-` prefix for `fpc-icon`. */
  icon: string;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
}

/**
 * Maps an OpenCode tool id (or embed kind) to a short label + icon for chat chrome.
 */
export function resolveAgentChatToolDisplay(toolNameOrKind: string | undefined): AgentChatToolDisplayMeta {
  const name = normalizeToolName(toolNameOrKind ?? '');

  switch (name) {
    case 'bash':
    case 'shell':
    case 'execute':
      return {
        label: $localize`:@@featureChat-toolDisplayBash:Bash`,
        icon: 'terminal',
      };
    case 'read':
      return {
        label: $localize`:@@featureChat-toolDisplayRead:Read`,
        icon: 'file-earmark-text',
      };
    case 'write':
      return {
        label: $localize`:@@featureChat-toolDisplayWrite:Write`,
        icon: 'file-earmark-plus',
      };
    case 'edit':
    case 'str_replace':
    case 'strreplace':
      return {
        label: $localize`:@@featureChat-toolDisplayEdit:Edit`,
        icon: 'pencil-square',
      };
    case 'apply_patch':
    case 'applypatch':
    case 'patch':
      return {
        label: $localize`:@@featureChat-toolDisplayPatch:Apply patch`,
        icon: 'file-diff',
      };
    case 'glob':
      return {
        label: $localize`:@@featureChat-toolDisplayGlob:Glob`,
        icon: 'folder2-open',
      };
    case 'grep':
    case 'search':
      return {
        label: $localize`:@@featureChat-toolDisplayGrep:Grep`,
        icon: 'search',
      };
    case 'todowrite':
    case 'todoread':
    case 'todo_write':
    case 'todo_read':
    case 'todos':
      return {
        label: $localize`:@@featureChat-toolDisplayTodos:Todos`,
        icon: 'list-check',
      };
    case 'webfetch':
    case 'web_fetch':
      return {
        label: $localize`:@@featureChat-toolDisplayWebfetch:Web fetch`,
        icon: 'globe2',
      };
    case 'websearch':
    case 'web_search':
      return {
        label: $localize`:@@featureChat-toolDisplayWebsearch:Web search`,
        icon: 'search',
      };
    case 'task':
    case 'subagent':
      return {
        label: $localize`:@@featureChat-toolDisplayTask:Subagent`,
        icon: 'diagram-3',
      };
    case 'skill':
      return {
        label: $localize`:@@featureChat-toolDisplaySkill:Skill`,
        icon: 'stars',
      };
    case 'invalid':
      return {
        label: $localize`:@@featureChat-toolDisplayInvalid:Invalid`,
        icon: 'exclamation-octagon',
      };
    case 'enrichment':
      return {
        label: $localize`:@@featureChat-toolDisplayEnrichment:Enrichment`,
        icon: 'database-add',
      };
    // Platform context MCP server (`agenstra_context_*`): ticket / knowledge context read on demand.
    case 'agenstra_context_list':
    case 'context_list':
      return {
        label: $localize`:@@featureChat-toolDisplayContextList:Context overview`,
        icon: 'collection',
      };
    case 'agenstra_context_search':
    case 'context_search':
      return {
        label: $localize`:@@featureChat-toolDisplayContextSearch:Search context`,
        icon: 'search',
      };
    case 'agenstra_context_get':
    case 'context_get':
      return {
        label: $localize`:@@featureChat-toolDisplayContextGet:Read context`,
        icon: 'journal-text',
      };
    case 'agenstra_context_request_access':
    case 'context_request_access':
      return {
        label: $localize`:@@featureChat-toolDisplayContextRequestAccess:Request context access`,
        icon: 'key',
      };
    // Platform task tools (`agenstra_tasks_*`): the agent manages its own recurring tasks.
    case 'agenstra_tasks_list':
    case 'tasks_list':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksList:List tasks`,
        icon: 'list-task',
      };
    case 'agenstra_tasks_get':
    case 'tasks_get':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksGet:Read task`,
        icon: 'alarm',
      };
    case 'agenstra_tasks_create':
    case 'tasks_create':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksCreate:Create task`,
        icon: 'calendar-plus',
      };
    case 'agenstra_tasks_update':
    case 'tasks_update':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksUpdate:Update task`,
        icon: 'calendar-check',
      };
    case 'agenstra_tasks_delete':
    case 'tasks_delete':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksDelete:Delete task`,
        icon: 'calendar-x',
      };
    case 'agenstra_tasks_run':
    case 'tasks_run':
      return {
        label: $localize`:@@featureChat-toolDisplayTasksRun:Run task now`,
        icon: 'play-circle',
      };
    default:
      if (!name) {
        return {
          label: $localize`:@@featureChat-toolDisplayTool:Tool`,
          icon: 'wrench',
        };
      }

      return {
        label: toolNameOrKind?.trim() || name,
        icon: 'wrench',
      };
  }
}
