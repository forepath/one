import { parse } from 'yaml';

import {
  isValidRelativePath,
  normalizeRelativePath,
  parseVolumeId,
  restoreName,
  restoreResourceYaml,
} from './backup-restore';
import { LOADWEAVER_API_VERSION } from './resource-yaml';

const backup = { id: '6f0c1b0e-0000-4000-8000-000000000001', project: 'shop' };

describe('backup restore helpers', () => {
  it('parses volume ids and relative paths', () => {
    expect(parseVolumeId('shop/web/data')).toEqual({ project: 'shop', deployment: 'web', volume: 'data' });
    expect(parseVolumeId('shop/web')).toBeNull();
    expect(parseVolumeId('a/b/c/d')).toBeNull();
    expect(normalizeRelativePath('/uploads//2026/./a.txt/')).toBe('uploads/2026/a.txt');
    expect(normalizeRelativePath(null)).toBe('');
    expect(isValidRelativePath('uploads/a.txt')).toBe(true);
    expect(isValidRelativePath('/etc/passwd')).toBe(false);
    expect(isValidRelativePath('uploads/../x')).toBe(false);
    expect(isValidRelativePath('')).toBe(false);
  });

  it('names restores after the backup and the time', () => {
    const name = restoreName(backup, new Date(0x5f5e100));

    expect(name).toBe(`restore-6f0c1b0e-${(0x5f5e100).toString(36)}`);
    expect(name).toMatch(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
  });

  it('plans a whole-volume restore', () => {
    const doc = parse(
      restoreResourceYaml(
        { backup, deployment: 'web', volume: 'data', mode: 'replace', overwrite: true, description: '  ' },
        'restore-x',
      ),
    );

    expect(doc).toEqual({
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'Restore',
      metadata: { name: 'restore-x', project: 'shop' },
      spec: { backup: backup.id, target: { deployment: 'web', volume: 'data', mode: 'replace' } },
    });
  });

  it('plans a single-path restore with a target path', () => {
    const doc = parse(
      restoreResourceYaml(
        {
          backup,
          deployment: 'web',
          volume: 'data-restored',
          mode: 'merge',
          path: '/uploads/2026/',
          targetPath: 'uploads/restored',
          description: 'ticket 42',
        },
        'restore-y',
      ),
    );

    expect(doc.spec).toEqual({
      description: 'ticket 42',
      backup: backup.id,
      target: {
        deployment: 'web',
        volume: 'data-restored',
        mode: 'merge',
        path: 'uploads/2026',
        targetPath: 'uploads/restored',
        overwrite: false,
      },
    });
    // The same target path as the source is left out (the default).
    expect(
      parse(
        restoreResourceYaml(
          { backup, deployment: 'web', volume: 'data', mode: 'merge', path: 'a.txt', targetPath: 'a.txt' },
          'r',
        ),
      ).spec.target,
    ).toEqual({ deployment: 'web', volume: 'data', mode: 'merge', path: 'a.txt', overwrite: false });
  });
});
