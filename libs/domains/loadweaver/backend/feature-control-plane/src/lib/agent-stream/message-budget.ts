/** Control messages per session and window: heartbeats every few seconds plus occasional reports. */
export const MAX_MESSAGES_PER_WINDOW = 200;
/**
 * Live-session traffic per session and window (terminal / console output, file responses, tunnel data): the agent
 * batches output per session (20 ms) and pauses sources while the stream is full, the control plane ends sessions
 * whose client doesn't read — this budget only stops a runaway agent. A VM's boot burst on its serial console alone
 * is several hundred messages in 10 s (G5), which the control budget refused by closing the node's whole stream.
 */
export const MAX_LIVE_MESSAGES_PER_WINDOW = 5_000;
export const RATE_WINDOW_MS = 10_000;

/** Fixed-window message budgets of one agent stream, live-session traffic counted apart from control messages. */
export class MessageBudget {
  private start: number;
  private control = 0;
  private live = 0;

  constructor(now = Date.now()) {
    this.start = now;
  }

  /** Counts a message; `false` once its budget in the current window is spent. */
  allow(live: boolean, now = Date.now()): boolean {
    if (now - this.start > RATE_WINDOW_MS) {
      this.start = now;
      this.control = 0;
      this.live = 0;
    }

    return live ? ++this.live <= MAX_LIVE_MESSAGES_PER_WINDOW : ++this.control <= MAX_MESSAGES_PER_WINDOW;
  }
}
