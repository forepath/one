import { AcpNotificationMapper } from './acp-notification-mapper';

describe('AcpNotificationMapper', () => {
  const mapper = new AcpNotificationMapper();

  it('maps agent_message_chunk to delta', () => {
    const results = mapper.mapSessionUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
      },
    } as never);

    expect(results).toEqual([{ type: 'delta', delta: 'Hello' }]);
  });

  it('maps tool_call to tool_call unified object', () => {
    const results = mapper.mapSessionUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'bash',
        status: 'pending',
      },
    } as never);

    expect(results[0]).toMatchObject({
      type: 'tool_call',
      toolCallId: 'tc-1',
      name: 'bash',
    });
  });

  it('buildFinalResult produces result object', () => {
    expect(mapper.buildFinalResult('done', 'sess-1')).toEqual({
      type: 'result',
      subtype: 'success',
      result: 'done',
      session_id: 'sess-1',
    });
  });
});
