import {
  extractVncTicketFromProtocols,
  isAllowedWebsocketOrigin,
  selectVncWebsocketProtocol,
} from './vnc-websocket.utils';

describe('vnc-websocket.utils', () => {
  describe('isAllowedWebsocketOrigin', () => {
    it('allows all when cors is *', () => {
      expect(isAllowedWebsocketOrigin('https://evil.example', '*', 'production')).toBe(true);
    });

    it('fail-closes browser Origin when production allowlist is unset', () => {
      expect(isAllowedWebsocketOrigin('https://app.example', undefined, 'production')).toBe(false);
      expect(isAllowedWebsocketOrigin(undefined, undefined, 'production')).toBe(true);
    });

    it('matches explicit allowlist', () => {
      expect(isAllowedWebsocketOrigin('https://app.example', 'https://app.example,https://other.example')).toBe(true);
      expect(isAllowedWebsocketOrigin('https://evil.example', 'https://app.example')).toBe(false);
    });
  });

  describe('extractVncTicketFromProtocols', () => {
    it('reads ticket from Sec-WebSocket-Protocol', () => {
      const ticket = extractVncTicketFromProtocols(
        { headers: { 'sec-websocket-protocol': 'binary, agenstra.vnc.ticket-value' } } as never,
        'agenstra.vnc.',
      );

      expect(ticket).toBe('ticket-value');
    });

    it('throws when ticket protocol is missing', () => {
      expect(() =>
        extractVncTicketFromProtocols({ headers: { 'sec-websocket-protocol': 'binary' } } as never, 'agenstra.vnc.'),
      ).toThrow('Missing ticket');
    });
  });

  describe('selectVncWebsocketProtocol', () => {
    it('prefers binary when offered', () => {
      expect(selectVncWebsocketProtocol(new Set(['binary', 'agenstra.vnc.t']), 'agenstra.vnc.')).toBe('binary');
    });
  });
});
