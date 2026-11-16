const DEFAULT_CHAT_TURN_QUEUE_TIMEOUT_MS = 900_000;
const MIN_CHAT_TURN_QUEUE_TIMEOUT_MS = 10_000;

/**
 * How long a turn waits for the previous turn of its chat session (`AGENT_CHAT_TURN_QUEUE_TIMEOUT_MS`, default 15
 * minutes, at least 10 s). Longer than the controller's turn timeout, so waiting turns normally time out there first.
 */
export function readChatTurnQueueTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(env['AGENT_CHAT_TURN_QUEUE_TIMEOUT_MS'] ?? '', 10);

  return Number.isFinite(value) && value > 0
    ? Math.max(MIN_CHAT_TURN_QUEUE_TIMEOUT_MS, value)
    : DEFAULT_CHAT_TURN_QUEUE_TIMEOUT_MS;
}

/** Raised when a turn waited longer than the queue allows for the previous turn of its chat session. */
export class ChatTurnQueueTimeoutError extends Error {
  constructor() {
    super('The chat session is busy with another turn');
    this.name = 'ChatTurnQueueTimeoutError';
  }
}

interface QueueEntry {
  tail: Promise<void>;
  waiting: number;
}

/**
 * FIFO of agent turns per chat session. An OpenCode session processes one prompt at a time; when prompts overlap,
 * every waiting turn reads the session's next answer, so answers end up at the wrong caller (other API callers,
 * console users or controller replicas sharing the chat). Turns of one chat session therefore run one after another.
 */
export class ChatTurnQueue {
  private readonly queues = new Map<string, QueueEntry>();

  /**
   * Waits until all earlier turns of `key` finished and returns the release function of this turn. Rejects with
   * {@link ChatTurnQueueTimeoutError} after `timeoutMs` (the turn must not run then; its slot is released in order).
   */
  async acquire(key: string, timeoutMs: number): Promise<() => void> {
    let entry = this.queues.get(key);

    if (!entry) {
      entry = { tail: Promise.resolve(), waiting: 0 };
      this.queues.set(key, entry);
    }

    const current = entry;
    const previous = current.tail;
    let releaseSlot!: () => void;
    const slot = new Promise<void>((resolve) => (releaseSlot = resolve));

    current.tail = slot;
    current.waiting++;

    let released = false;
    const release = () => {
      if (released) {
        return;
      }

      released = true;
      current.waiting--;

      if (current.waiting === 0 && this.queues.get(key) === current) {
        this.queues.delete(key);
      }

      releaseSlot();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    const outcome = await Promise.race([previous.then(() => 'ready' as const), timedOut]);

    clearTimeout(timer);

    if (outcome === 'timeout') {
      // Keep FIFO order: this slot frees as soon as the turns before it finished.
      void previous.then(release);

      throw new ChatTurnQueueTimeoutError();
    }

    return release;
  }

  /** Turns of `key` running or waiting (diagnostics / tests). */
  size(key: string): number {
    return this.queues.get(key)?.waiting ?? 0;
  }
}
