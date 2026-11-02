import type { TopologyGraph } from '../types/topology.types';
import {
  contentRangeTotal,
  isLiveFileTarget,
  isReplicaId,
  joinLivePath,
  liveBaseName,
  liveFileLanguage,
  liveFileType,
  livePathCrumbs,
  liveTargetsFromTopology,
  newUploadId,
  normalizeLivePath,
  parentLivePath,
  uploadChunks,
} from './live-files';

describe('live files utils', () => {
  it('validates replica ids and file targets', () => {
    expect(isReplicaId('shop/web/api/0')).toBe(true);
    expect(isReplicaId('shop/web/api')).toBe(false);
    expect(isLiveFileTarget('replica:shop/web/api/0')).toBe(true);
    expect(isLiveFileTarget('volume:shop/web/data')).toBe(true);
    expect(isLiveFileTarget('volume:shop/web/data/1')).toBe(false);
    expect(isLiveFileTarget('node:n1')).toBe(false);
    expect(isLiveFileTarget(null)).toBe(false);
  });

  it('handles paths', () => {
    expect(normalizeLivePath('etc//nginx/./')).toBe('/etc/nginx');
    expect(normalizeLivePath('')).toBe('/');
    expect(joinLivePath('/etc/', 'nginx.conf')).toBe('/etc/nginx.conf');
    expect(joinLivePath('/', 'tmp')).toBe('/tmp');
    expect(parentLivePath('/etc/nginx')).toBe('/etc');
    expect(parentLivePath('/')).toBe('/');
    expect(liveBaseName('/etc/nginx/nginx.conf')).toBe('nginx.conf');
    expect(livePathCrumbs('/etc/nginx')).toEqual([
      { label: '/', path: '/' },
      { label: 'etc', path: '/etc' },
      { label: 'nginx', path: '/etc/nginx' },
    ]);
  });

  it('types files like the API and picks an editor language', () => {
    expect(liveFileType('/etc/hosts')).toBe('text');
    expect(liveFileType('/a/logo.PNG')).toBe('image');
    expect(liveFileType('/a/b.pdf')).toBe('pdf');
    expect(liveFileType('/a/b.tar.gz')).toBe('binary');
    expect(liveFileLanguage('/a/b.yml')).toBe('yaml');
    expect(liveFileLanguage('/app/Dockerfile')).toBe('dockerfile');
    expect(liveFileLanguage('/etc/hosts')).toBe('plaintext');
  });

  it('plans upload chunks with Content-Range headers', () => {
    expect(uploadChunks(10, 4)).toEqual([
      { start: 0, end: 3, header: 'bytes 0-3/10' },
      { start: 4, end: 7, header: 'bytes 4-7/10' },
      { start: 8, end: 9, header: 'bytes 8-9/10' },
    ]);
    expect(uploadChunks(0)).toEqual([]);
    expect(newUploadId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(contentRangeTotal('bytes 0-1023/4096')).toBe(4096);
    expect(contentRangeTotal(null)).toBeNull();
  });

  it('derives targets from the topology', () => {
    const graph: TopologyGraph = {
      at: '2026-10-18T09:00:00.000Z',
      edges: [],
      elements: [
        { id: 'node:n2', kind: 'node', label: 'n2', data: {} },
        { id: 'node:n1', kind: 'node', label: 'n1', data: {} },
        {
          id: 'replica:shop/web/api/1',
          kind: 'replica',
          label: 'api/1',
          parent: 'node:n2',
          project: 'shop',
          data: { state: 'running' },
        },
        { id: 'replica:shop/web/api/0', kind: 'replica', label: 'api/0', project: 'shop', data: {} },
        { id: 'volume:shop/web/data', kind: 'volume', label: 'data', project: 'shop', data: {} },
        { id: 'site:fra', kind: 'site', label: 'fra', data: {} },
      ],
    };

    expect(liveTargetsFromTopology(graph)).toEqual({
      replicas: [
        {
          id: 'shop/web/api/0',
          project: 'shop',
          deployment: 'web',
          service: 'api',
          index: 0,
          node: null,
          state: 'unknown',
        },
        {
          id: 'shop/web/api/1',
          project: 'shop',
          deployment: 'web',
          service: 'api',
          index: 1,
          node: 'n2',
          state: 'running',
        },
      ],
      volumes: [{ id: 'shop/web/data', project: 'shop', deployment: 'web', name: 'data' }],
      nodes: ['n1', 'n2'],
    });
  });
});
