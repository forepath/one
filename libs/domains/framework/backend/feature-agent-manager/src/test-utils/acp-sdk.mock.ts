/** Jest stub for @agentclientprotocol/sdk (ESM-only package). */

export const PROTOCOL_VERSION = 1;

export class ClientSideConnection {
  constructor(
    _toClient: unknown,
    _stream: unknown,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  ) {}

  async initialize(): Promise<{ protocolVersion: number }> {
    return { protocolVersion: PROTOCOL_VERSION };
  }

  async newSession(): Promise<{ sessionId: string }> {
    return { sessionId: 'mock-session' };
  }

  async loadSession(): Promise<Record<string, never>> {
    return {};
  }

  async prompt(): Promise<{ stopReason: string }> {
    return { stopReason: 'end_turn' };
  }
}

export function ndJsonStream(): { readable: unknown; writable: unknown } {
  return { readable: {}, writable: {} };
}
