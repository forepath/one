import { findLeader, LEADER_UNKNOWN_AFTER_POLLS, nextLeader } from './postgres-leader-proxy';

describe('Postgres leader proxy target', () => {
  it('asks Patroni for the running primary, not just the leader lock (G5)', async () => {
    const urls: string[] = [];
    // 10.0.0.1 holds the lock but still replays WAL after a re-create (Patroni: /leader 200, /primary 503).
    const answers: Record<string, number> = {
      'http://10.0.0.1:8008/primary': 503,
      'http://10.0.0.1:8008/leader': 200,
      'http://10.0.0.2:8008/primary': 503,
    };
    const fetchImpl = (async (url: string) => {
      urls.push(url);

      return new Response(null, { status: answers[url] ?? 404 });
    }) as unknown as typeof fetch;

    expect(await findLeader(['10.0.0.1', '10.0.0.2'], 100, fetchImpl)).toBeNull();
    expect(urls.every((u) => u.endsWith('/primary'))).toBe(true);

    answers['http://10.0.0.1:8008/primary'] = 200;
    expect(await findLeader(['10.0.0.1', '10.0.0.2'], 100, fetchImpl)).toBe('10.0.0.1');
  });

  it('treats an unreachable member as no leader', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;

    expect(await findLeader(['10.0.0.1'], 100, fetchImpl)).toBeNull();
  });

  it('keeps the primary and its connections while no primary answers (G5, live 3.43: "leader unknown" flaps)', () => {
    let state = { leader: '10.0.0.1' as string | null, misses: 0, dropConnections: false, missing: false };

    for (let i = 1; i <= LEADER_UNKNOWN_AFTER_POLLS * 3; i++) {
      state = nextLeader(state.leader, null, state.misses);
      expect(state).toEqual({
        leader: '10.0.0.1',
        misses: i,
        dropConnections: false,
        // Logged once per outage.
        missing: i === LEADER_UNKNOWN_AFTER_POLLS,
      });
    }

    // Answering again resets the count; nothing was dropped.
    expect(nextLeader(state.leader, '10.0.0.1', state.misses)).toEqual({
      leader: '10.0.0.1',
      misses: 0,
      dropConnections: false,
      missing: false,
    });
  });

  it('switches to a new primary at once and drops the connections to the old one', () => {
    expect(nextLeader('10.0.0.1', '10.0.0.2', 0)).toMatchObject({
      leader: '10.0.0.2',
      misses: 0,
      dropConnections: true,
    });
    expect(nextLeader(null, '10.0.0.2', 3)).toMatchObject({ leader: '10.0.0.2', misses: 0, dropConnections: false });
    expect(nextLeader(null, null, 0)).toMatchObject({ leader: null, dropConnections: false });
  });
});
