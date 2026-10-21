import { AGENT_TASK_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { parseAgentTaskCreate, parseAgentTaskId, parseAgentTaskUpdate } from './agent-task.dto';

describe('agent task dto parsing', () => {
  it('trims fields and drops unknown keys on create', () => {
    expect(
      parseAgentTaskCreate({
        title: ' Report ',
        prompt: 'Summarize',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        enabled: false,
        agentId: 'someone-else',
        clientId: 'x',
      }),
    ).toEqual({
      title: 'Report',
      prompt: 'Summarize',
      cronExpression: '0 9 * * 1-5',
      timezone: 'Europe/Berlin',
      enabled: false,
    });
  });

  it('requires title, prompt and cronExpression on create', () => {
    expect(() => parseAgentTaskCreate({ title: 'x', prompt: 'y' })).toThrow(BadRequestException);
    expect(() => parseAgentTaskCreate(null)).toThrow(BadRequestException);
  });

  it('rejects wrong types, blank strings and oversized values', () => {
    expect(() => parseAgentTaskUpdate({ title: 42 })).toThrow(BadRequestException);
    expect(() => parseAgentTaskUpdate({ prompt: '   ' })).toThrow(BadRequestException);
    expect(() => parseAgentTaskUpdate({ enabled: 'true' })).toThrow(BadRequestException);
    expect(() => parseAgentTaskUpdate({ title: 'x'.repeat(AGENT_TASK_LIMITS.titleMaxLength + 1) })).toThrow(
      BadRequestException,
    );
  });

  it('requires at least one field on update', () => {
    expect(() => parseAgentTaskUpdate({})).toThrow(BadRequestException);
    expect(parseAgentTaskUpdate({ enabled: true })).toEqual({ enabled: true });
  });

  it('accepts UUID task ids only', () => {
    expect(parseAgentTaskId(' 33333333-3333-4333-8333-33333333333A ')).toBe('33333333-3333-4333-8333-33333333333a');
    expect(() => parseAgentTaskId('task-1')).toThrow(NotFoundException);
    expect(() => parseAgentTaskId(undefined)).toThrow(NotFoundException);
  });
});
