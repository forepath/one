import { ChatTurnQueue, ChatTurnQueueTimeoutError, readChatTurnQueueTimeoutMs } from './chat-turn-queue.utils';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ChatTurnQueue', () => {
  it('runs turns of one chat session one after another in arrival order', async () => {
    const queue = new ChatTurnQueue();
    const order: string[] = [];
    const releaseA = await queue.acquire('agent:chat', 1000);
    const b = queue.acquire('agent:chat', 1000).then((release) => {
      order.push('b');

      return release;
    });
    const c = queue.acquire('agent:chat', 1000).then((release) => {
      order.push('c');

      return release;
    });

    await tick();
    expect(order).toEqual([]);
    releaseA();
    (await b)();
    (await c)();
    expect(order).toEqual(['b', 'c']);
    expect(queue.size('agent:chat')).toBe(0);
  });

  it('does not block other chat sessions', async () => {
    const queue = new ChatTurnQueue();

    await queue.acquire('agent:chat-1', 1000);
    await expect(queue.acquire('agent:chat-2', 1000)).resolves.toEqual(expect.any(Function));
  });

  it('times out waiting turns without breaking the order of later ones', async () => {
    const queue = new ChatTurnQueue();
    const releaseA = await queue.acquire('k', 1000);

    await expect(queue.acquire('k', 10)).rejects.toBeInstanceOf(ChatTurnQueueTimeoutError);

    let cReady = false;
    const c = queue.acquire('k', 1000).then((release) => {
      cReady = true;

      return release;
    });

    await tick();
    expect(cReady).toBe(false);
    releaseA();
    (await c)();
    expect(cReady).toBe(true);
    expect(queue.size('k')).toBe(0);
  });

  it('ignores repeated releases', async () => {
    const queue = new ChatTurnQueue();
    const release = await queue.acquire('k', 1000);

    release();
    release();
    expect(queue.size('k')).toBe(0);
    await expect(queue.acquire('k', 1000)).resolves.toEqual(expect.any(Function));
  });

  it('reads the queue timeout from the environment with a lower bound', () => {
    expect(readChatTurnQueueTimeoutMs({})).toBe(900_000);
    expect(readChatTurnQueueTimeoutMs({ AGENT_CHAT_TURN_QUEUE_TIMEOUT_MS: '60000' })).toBe(60_000);
    expect(readChatTurnQueueTimeoutMs({ AGENT_CHAT_TURN_QUEUE_TIMEOUT_MS: '5' })).toBe(10_000);
    expect(readChatTurnQueueTimeoutMs({ AGENT_CHAT_TURN_QUEUE_TIMEOUT_MS: 'x' })).toBe(900_000);
  });
});
