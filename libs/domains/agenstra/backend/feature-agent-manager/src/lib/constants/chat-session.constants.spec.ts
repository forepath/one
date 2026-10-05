import {
  PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
  RESERVED_CHAT_RESUME_SESSION_SUFFIXES,
  TICKET_AUTOMATION_RESUME_SESSION_SUFFIXES,
  buildUserChatResumeSessionSuffix,
  isReservedChatResumeSessionSuffix,
  isTicketAutomationLoopResumeSessionSuffix,
  isTicketAutomationResumeSessionSuffix,
} from './chat-session.constants';

describe('chat-session.constants', () => {
  describe('PRIMARY_CHAT_RESUME_SESSION_SUFFIX', () => {
    it('is an empty string', () => {
      expect(PRIMARY_CHAT_RESUME_SESSION_SUFFIX).toBe('');
    });
  });

  describe('isReservedChatResumeSessionSuffix', () => {
    it('returns true for each reserved suffix', () => {
      for (const suffix of RESERVED_CHAT_RESUME_SESSION_SUFFIXES) {
        expect(isReservedChatResumeSessionSuffix(suffix)).toBe(true);
      }
    });

    it('returns false for primary empty suffix', () => {
      expect(isReservedChatResumeSessionSuffix(PRIMARY_CHAT_RESUME_SESSION_SUFFIX)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isReservedChatResumeSessionSuffix(undefined)).toBe(false);
    });

    it('returns false for user chat suffixes', () => {
      expect(isReservedChatResumeSessionSuffix('-chat-abc-123')).toBe(false);
    });
  });

  describe('isTicketAutomationResumeSessionSuffix', () => {
    it('returns true for ticket automation suffixes only', () => {
      for (const suffix of TICKET_AUTOMATION_RESUME_SESSION_SUFFIXES) {
        expect(isTicketAutomationResumeSessionSuffix(suffix)).toBe(true);
      }

      expect(isTicketAutomationResumeSessionSuffix('-prompt-enhance')).toBe(false);
      expect(isTicketAutomationResumeSessionSuffix('-chat-abc')).toBe(false);
      expect(isTicketAutomationResumeSessionSuffix(undefined)).toBe(false);
    });
  });

  describe('isTicketAutomationLoopResumeSessionSuffix', () => {
    it('returns true only for the implementation loop suffix', () => {
      expect(isTicketAutomationLoopResumeSessionSuffix('-ticket-auto-loop')).toBe(true);
      expect(isTicketAutomationLoopResumeSessionSuffix('-ticket-auto-pre')).toBe(false);
      expect(isTicketAutomationLoopResumeSessionSuffix('-ticket-auto-commit-msg')).toBe(false);
    });
  });

  describe('buildUserChatResumeSessionSuffix', () => {
    it('builds -chat-{id} suffix', () => {
      const chatId = '11111111-2222-4333-8444-555555555555';

      expect(buildUserChatResumeSessionSuffix(chatId)).toBe(`-chat-${chatId}`);
    });
  });
});
