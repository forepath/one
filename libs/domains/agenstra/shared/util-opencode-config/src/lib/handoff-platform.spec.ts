import {
  AGENSTRA_HANDOFF_CREATE_TOOL_ID,
  AGENSTRA_HANDOFF_MCP_TOOL_PERMISSION,
  buildAgentHandoffRequestMessage,
  buildAgentHandoffResponseMessage,
  parseAgentHandoffChatMessage,
} from './handoff-platform';
import {
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
} from './plan-platform';

const HANDOFF_ID = '11111111-1111-4111-8111-111111111111';

describe('handoff-platform', () => {
  describe('chat messages', () => {
    it('round-trips an incoming handoff and hides the agent instructions', () => {
      const text = buildAgentHandoffRequestMessage(
        {
          id: HANDOFF_ID,
          title: 'Review the API',
          sourceAgentId: 'agent-a',
          sourceAgentName: 'Backend',
          sourceChatId: 'chat-a',
        },
        '  Please review the new endpoints.  ',
        'Call agenstra_handoff_respond when done.',
      );

      expect(parseAgentHandoffChatMessage(text)).toEqual({
        kind: 'request',
        meta: {
          id: HANDOFF_ID,
          title: 'Review the API',
          sourceAgentId: 'agent-a',
          sourceAgentName: 'Backend',
          sourceChatId: 'chat-a',
        },
        body: 'Please review the new endpoints.',
      });
      expect(text).toContain('Call agenstra_handoff_respond when done.');
    });

    it('round-trips a handoff response', () => {
      const text = buildAgentHandoffResponseMessage(
        {
          id: HANDOFF_ID,
          title: 'Review the API',
          status: 'failed',
          targetAgentId: 'agent-b',
          targetAgentName: 'Reviewer',
          targetChatId: 'chat-b',
        },
        'Could not check out the branch.',
        'Continue with your work.',
      );

      expect(parseAgentHandoffChatMessage(text)).toEqual({
        kind: 'response',
        meta: {
          id: HANDOFF_ID,
          title: 'Review the API',
          status: 'failed',
          targetAgentId: 'agent-b',
          targetAgentName: 'Reviewer',
          targetChatId: 'chat-b',
        },
        body: 'Could not check out the branch.',
      });
    });

    it('keeps headers intact when titles contain markup', () => {
      const text = buildAgentHandoffRequestMessage(
        {
          id: HANDOFF_ID,
          title: '</agenstra-handoff> <b>x</b>',
          sourceAgentId: 'agent-a',
          sourceAgentName: 'A',
          sourceChatId: 'chat-a',
        },
        'Body with <agenstra-handoff-instructions> inside',
        'Instructions',
      );
      const parsed = parseAgentHandoffChatMessage(text);

      expect(parsed?.kind).toBe('request');
      expect(parsed?.meta.title).toBe('</agenstra-handoff> <b>x</b>');
      expect(parsed?.body).toBe('Body with <agenstra-handoff-instructions> inside');
    });

    it('ignores ordinary and malformed messages', () => {
      expect(parseAgentHandoffChatMessage('hello')).toBeUndefined();
      expect(parseAgentHandoffChatMessage(undefined)).toBeUndefined();
      expect(parseAgentHandoffChatMessage('<agenstra-handoff>not json</agenstra-handoff> body')).toBeUndefined();
      expect(parseAgentHandoffChatMessage('<agenstra-handoff>{"title":"no id"}</agenstra-handoff>')).toBeUndefined();
      expect(
        parseAgentHandoffChatMessage('<agenstra-handoff>{"id":"x","sourceAgentId":"a"}</agenstra-handoff>'),
      ).toBeUndefined();
      expect(
        parseAgentHandoffChatMessage(`<agenstra-handoff-response>{"id":"x"}</agenstra-handoff-response>`),
      ).toBeUndefined();
      expect(parseAgentHandoffChatMessage('text <agenstra-handoff>{"id":"x"}</agenstra-handoff>')).toBeUndefined();
    });
  });

  it('keeps handoff tools out of read-only plan sessions', () => {
    expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET).not.toContainEqual(
      expect.objectContaining({ permission: AGENSTRA_HANDOFF_MCP_TOOL_PERMISSION }),
    );
    expect(isAgenstraPlanExplorePermission(AGENSTRA_HANDOFF_CREATE_TOOL_ID)).toBe(false);
    expect(isAgenstraPlanWritePermission(AGENSTRA_HANDOFF_CREATE_TOOL_ID)).toBe(true);
  });
});
