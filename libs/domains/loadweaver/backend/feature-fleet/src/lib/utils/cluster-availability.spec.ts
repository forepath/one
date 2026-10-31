import {
  CLUSTER_READ_ONLY_REASON,
  CLUSTER_UNREACHABLE_REASON,
  clusterAvailability,
  clusterDatabaseFrom,
  isRelayWrite,
  RELAY_BLOCK_MAX_AGE_MS,
  relayWriteBlock,
} from './cluster-availability';

describe('cluster availability (3.43, 2026-10-31)', () => {
  describe('clusterDatabaseFrom', () => {
    it('reads controlPlane.database of GET /api/cluster', () => {
      expect(
        clusterDatabaseFrom({
          controlPlane: {
            database: {
              readOnly: true,
              freeze: 'handover h1',
              takenOverAt: '2026-10-31T10:00:00.000Z',
              readOnlyReason: '  every member is unreachable ',
            },
          },
        }),
      ).toEqual({
        readOnly: true,
        reason: 'every member is unreachable',
        freeze: 'handover h1',
        takenOverAt: '2026-10-31T10:00:00.000Z',
      });
    });

    it('drops takenOverAt once the database is on the members again (3.43 live test: shown after the handover)', () => {
      const at = '2026-10-31T12:19:46.000Z';

      expect(
        clusterDatabaseFrom({ controlPlane: { database: { readOnly: false, location: 'members', takenOverAt: at } } })
          ?.takenOverAt,
      ).toBeNull();
      expect(
        clusterDatabaseFrom({ controlPlane: { database: { readOnly: false, location: 'external', takenOverAt: at } } })
          ?.takenOverAt,
      ).toBe(at);
    });

    it('uses a default reason for read-only clusters that give none, none for writable ones', () => {
      expect(clusterDatabaseFrom({ controlPlane: { database: { readOnly: true } } })?.reason).toBe(
        CLUSTER_READ_ONLY_REASON,
      );
      expect(clusterDatabaseFrom({ controlPlane: { database: { readOnly: false, freeze: '' } } })).toEqual({
        readOnly: false,
        reason: null,
        freeze: null,
        takenOverAt: null,
      });
    });

    it('is null when the cluster reports no database state (older control planes)', () => {
      expect(clusterDatabaseFrom({ controlPlane: {} })).toBeNull();
      expect(clusterDatabaseFrom(null)).toBeNull();
      expect(clusterDatabaseFrom({ controlPlane: { database: 'x' } })).toBeNull();
    });

    it('bounds the texts', () => {
      const db = clusterDatabaseFrom({
        controlPlane: { database: { readOnly: true, readOnlyReason: 'x'.repeat(900) } },
      });

      expect(db?.reason).toHaveLength(300);
    });
  });

  describe('clusterAvailability', () => {
    const db = { readOnly: true, reason: 'members down', freeze: 'f', takenOverAt: 't' };

    it('unreachable by the fleet poll, without earlier database facts', () => {
      expect(
        clusterAvailability({ state: 'unreachable', error: 'ECONNREFUSED', checkedAt: 'c', database: db }),
      ).toEqual({
        state: 'unreachable',
        reason: 'ECONNREFUSED',
        freeze: null,
        takenOverAt: null,
        checkedAt: 'c',
      });
      expect(clusterAvailability({ state: 'unreachable' }).reason).toBe(CLUSTER_UNREACHABLE_REASON);
    });

    it('read-only when the cluster answers but can not write', () => {
      expect(clusterAvailability({ state: 'healthy', checkedAt: 'c', database: db })).toEqual({
        state: 'read-only',
        reason: 'members down',
        freeze: 'f',
        takenOverAt: 't',
        checkedAt: 'c',
      });
    });

    it('reachable otherwise (other states have their own messages)', () => {
      for (const state of ['healthy', 'degraded', 'credential-rejected', 'unknown'])
        expect(clusterAvailability({ state }).state).toBe('reachable');

      expect(clusterAvailability(null)).toEqual({
        state: 'reachable',
        reason: null,
        freeze: null,
        takenOverAt: null,
        checkedAt: null,
      });
    });
  });

  describe('relayWriteBlock', () => {
    const now = Date.parse('2026-10-31T12:00:00.000Z');
    const recent = new Date(now - 60_000).toISOString();
    const readOnly = {
      state: 'healthy',
      checkedAt: recent,
      database: { readOnly: true, reason: 'members down', freeze: null, takenOverAt: null },
    };

    it('lets reads through, including POSTs that only read', () => {
      for (const method of ['GET', 'head', 'OPTIONS'])
        expect(relayWriteBlock(method, 'plans', readOnly, 'eu', now)).toBeNull();

      expect(relayWriteBlock('POST', '/dashboards/query', readOnly, 'eu', now)).toBeNull();
      expect(relayWriteBlock('POST', 'topology/preview/', readOnly, 'eu', now)).toBeNull();
      expect(isRelayWrite('PUT', 'dashboards/query')).toBe(true);
    });

    it('refuses changes to a read-only or unreachable cluster', () => {
      expect(relayWriteBlock('POST', '/plans', readOnly, 'eu', now)).toBe(
        'cluster eu is read-only (members down): changes through the fleet are paused until it can write again',
      );
      expect(relayWriteBlock('delete', 'resources/x', { state: 'unreachable', checkedAt: recent }, 'eu', now)).toBe(
        'cluster eu is unreachable: changes through the fleet are paused until it answers again',
      );
    });

    it('does not block on an old or missing poll, nor on reachable clusters', () => {
      const old = new Date(now - RELAY_BLOCK_MAX_AGE_MS - 1).toISOString();

      expect(relayWriteBlock('POST', 'plans', { ...readOnly, checkedAt: old }, 'eu', now)).toBeNull();
      expect(relayWriteBlock('POST', 'plans', { ...readOnly, checkedAt: null }, 'eu', now)).toBeNull();
      expect(relayWriteBlock('POST', 'plans', { state: 'healthy', checkedAt: recent }, 'eu', now)).toBeNull();
    });
  });
});
