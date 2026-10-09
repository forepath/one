import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';

import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';

import { WorkspaceSearchIndexService } from './workspace-search-index.service';

describe('WorkspaceSearchIndexService', () => {
  let service: WorkspaceSearchIndexService;
  let openSearch: jest.Mocked<
    Pick<
      OpenSearchService,
      | 'isEnabled'
      | 'indexName'
      | 'ensureIndex'
      | 'indexDocument'
      | 'deleteDocument'
      | 'deleteByQuery'
      | 'search'
      | 'count'
    >
  >;
  let fileProxy: jest.Mocked<Pick<ClientAgentFileSystemProxyService, 'probeFile' | 'readFile' | 'listDirectory'>>;

  beforeEach(() => {
    openSearch = {
      isEnabled: jest.fn().mockReturnValue(true),
      indexName: jest.fn().mockReturnValue('agenstra-workspace-files'),
      ensureIndex: jest.fn().mockResolvedValue(undefined),
      indexDocument: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      deleteByQuery: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue({ hits: [], total: 0 }),
      count: jest.fn().mockResolvedValue(0),
    };
    fileProxy = {
      probeFile: jest.fn().mockResolvedValue({ fileType: 'text', contentType: 'text/plain', size: 5 }),
      readFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('hello'),
        fileType: 'text',
        contentType: 'text/plain',
        status: 200,
        size: 5,
      }),
      listDirectory: jest.fn().mockResolvedValue([]),
    };
    service = new WorkspaceSearchIndexService(
      openSearch as unknown as OpenSearchService,
      fileProxy as unknown as ClientAgentFileSystemProxyService,
    );
  });

  it('reports missing status before any rebuild when OpenSearch has no docs', async () => {
    await expect(service.getStatus('c1', 'a1')).resolves.toEqual({
      status: 'missing',
      docCount: 0,
      message: null,
    });
    expect(openSearch.count).toHaveBeenCalledWith('agenstra-workspace-files', { clientId: 'c1', agentId: 'a1' });
    expect(openSearch.search).not.toHaveBeenCalled();
  });

  it('recovers ready status from existing OpenSearch docs after process restart', async () => {
    openSearch.count.mockResolvedValueOnce(42);

    await expect(service.getStatus('c1', 'a1')).resolves.toEqual({
      status: 'ready',
      docCount: 42,
      message: null,
    });

    openSearch.count.mockClear();

    await expect(service.getStatus('c1', 'a1')).resolves.toEqual({
      status: 'ready',
      docCount: 42,
      message: null,
    });
    expect(openSearch.count).not.toHaveBeenCalled();
  });

  it('refuses unscoped status as error', async () => {
    await expect(service.getStatus('', 'a1')).resolves.toMatchObject({ status: 'error' });
  });

  it('upserts with stamped clientId and agentId', async () => {
    await service.applyPathChanges('c1', 'a1', [{ path: 'src/a.ts', op: 'upsert' }]);

    expect(openSearch.indexDocument).toHaveBeenCalledWith(
      'agenstra-workspace-files',
      'c1:a1:src/a.ts',
      expect.objectContaining({ clientId: 'c1', agentId: 'a1', path: 'src/a.ts' }),
    );
  });

  it('search without ready status returns empty hits with status', async () => {
    const result = await service.search('c1', 'a1', 'hello');

    expect(result).toEqual({ status: 'missing', hits: [], total: 0 });
    // recovery count query only — not a content search
    expect(openSearch.count).toHaveBeenCalledTimes(1);
    expect(openSearch.search).not.toHaveBeenCalled();
  });

  it('search recovers status then queries OpenSearch when docs already exist', async () => {
    openSearch.count.mockResolvedValueOnce(1);
    openSearch.search.mockResolvedValueOnce({
      hits: [
        {
          id: 'c1:a1:src/a.ts',
          score: 1,
          source: { path: 'src/a.ts', fileName: 'a.ts', fileType: 'text', size: 5, content: 'hello' },
        },
      ],
      total: 1,
    });

    const result = await service.search('c1', 'a1', 'hello');

    expect(result.status).toBe('ready');
    expect(result.hits).toHaveLength(1);
    expect(openSearch.search).toHaveBeenCalledTimes(1);
    expect(openSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hello',
        filters: { clientId: 'c1', agentId: 'a1' },
      }),
    );
  });

  it('rebuild keeps existing docs when the workspace cannot be listed', async () => {
    fileProxy.listDirectory.mockRejectedValueOnce(new Error('agent unreachable'));

    await service.rebuild('c1', 'a1');

    expect(openSearch.deleteByQuery).not.toHaveBeenCalled();
    await expect(service.getStatus('c1', 'a1')).resolves.toMatchObject({ status: 'error' });
  });

  it('rebuild purges then reindexes walked paths and records doc count', async () => {
    fileProxy.listDirectory.mockResolvedValueOnce([{ path: 'src/a.ts', type: 'file' }] as never);
    openSearch.count.mockResolvedValueOnce(1);

    await service.rebuild('c1', 'a1');

    expect(openSearch.deleteByQuery).toHaveBeenCalledWith('agenstra-workspace-files', {
      clientId: 'c1',
      agentId: 'a1',
    });
    expect(openSearch.deleteByQuery.mock.invocationCallOrder[0]).toBeLessThan(
      openSearch.indexDocument.mock.invocationCallOrder[0],
    );
    await expect(service.getStatus('c1', 'a1')).resolves.toEqual({ status: 'ready', docCount: 1, message: null });
  });

  it('purge deletes by clientId and agentId', async () => {
    await service.purgeAgent('c1', 'a1');

    expect(openSearch.deleteByQuery).toHaveBeenCalledWith('agenstra-workspace-files', {
      clientId: 'c1',
      agentId: 'a1',
    });
  });

  it('search always filters by stamped clientId and agentId when ready', async () => {
    (service as any).statusByKey.set('c1:a1', { status: 'ready', docCount: 1 });
    openSearch.search.mockResolvedValue({
      hits: [
        {
          id: 'c1:a1:src/a.ts',
          score: 1,
          source: { path: 'src/a.ts', fileName: 'a.ts', fileType: 'text', size: 5, content: 'hello' },
        },
      ],
      total: 1,
    });

    await service.search('c1', 'a1', 'hello');

    expect(openSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { clientId: 'c1', agentId: 'a1' },
        fields: ['path.text', 'fileName.text', 'content'],
      }),
    );
  });

  it('files mode searches path fields only and omits content snippets', async () => {
    (service as any).statusByKey.set('c1:a1', { status: 'ready', docCount: 1 });
    openSearch.search.mockResolvedValue({
      hits: [
        {
          id: 'c1:a1:src/a.ts',
          score: 1,
          source: { path: 'src/a.ts', fileName: 'a.ts', fileType: 'text', size: 5, content: 'hello world' },
        },
      ],
      total: 1,
    });

    const result = await service.search('c1', 'a1', 'hello', [], [], 0, 50, 'files');

    expect(openSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ['path.text', 'fileName.text'],
      }),
    );
    expect(result.hits[0]).toEqual(
      expect.objectContaining({ path: 'src/a.ts', matches: [], snippet: null, line: null }),
    );
  });

  it('full mode returns every text line match for a file', async () => {
    (service as any).statusByKey.set('c1:a1', { status: 'ready', docCount: 1 });
    openSearch.search.mockResolvedValue({
      hits: [
        {
          id: 'c1:a1:src/a.ts',
          score: 1,
          source: {
            path: 'src/a.ts',
            fileName: 'a.ts',
            fileType: 'text',
            size: 40,
            content: 'alpha\nhello one\nbeta\nhello two\n',
          },
        },
      ],
      total: 1,
    });

    const result = await service.search('c1', 'a1', 'hello', [], [], 0, 50, 'full');

    expect(result.hits[0].matches).toEqual([
      { line: 2, snippet: 'hello one' },
      { line: 4, snippet: 'hello two' },
    ]);
    expect(result.hits[0].snippet).toBe('hello one');
    expect(result.hits[0].line).toBe(2);
  });

  it('full mode omits matches when only the path matched', async () => {
    (service as any).statusByKey.set('c1:a1', { status: 'ready', docCount: 1 });
    openSearch.search.mockResolvedValue({
      hits: [
        {
          id: 'c1:a1:src/hello.ts',
          score: 1,
          source: {
            path: 'src/hello.ts',
            fileName: 'hello.ts',
            fileType: 'text',
            size: 10,
            content: 'no excerpt here',
          },
        },
      ],
      total: 1,
    });

    const result = await service.search('c1', 'a1', 'hello', [], [], 0, 50, 'full');

    expect(result.hits[0].matches).toEqual([]);
    expect(result.hits[0].snippet).toBeNull();
    expect(result.hits[0].line).toBeNull();
  });

  it('applyPathChanges refuses empty client scope', async () => {
    await service.applyPathChanges('', 'a1', [{ path: 'src/a.ts', op: 'upsert' }]);
    expect(openSearch.indexDocument).not.toHaveBeenCalled();
  });

  it('skips secret paths on upsert', async () => {
    await service.applyPathChanges('c1', 'a1', [{ path: '.env', op: 'upsert' }]);
    expect(fileProxy.probeFile).not.toHaveBeenCalled();
    expect(openSearch.indexDocument).not.toHaveBeenCalled();
  });
});
