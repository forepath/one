import {
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
} from './plan-platform';
import {
  AGENSTRA_TASKS_MCP_TOOL_PERMISSION,
  AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX,
  buildAgentTaskResumeSessionSuffix,
  isAgentTaskResumeSessionSuffix,
} from './task-platform';

describe('task-platform', () => {
  it('builds and recognizes task session suffixes', () => {
    const suffix = buildAgentTaskResumeSessionSuffix('11111111-1111-4111-8111-111111111111');

    expect(suffix).toBe(`${AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX}11111111-1111-4111-8111-111111111111`);
    expect(isAgentTaskResumeSessionSuffix(suffix)).toBe(true);
  });

  it('rejects the bare prefix, other reserved suffixes and the primary session', () => {
    expect(isAgentTaskResumeSessionSuffix(AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX)).toBe(false);
    expect(isAgentTaskResumeSessionSuffix('-ticket-auto-loop')).toBe(false);
    expect(isAgentTaskResumeSessionSuffix('-plan-abc')).toBe(false);
    expect(isAgentTaskResumeSessionSuffix('')).toBe(false);
    expect(isAgentTaskResumeSessionSuffix(undefined)).toBe(false);
  });

  it('keeps task tools out of read-only plan sessions', () => {
    expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET).not.toContainEqual(
      expect.objectContaining({ permission: AGENSTRA_TASKS_MCP_TOOL_PERMISSION }),
    );
    expect(isAgenstraPlanExplorePermission('agenstra_tasks_create')).toBe(false);
    expect(isAgenstraPlanWritePermission('agenstra_tasks_create')).toBe(true);
  });
});
