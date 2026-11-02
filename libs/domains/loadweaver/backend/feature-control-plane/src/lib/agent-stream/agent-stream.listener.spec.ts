import { ListenBackoff } from '../utils/listen-backoff.utils';
import { AgentStreamServer } from './agent-stream.server';

/**
 * The desired-state listener's dedicated connection (G5): a LISTEN refused while Postgres is still in recovery must
 * give the connection back — it kept it, every retry took another one, and once the pool was empty every query of
 * the API (heartbeats, pushes, logins) waited forever.
 */
describe('desired-state listener', () => {
  it('releases the connection of a refused LISTEN, listens once Postgres accepts and then catches up on pushes', async () => {
    jest.useFakeTimers();

    try {
      let refusals = 2;
      let held = 0;
      const released: unknown[] = [];
      const listened: string[] = [];
      const server = Object.create(AgentStreamServer.prototype) as Record<string, unknown>;

      server['stopped'] = false;
      server['releaseListener'] = null;
      server['logger'] = { warn: jest.fn(), log: jest.fn() };
      server['listenBackoff'] = new ListenBackoff('Desired-state listener', { warn: jest.fn(), log: jest.fn() }, 5_000);
      const pushToAll = jest.fn(async () => undefined);

      server['pushToAll'] = pushToAll;
      server['dataSource'] = {
        driver: {
          obtainMasterConnection: async () => {
            held++;

            const client = {
              query: async (sql: string) => {
                if (refusals > 0) {
                  refusals--;
                  throw new Error('cannot execute LISTEN during recovery');
                }

                listened.push(sql);
              },
              on: () => undefined,
              removeAllListeners: () => undefined,
            };

            return [client, (err?: unknown) => (held--, released.push(err))];
          },
        },
      };

      const loop = (server['listenForDesiredState'] as () => Promise<void>).call(server);

      await jest.advanceTimersByTimeAsync(0);
      expect(held).toBe(0);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(held).toBe(0);
      // Back-off: the second failure waits 10 s.
      await jest.advanceTimersByTimeAsync(10_000);
      // The third attempt listens and keeps its one connection.
      expect(held).toBe(1);
      expect(released).toHaveLength(2);
      expect(listened).toEqual(['LISTEN lw_desired_state', expect.stringMatching(/^LISTEN /)]);
      // Once listening it catches up on revisions compiled meanwhile (no notification reached it); never before.
      expect(pushToAll).toHaveBeenCalledTimes(1);

      server['stopped'] = true;
      (server['releaseListener'] as () => void)();
      void loop;
    } finally {
      jest.useRealTimers();
    }
  });

  it('backs off while the database is gone and logs the loss and the recovery once (3.43 live test)', async () => {
    jest.useFakeTimers();

    try {
      let down = true;
      let attempts = 0;
      const log = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
      const server = Object.create(AgentStreamServer.prototype) as Record<string, unknown>;

      server['stopped'] = false;
      server['releaseListener'] = null;
      server['logger'] = log;
      server['listenBackoff'] = new ListenBackoff('Desired-state listener', log, 5_000, 30_000);
      server['pushToAll'] = jest.fn(async () => undefined);
      server['dataSource'] = {
        driver: {
          obtainMasterConnection: async () => {
            attempts++;

            if (down) throw new Error('Connection terminated unexpectedly');

            return [
              { query: async () => undefined, on: () => undefined, removeAllListeners: () => undefined },
              () => undefined,
            ];
          },
        },
      };

      void (server['listenForDesiredState'] as () => Promise<void>).call(server);
      // 45 s: attempts at 0, 5, 15, 35 s (it used to be every 5 s).
      await jest.advanceTimersByTimeAsync(45_000);
      expect(attempts).toBe(4);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][0]).toBe(
        'Desired-state listener lost: Connection terminated unexpectedly; reconnecting with back-off',
      );

      down = false;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(attempts).toBe(5);
      expect(log.log).toHaveBeenCalledWith('Desired-state listener restored after 4 failed attempt(s)');
      expect(log.warn).toHaveBeenCalledTimes(1);

      server['stopped'] = true;
      (server['releaseListener'] as () => void)();
    } finally {
      jest.useRealTimers();
    }
  });
});
