/** Emitted on the agents WebSocket namespace when workspace git state may have changed. */
export const GIT_STATE_CHANGED_EVENT = 'gitStateChanged';

const GIT_AFFECTING_TOOL_NAME =
  /write|edit|patch|apply|bash|shell|terminal|run|git|commit|mkdir|delete|remove|move|create/i;

export function toolMayMutateGitWorkspace(toolName: string): boolean {
  return GIT_AFFECTING_TOOL_NAME.test(toolName.trim());
}
