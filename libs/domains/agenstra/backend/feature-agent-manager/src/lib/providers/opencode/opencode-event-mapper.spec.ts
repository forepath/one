import { OpenCodeEventMapper, createOpenCodeToolCallState } from './opencode-event-mapper';

describe('OpenCodeEventMapper', () => {
  const mapper = new OpenCodeEventMapper();

  it('maps text part deltas', () => {
    const events = mapper.mapEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'p1',
          sessionID: 'ses_1',
          messageID: 'msg_1',
          type: 'text',
          text: 'hello',
        },
        delta: 'hel',
      },
    });

    expect(events).toEqual([{ type: 'delta', delta: 'hel' }]);
  });

  it('maps tool call and result lifecycle', () => {
    const state = createOpenCodeToolCallState();
    const start = mapper.mapEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p2',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'tool',
            callID: 'call_1',
            tool: 'bash',
            state: {
              status: 'running',
              input: { command: 'ls' },
              time: { start: 1 },
            },
          },
        },
      },
      state,
    );
    const done = mapper.mapEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p2',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'tool',
            callID: 'call_1',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              output: 'ok',
              title: 'bash',
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        },
      },
      state,
    );

    expect(start).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'call_1',
        name: 'bash',
        status: 'running',
        args: { command: 'ls' },
      },
    ]);
    expect(done).toEqual([
      {
        type: 'tool_result',
        toolCallId: 'call_1',
        name: 'bash',
        result: 'ok',
        isError: false,
        args: { command: 'ls' },
        title: 'bash',
      },
    ]);
  });

  it('maps session.idle and builds final results', () => {
    expect(mapper.mapEvent({ type: 'session.idle', properties: { sessionID: 'ses_1' } })).toEqual([
      { type: 'session_idle', session_id: 'ses_1' },
    ]);
    expect(mapper.buildFinalResult('done', 'ses_1', { inputTokens: 1, costUsd: 0.01 })).toEqual({
      type: 'result',
      subtype: 'success',
      result: 'done',
      session_id: 'ses_1',
      usage: { inputTokens: 1, costUsd: 0.01 },
    });
  });

  it('maps permission.updated to question with options', () => {
    expect(
      mapper.mapEvent({
        type: 'permission.updated',
        properties: {
          id: 'perm_1',
          type: 'bash',
          sessionID: 'ses_1',
          title: 'Allow bash?',
          pattern: '/tmp/work',
          metadata: {},
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'question',
        subtype: 'permission',
        questionId: 'perm_1',
        request_id: 'perm_1',
        prompt: 'Allow bash?\n/tmp/work',
        options: [
          { id: 'once', label: 'Allow once' },
          { id: 'always', label: 'Allow always' },
          { id: 'reject', label: 'Reject' },
        ],
        session_id: 'ses_1',
      }),
    ]);
  });

  it('maps permission.asked with patterns into the prompt', () => {
    expect(
      mapper.mapEvent({
        type: 'permission.asked',
        properties: {
          id: 'per_abc',
          sessionID: 'ses_1',
          permission: 'external_directory',
          patterns: ['/workspace/apps'],
          metadata: { directory: '/workspace/apps' },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'question',
        subtype: 'permission',
        questionId: 'per_abc',
        prompt: 'external_directory\n/workspace/apps',
      }),
    ]);
  });

  it('maps question.asked to question with options', () => {
    expect(
      mapper.mapEvent({
        type: 'question.asked',
        properties: {
          id: 'q_1',
          sessionID: 'ses_1',
          questions: [
            {
              question: 'Pick a color',
              options: [
                { id: 'red', label: 'Red' },
                { id: 'blue', label: 'Blue' },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'question',
        questionId: 'q_1',
        request_id: 'q_1',
        prompt: 'Pick a color',
        options: [
          { id: 'red', label: 'Red' },
          { id: 'blue', label: 'Blue' },
        ],
        session_id: 'ses_1',
      }),
    ]);
  });

  it('suppresses question tool parts (interactive UI comes from question.asked)', () => {
    const state = createOpenCodeToolCallState();

    expect(
      mapper.mapEvent(
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p_q',
              sessionID: 'ses_1',
              messageID: 'msg_1',
              type: 'tool',
              callID: 'call_q',
              tool: 'question',
              state: {
                status: 'running',
                input: { questions: [{ question: 'Pick a color' }] },
                time: { start: 1 },
              },
            },
          },
        },
        state,
      ),
    ).toEqual([]);

    expect(
      mapper.mapEvent(
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p_q',
              sessionID: 'ses_1',
              messageID: 'msg_1',
              type: 'tool',
              callID: 'call_q',
              tool: 'question',
              state: {
                status: 'completed',
                input: { questions: [{ question: 'Pick a color' }] },
                output: 'Red',
                title: 'question',
                metadata: {},
                time: { start: 1, end: 2 },
              },
            },
          },
        },
        state,
      ),
    ).toEqual([]);
  });

  it('captures usage from message.updated assistant info', () => {
    const state = createOpenCodeToolCallState();

    expect(
      mapper.mapEvent(
        {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              sessionID: 'ses_1',
              role: 'assistant',
              cost: 0.02,
              tokens: {
                input: 10,
                output: 20,
                reasoning: 5,
                cache: { read: 1, write: 2 },
              },
            },
          },
        },
        state,
      ),
    ).toEqual([]);
    expect(state.lastUsage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      costUsd: 0.02,
    });
  });

  it('maps subtask parts to structured subagent tool_call events', () => {
    const state = createOpenCodeToolCallState();
    const events = mapper.mapEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'sub_1',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'subtask',
            agent: 'explore',
            description: 'Find auth bugs',
            prompt: 'Scan the auth module',
          },
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: 'tool_call',
        subtype: 'subagent',
        toolCallId: 'sub_1',
        name: 'subagent',
        status: 'running',
        args: {
          agent: 'explore',
          description: 'Find auth bugs',
          prompt: 'Scan the auth module',
        },
        session_id: 'ses_1',
      },
    ]);
  });

  it('maps task tool calls as subagent tool events', () => {
    const state = createOpenCodeToolCallState();
    const start = mapper.mapEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p_task',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'tool',
            callID: 'call_task',
            tool: 'task',
            state: {
              status: 'running',
              input: { subagent_type: 'general', description: 'Review PR', prompt: 'Look for bugs' },
              time: { start: 1 },
            },
          },
        },
      },
      state,
    );

    expect(start).toEqual([
      {
        type: 'tool_call',
        subtype: 'subagent',
        toolCallId: 'call_task',
        name: 'subagent',
        status: 'running',
        args: {
          subagent_type: 'general',
          description: 'Review PR',
          prompt: 'Look for bugs',
          agent: 'general',
        },
      },
    ]);
  });

  it('maps agent mention parts and child session lifecycle to status events', () => {
    expect(
      mapper.mapEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'a1',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'agent',
            name: 'security-auditor',
          },
        },
      }),
    ).toEqual([
      {
        type: 'status',
        subtype: 'agent_mention',
        title: 'Mention',
        result: 'Mentioned agent @security-auditor',
        message: 'Mentioned agent @security-auditor',
        name: 'security-auditor',
        session_id: 'ses_1',
      },
    ]);

    expect(
      mapper.mapEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_child',
            projectID: 'proj',
            directory: '/app',
            title: 'Find auth bugs (@explore subagent)',
            version: '1',
            parentID: 'ses_parent',
            time: { created: 1, updated: 1 },
          },
        },
      }),
    ).toEqual([
      {
        type: 'status',
        subtype: 'subagent_session',
        title: 'Subagent',
        result: 'Subagent session started: Find auth bugs (@explore subagent)',
        message: 'Subagent session started: Find auth bugs (@explore subagent)',
        session_id: 'ses_child',
        parent_session_id: 'ses_parent',
        name: 'Find auth bugs (@explore subagent)',
      },
    ]);
  });

  it('maps todo, file, command, and session status events', () => {
    expect(
      mapper.mapEvent({
        type: 'todo.updated',
        properties: {
          sessionID: 'ses_1',
          todos: [
            { id: '1', content: 'Scan auth', status: 'in_progress', priority: 'high' },
            { id: '2', content: 'Write fix', status: 'pending', priority: 'medium' },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'todo',
        title: 'Todos',
        result: '[~] Scan auth (high)\n[ ] Write fix (medium)',
      }),
    ]);

    expect(
      mapper.mapEvent({
        type: 'file.edited',
        properties: { file: 'src/auth.ts' },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'file_edited',
        result: 'File edited: src/auth.ts',
      }),
    ]);

    expect(
      mapper.mapEvent({
        type: 'command.executed',
        properties: { name: 'test', sessionID: 'ses_1', arguments: '--watch', messageID: 'm1' },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'command',
        result: 'Command /test --watch',
      }),
    ]);

    expect(
      mapper.mapEvent({
        type: 'session.status',
        properties: { sessionID: 'ses_1', status: { type: 'busy' } },
      }),
    ).toEqual([{ type: 'thinking', phase: 'running', session_id: 'ses_1' }]);

    expect(
      mapper.mapEvent({
        type: 'session.status',
        properties: {
          sessionID: 'ses_1',
          status: { type: 'retry', attempt: 2, message: 'rate limited', next: 1000 },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'session_retry',
        result: 'Retry 2: rate limited',
      }),
    ]);
  });

  it('maps patch, retry, compaction parts and session.diff', () => {
    expect(
      mapper.mapEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'patch',
            hash: 'abc',
            files: ['a.ts', 'b.ts'],
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'patch',
        result: 'Patch: a.ts, b.ts',
      }),
    ]);

    expect(
      mapper.mapEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p2',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'compaction',
            auto: true,
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'compaction',
        result: 'Automatic context compaction',
      }),
    ]);

    expect(
      mapper.mapEvent({
        type: 'session.diff',
        properties: {
          sessionID: 'ses_1',
          diff: [{ file: 'a.ts', before: '', after: 'x', additions: 1, deletions: 0 }],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'status',
        subtype: 'session_diff',
        result: 'Changed files: a.ts (+1/-0)',
      }),
    ]);
  });

  it('suppresses step-start and step-finish from chat while retaining usage', () => {
    const state = createOpenCodeToolCallState();

    expect(
      mapper.mapEvent(
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p-step-start',
              sessionID: 'ses_1',
              messageID: 'msg_1',
              type: 'step-start',
            },
          },
        },
        state,
      ),
    ).toEqual([]);

    expect(
      mapper.mapEvent(
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p-step-finish',
              sessionID: 'ses_1',
              messageID: 'msg_1',
              type: 'step-finish',
              reason: 'stop',
              cost: 0.01,
              tokens: {
                input: 10,
                output: 5,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
        state,
      ),
    ).toEqual([]);

    expect(state.lastUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    });
  });

  it('skips synthetic and hidden-context text parts', () => {
    expect(
      mapper.mapEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p-synth',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'text',
            text: 'secret',
            synthetic: true,
          },
          delta: 'secret',
        },
      }),
    ).toEqual([]);

    expect(
      mapper.mapEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p-hidden',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'text',
            text: '<hidden-context>\nhint\n</hidden-context>\nHello',
          },
        },
      }),
    ).toEqual([]);
  });
});
