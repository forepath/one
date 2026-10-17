import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  applyPostgresCutover,
  CLONE_MARKER,
  cutoverAction,
  effectivePostgresScope,
  readScopeMarker,
  writeScopeMarker,
} from './postgres-cutover';

const base: ControlPlaneRole = { role: 'member', members: [], automaticFailover: false, scope: 'lw-x' };
const withCutover = (node: string): ControlPlaneRole => ({
  ...base,
  platformBackups: {
    gatewayPort: 7480,
    bucket: 'lw-platform',
    region: 'garage',
    postgresCutover: { id: 'r1', scope: 'lw-x-rr1', previousScope: 'lw-x', node },
  },
});

describe('Postgres cut-over on a member (3.20)', () => {
  it('decides per member: adopt the clone, start as a replica, or leave the data alone', () => {
    expect(cutoverAction({ node: 'n1', marker: 'lw-x', role: base, cloneMarker: null })).toEqual({ kind: 'none' });
    expect(cutoverAction({ node: 'n1', marker: 'lw-x', role: withCutover('n1'), cloneMarker: 'r1' })).toEqual({
      kind: 'adopt',
      id: 'r1',
      scope: 'lw-x-rr1',
    });
    expect(cutoverAction({ node: 'n2', marker: 'lw-x', role: withCutover('n1'), cloneMarker: null })).toEqual({
      kind: 'reinit',
      id: 'r1',
      scope: 'lw-x-rr1',
    });
    // Done already (marker moved on), or data of another scope: nothing happens.
    expect(cutoverAction({ node: 'n2', marker: 'lw-x-rr1', role: withCutover('n1'), cloneMarker: null })).toEqual({
      kind: 'none',
    });
    expect(cutoverAction({ node: 'n2', marker: 'lw-y', role: withCutover('n1'), cloneMarker: null }).kind).toBe(
      'refuse',
    );
    // The adopting member needs the clone of exactly this restore.
    expect(cutoverAction({ node: 'n1', marker: 'lw-x', role: withCutover('n1'), cloneMarker: 'r0' }).kind).toBe(
      'refuse',
    );
  });

  it('runs Spilo with the marker scope; the desired state only seeds members without one', () => {
    expect(effectivePostgresScope('lw-x-rr1', { scope: 'lw-x' })).toBe('lw-x-rr1');
    expect(effectivePostgresScope(null, { scope: 'lw-x', postgresScope: 'lw-x-rr1' })).toBe('lw-x-rr1');
    expect(effectivePostgresScope(null, { scope: 'lw-x' })).toBe('lw-x');
    // A desired state naming another scope never moves existing data.
    expect(effectivePostgresScope('lw-x', { scope: 'lw-x', postgresScope: 'other' })).toBe('lw-x');
  });

  describe('on disk', () => {
    let dir: string;
    const removed: string[] = [];
    const containers = {
      postgres: 'lw-postgres',
      clone: 'lw-postgres-pitr',
      remove: async (name: string) => {
        removed.push(name);

        return true;
      },
    };

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'lw-cutover-'));
      removed.length = 0;
      await mkdir(join(dir, 'postgres', 'pgroot'), { recursive: true });
      await writeFile(join(dir, 'postgres', 'pgroot', 'old'), 'old timeline');
    });

    afterEach(async () => await rm(dir, { recursive: true, force: true }));

    it('writes the marker on first start and keeps it', async () => {
      expect(await applyPostgresCutover(dir, 'n1', base, containers, () => undefined)).toBe('lw-x');
      expect(await readScopeMarker(dir)).toBe('lw-x');
      expect(removed).toEqual([]);
    });

    it('adopts the clone directory, keeping the previous data aside', async () => {
      await writeScopeMarker(dir, 'lw-x');
      await mkdir(join(dir, 'postgres-pitr', 'pgroot'), { recursive: true });
      await writeFile(join(dir, 'postgres-pitr', CLONE_MARKER), 'r1\n');
      await writeFile(join(dir, 'postgres-pitr', 'pgroot', 'new'), 'clone');
      await mkdir(join(dir, 'postgres.pre-older'));

      const lines: string[] = [];

      expect(await applyPostgresCutover(dir, 'n1', withCutover('n1'), containers, (l) => lines.push(l))).toBe(
        'lw-x-rr1',
      );
      expect(removed).toEqual(['lw-postgres', 'lw-postgres-pitr']);
      expect(await readFile(join(dir, 'postgres', 'pgroot', 'new'), 'utf8')).toBe('clone');
      expect(await readFile(join(dir, 'postgres.pre-r1', 'pgroot', 'old'), 'utf8')).toBe('old timeline');
      expect((await readdir(dir)).sort()).toEqual(['postgres', 'postgres-scope', 'postgres.pre-r1']);
      expect(await readScopeMarker(dir)).toBe('lw-x-rr1');
      expect(lines[0]).toContain('adopted the clone');

      // Idempotent: the next desired state with the same cut-over changes nothing.
      removed.length = 0;
      expect(await applyPostgresCutover(dir, 'n1', withCutover('n1'), containers, () => undefined)).toBe('lw-x-rr1');
      expect(removed).toEqual([]);
    });

    it('starts another member empty in the new scope (a replica of the clone)', async () => {
      await writeScopeMarker(dir, 'lw-x');

      expect(await applyPostgresCutover(dir, 'n2', withCutover('n1'), containers, () => undefined)).toBe('lw-x-rr1');
      expect(removed).toEqual(['lw-postgres']);
      expect(await readdir(join(dir, 'postgres'))).toEqual([]);
      expect(await readFile(join(dir, 'postgres.pre-r1', 'pgroot', 'old'), 'utf8')).toBe('old timeline');
    });

    it('refuses to adopt without the clone and keeps running the old scope', async () => {
      await writeScopeMarker(dir, 'lw-x');

      const lines: string[] = [];

      expect(await applyPostgresCutover(dir, 'n1', withCutover('n1'), containers, (l) => lines.push(l))).toBe('lw-x');
      expect(removed).toEqual([]);
      expect(lines[0]).toContain('no clone of restore r1');
      expect(await readFile(join(dir, 'postgres', 'pgroot', 'old'), 'utf8')).toBe('old timeline');
    });
  });
});
