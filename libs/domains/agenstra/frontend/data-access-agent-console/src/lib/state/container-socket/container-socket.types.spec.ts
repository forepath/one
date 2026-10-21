import { AGENT_TASK_ACTIVE_RUN_STATUSES, isAgentTaskRunActive } from './container-socket.types';

describe('agent task run states', () => {
  it('treats running and waiting-for-handoff runs as active', () => {
    expect(AGENT_TASK_ACTIVE_RUN_STATUSES).toEqual(['running', 'awaiting_handoff']);
    expect(isAgentTaskRunActive('running')).toBe(true);
    expect(isAgentTaskRunActive('awaiting_handoff')).toBe(true);
    expect(isAgentTaskRunActive('succeeded')).toBe(false);
    expect(isAgentTaskRunActive('failed')).toBe(false);
    expect(isAgentTaskRunActive(null)).toBe(false);
  });
});
