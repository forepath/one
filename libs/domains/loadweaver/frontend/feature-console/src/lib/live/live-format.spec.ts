import type { LiveReplicaTarget } from '@forepath/loadweaver/frontend/data-access-console';

import {
  DOWNLOAD_BLOB_TYPE,
  fileIcon,
  saveFile,
  sessionDuration,
  formatMode,
  portForwardCommand,
  replicaGroups,
  replicaLabel,
  sessionTargetLabel,
} from './live-format';

function replica(id: string, overrides: Partial<LiveReplicaTarget> = {}): LiveReplicaTarget {
  const [project, deployment, service, index] = id.split('/');

  return { id, project, deployment, service, index: Number(index), node: 'n1', state: 'running', ...overrides };
}

describe('live format', () => {
  it('groups replicas by deployment/service', () => {
    const replicas = [
      replica('shop/web/api/0'),
      replica('shop/web/api/1'),
      replica('shop/db/pg/0'),
      replica('blog/site/web/0'),
    ];

    expect(replicaGroups(replicas, 'shop').map((g) => [g.label, g.replicas.length])).toEqual([
      ['db/pg', 1],
      ['web/api', 2],
    ]);
    expect(replicaGroups(replicas, null).map((g) => g.label)).toContain('blog/site/web');
    expect(replicaLabel(replica('shop/web/api/1'))).toBe('api/1 · n1 (running)');
    expect(replicaLabel(replica('shop/web/api/1', { node: null, state: 'unknown' }))).toBe('api/1');
  });

  it('labels session targets and durations', () => {
    expect(sessionTargetLabel({ target: 'replica/shop/web/api/0' })).toBe('shop/web/api/0');
    expect(sessionTargetLabel({ target: 'node/n1' })).toBe('node shell n1');
    expect(sessionDuration('2026-10-18T09:12:03.000Z', '2026-10-18T09:20:41.000Z')).toBe('8m 38s');
    expect(sessionDuration('2026-10-18T09:00:00.000Z', '2026-10-18T10:02:00.000Z')).toBe('1h 2m');
    expect(sessionDuration('2026-10-18T09:00:00.000Z', '2026-10-18T09:00:12.000Z')).toBe('12s');
    expect(sessionDuration('2026-10-18T09:00:00.000Z', null)).toBeNull();
  });

  it('formats modes and icons', () => {
    expect(formatMode(0o755)).toBe('rwxr-xr-x');
    expect(formatMode(0o640)).toBe('rw-r-----');
    expect(fileIcon('etc', 'directory')).toBe('folder');
    expect(fileIcon('a.yaml', 'file')).toBe('filetype-yml');
    expect(fileIcon('hosts', 'file')).toBe('file-earmark');
  });

  it('builds the port-forward command', () => {
    expect(portForwardCommand('shop/web/db/0', 5432)).toBe('loadweaver port-forward shop/web/db/0 5432');
    expect(portForwardCommand('shop/web/db/2', 5432, 15432, 900)).toBe(
      'loadweaver port-forward shop/web/db/2 15432:5432 --ttl 900',
    );
    expect(portForwardCommand('shop/web/db/0', null)).toBe('loadweaver port-forward shop/web/db/0 <port>');
  });
});

describe('saveFile', () => {
  afterEach(() => jest.restoreAllMocks());

  it('always hands the browser an octet-stream blob through a download link', () => {
    const created: Blob[] = [];
    const revokeObjectURL = jest.fn();

    Object.assign(window.URL, {
      createObjectURL: jest.fn((blob: Blob) => {
        created.push(blob);

        return 'blob:x';
      }),
      revokeObjectURL,
    });

    const links: HTMLAnchorElement[] = [];

    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      links.push(this);
    });

    saveFile(document, new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'logo.svg');
    saveFile(document, '<h1>report</h1>', 'report.html');

    expect(created.map((b) => b.type)).toEqual([DOWNLOAD_BLOB_TYPE, DOWNLOAD_BLOB_TYPE]);
    expect(created[0].size).toBe('<svg onload="alert(1)"/>'.length);
    expect(links.map((l) => l.download)).toEqual(['logo.svg', 'report.html']);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
