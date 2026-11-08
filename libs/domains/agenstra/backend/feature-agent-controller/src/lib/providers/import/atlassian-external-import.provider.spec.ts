import { Repository } from 'typeorm';

import { AtlassianAuthService } from '../../context-import/atlassian-auth.service';
import { atlassianFetchJson } from '../../context-import/atlassian-rest.util';
import type { ExternalImportConfigEntity } from '../../entities/external-import-config.entity';
import {
  ExternalImportKind,
  ExternalImportMarkerType,
  ExternalImportProviderId,
} from '../../entities/external-import.enums';
import { TicketStatus } from '../../entities/ticket.enums';
import { ExternalImportSyncMarkerService } from '../../services/external-import-sync-marker.service';
import { KnowledgeTreeService } from '../../services/knowledge-tree.service';
import { TicketsService } from '../../services/tickets.service';

import { AtlassianImportProvider } from './atlassian-external-import.provider';

jest.mock('../../context-import/atlassian-rest.util', () => ({
  ...jest.requireActual('../../context-import/atlassian-rest.util'),
  atlassianFetchJson: jest.fn(),
}));

describe('AtlassianImportProvider', () => {
  const findOne = jest.fn();
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const connectionRepo = {
    findOne,
    update,
  } as unknown as Repository<{ id: string }>;
  const ticketsService = {
    importUpsertTicket: jest.fn(),
  } as unknown as TicketsService;
  const knowledgeTreeService = {
    importUpsertKnowledgePage: jest.fn(),
    importEnsureKnowledgeFolder: jest.fn(),
    importListRelations: jest.fn(),
    importCreateRelation: jest.fn(),
  } as unknown as KnowledgeTreeService;
  const syncMarkerService = {
    findMarker: jest.fn(),
    upsertMarkerFields: jest.fn(),
  } as unknown as ExternalImportSyncMarkerService;
  let prevDisabled: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    prevDisabled = process.env.ATLASSIAN_IMPORT_DISABLED;
    (atlassianFetchJson as jest.Mock).mockReset();
    (syncMarkerService.upsertMarkerFields as jest.Mock).mockResolvedValue({});
    (knowledgeTreeService.importListRelations as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    if (prevDisabled === undefined) {
      delete process.env.ATLASSIAN_IMPORT_DISABLED;
    } else {
      process.env.ATLASSIAN_IMPORT_DISABLED = prevDisabled;
    }
  });

  function provider(): AtlassianImportProvider {
    return new AtlassianImportProvider(
      connectionRepo as never,
      ticketsService,
      knowledgeTreeService,
      syncMarkerService,
      new AtlassianAuthService(connectionRepo as never),
    );
  }

  describe('testConnection', () => {
    it('checks Jira with Basic auth against the site for token connections', async () => {
      findOne.mockResolvedValue({
        id: 'conn-1',
        authType: 'token',
        baseUrl: 'https://example.atlassian.net/wiki',
        accountEmail: 'a@b.com',
        apiToken: 'tok',
      });
      (atlassianFetchJson as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: {}, text: '' });

      await expect(provider().testConnection('conn-1')).resolves.toEqual({ ok: true });

      const [url, init] = (atlassianFetchJson as jest.Mock).mock.calls[0];

      expect(url).toBe('https://example.atlassian.net/rest/api/3/myself');
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('a@b.com:tok').toString('base64')}`);
    });

    it('falls back to Confluence when Jira rejects the credentials', async () => {
      findOne.mockResolvedValue({
        id: 'conn-1',
        authType: 'token',
        baseUrl: 'https://example.atlassian.net',
        accountEmail: 'a@b.com',
        apiToken: 'tok',
      });
      (atlassianFetchJson as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 403, json: null, text: '' })
        .mockResolvedValueOnce({ ok: true, status: 200, json: {}, text: '' });

      const result = await provider().testConnection('conn-1');

      expect(result.ok).toBe(true);
      expect((atlassianFetchJson as jest.Mock).mock.calls[1][0]).toBe(
        'https://example.atlassian.net/wiki/rest/api/space?limit=1',
      );
    });

    it('uses the API gateway with a bearer token for app connections', async () => {
      findOne.mockResolvedValue({
        id: 'conn-1',
        authType: 'app',
        baseUrl: 'https://example.atlassian.net',
        oauthClientId: 'cid',
        oauthClientSecret: 'very-secret',
        cloudId: null,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      (atlassianFetchJson as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 200, json: { cloudId: 'cloud-1' }, text: '' })
        .mockResolvedValueOnce({ ok: true, status: 200, json: { access_token: 'at', expires_in: 3600 }, text: '' })
        .mockResolvedValueOnce({ ok: true, status: 200, json: {}, text: '' });

      await expect(provider().testConnection('conn-1')).resolves.toEqual({ ok: true });

      const [url, init] = (atlassianFetchJson as jest.Mock).mock.calls[2];

      expect(url).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself');
      expect(init.headers.Authorization).toBe('Bearer at');
    });

    it('reports failures without leaking secrets', async () => {
      findOne.mockResolvedValue({
        id: 'conn-1',
        authType: 'app',
        baseUrl: 'https://example.atlassian.net',
        oauthClientId: 'cid',
        oauthClientSecret: 'very-secret',
        cloudId: 'cloud-1',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      (atlassianFetchJson as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: { error: 'access_denied', error_description: 'secret very-secret rejected' },
        text: 'very-secret',
      });

      const result = await provider().testConnection('conn-1');

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Atlassian OAuth token request failed (HTTP 401, access_denied)');
      expect(result.message).not.toContain('very-secret');
    });
  });

  it('runImport paginates Confluence through the API gateway for app connections', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      authType: 'app',
      baseUrl: 'https://example.atlassian.net',
      oauthClientId: 'cid',
      oauthClientSecret: 'secret',
      cloudId: 'cloud-1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    (atlassianFetchJson as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200, json: { access_token: 'at', expires_in: 3600 }, text: '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: {
          results: [{ id: 'p1', title: 'One', ancestors: [], body: { view: { value: '<p>x</p>' } } }],
          _links: { next: '/rest/api/content/search?cql=type%3Dpage&cursor=c1' },
        },
        text: '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: {
          results: [{ id: 'p2', title: 'Two', ancestors: [], body: { view: { value: '<p>y</p>' } } }],
          // Site-absolute link: must be re-based onto the gateway, never followed to the site with the bearer token.
          _links: { next: 'https://example.atlassian.net/wiki/rest/api/content/search?cql=type%3Dpage&cursor=c2' },
        },
        text: '',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: { results: [], _links: {} }, text: '' });
    (syncMarkerService.findMarker as jest.Mock).mockResolvedValue(null);
    (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mockImplementation((params: { title: string }) =>
      Promise.resolve({ id: `local-${params.title}` }),
    );

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: 'type = page',
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 10 });

    const urls = (atlassianFetchJson as jest.Mock).mock.calls.map((c) => String(c[0]));

    expect(urls[0]).toBe('https://auth.atlassian.com/oauth/token');
    expect(urls[1]).toMatch(
      /^https:\/\/api\.atlassian\.com\/ex\/confluence\/cloud-1\/wiki\/rest\/api\/content\/search\?/,
    );
    expect(urls[2]).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/rest/api/content/search?cql=type%3Dpage&cursor=c1',
    );
    expect(urls[3]).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/rest/api/content/search?cql=type%3Dpage&cursor=c2',
    );
    expect((atlassianFetchJson as jest.Mock).mock.calls[3][1].headers.Authorization).toBe('Bearer at');
  });

  it('runImport returns disabled message when ATLASSIAN_IMPORT_DISABLED', async () => {
    process.env.ATLASSIAN_IMPORT_DISABLED = 'true';

    const config = {
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.JIRA,
      atlassianConnectionId: 'conn-1',
    } as ExternalImportConfigEntity;
    const result = await provider().runImport({ config, itemBudget: 5 });

    expect(result.errorMessage).toBe('Atlassian import disabled');
    expect(connectionRepo.findOne).not.toHaveBeenCalled();
  });

  it('runImport returns wrong provider when provider mismatches', async () => {
    const config = {
      provider: 'not-atlassian' as unknown as ExternalImportProviderId,
      importKind: ExternalImportKind.JIRA,
      atlassianConnectionId: 'conn-1',
    } as ExternalImportConfigEntity;
    const result = await provider().runImport({ config, itemBudget: 5 });

    expect(result.errorMessage).toBe('Wrong provider');
  });

  it('runImport maps Jira ADF descriptions to Markdown for tickets', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });
    (atlassianFetchJson as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        issues: [
          {
            id: '1',
            key: 'FOO-1',
            fields: {
              summary: 'Hello',
              description: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Line ', marks: [{ type: 'strong' }] }],
                  },
                ],
              },
            },
          },
        ],
        total: 1,
        startAt: 0,
        maxResults: 50,
      },
      text: '',
    });
    (syncMarkerService.findMarker as jest.Mock).mockResolvedValue(null);
    (ticketsService.importUpsertTicket as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.JIRA,
      atlassianConnectionId: 'conn-1',
      jql: 'project = FOO',
      importTargetTicketStatus: TicketStatus.DRAFT,
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(ticketsService.importUpsertTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hello',
        content: expect.stringMatching(/\*\*Line/),
        status: TicketStatus.DRAFT,
      }),
    );
  });

  it('runImport uses configured Jira swimlane status', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });
    (atlassianFetchJson as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        issues: [
          {
            id: '1',
            key: 'FOO-1',
            fields: { summary: 'Hi', description: null },
          },
        ],
        total: 1,
        startAt: 0,
        maxResults: 100,
      },
      text: '',
    });
    (syncMarkerService.findMarker as jest.Mock).mockResolvedValue(null);
    (ticketsService.importUpsertTicket as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.JIRA,
      atlassianConnectionId: 'conn-1',
      jql: 'project = FOO',
      importTargetTicketStatus: TicketStatus.TODO,
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(ticketsService.importUpsertTicket).toHaveBeenCalledWith(
      expect.objectContaining({ status: TicketStatus.TODO }),
    );
  });

  it('runImport does not call Jira when JQL is empty', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.JIRA,
      atlassianConnectionId: 'conn-1',
      jql: '   ',
    } as ExternalImportConfigEntity;
    const result = await provider().runImport({ config, itemBudget: 5 });

    expect(atlassianFetchJson).not.toHaveBeenCalled();
    expect(result.errorMessage).toMatch(/JQL is required/);
  });

  it('runImport does not call Confluence when CQL is empty', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: '',
    } as ExternalImportConfigEntity;
    const result = await provider().runImport({ config, itemBudget: 5 });

    expect(atlassianFetchJson).not.toHaveBeenCalled();
    expect(result.errorMessage).toMatch(/CQL is required/);
  });

  it('runImport resolves Confluence Cloud pagination next URL under /wiki', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });

    (atlassianFetchJson as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: {
          results: [
            {
              id: 'p1',
              title: 'Only',
              ancestors: [],
              body: { view: { value: '<p>x</p>' } },
            },
          ],
          _links: { next: '/rest/api/content/search?cql=type%3Dpage&limit=100&cursor=c1' },
        },
        text: '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { results: [], _links: {} },
        text: '',
      });

    (syncMarkerService.findMarker as jest.Mock).mockResolvedValue(null);
    (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mockImplementation((params: { title: string }) =>
      Promise.resolve({ id: `local-${params.title}` }),
    );

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: 'type = page',
      agenstraParentFolderId: 'import-root',
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(atlassianFetchJson).toHaveBeenCalledTimes(2);
    expect(String((atlassianFetchJson as jest.Mock).mock.calls[0][0])).toContain('/wiki/rest/api/content/search');
    expect(String((atlassianFetchJson as jest.Mock).mock.calls[1][0])).toBe(
      'https://example.atlassian.net/wiki/rest/api/content/search?cql=type%3Dpage&limit=100&cursor=c1',
    );
  });

  it('runImport places Confluence pages flat and links structural parent to child via relations', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });
    (atlassianFetchJson as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        results: [
          {
            id: 'parent',
            title: 'Parent',
            ancestors: [{ id: 'space', type: 'page', title: 'Space' }],
            body: { view: { value: '<p>P</p>' } },
          },
          {
            id: 'child',
            title: 'Child',
            ancestors: [
              { id: 'parent', type: 'page', title: 'Parent' },
              { id: 'space', type: 'page', title: 'Space' },
            ],
            body: { view: { value: '<p>Child <em>body</em></p>' } },
          },
        ],
        _links: {},
      },
      text: '',
    });

    const markerStore = new Map<string, string>();

    (syncMarkerService.upsertMarkerFields as jest.Mock).mockImplementation(
      (
        _c: string,
        type: ExternalImportMarkerType,
        externalId: string,
        fields: { localKnowledgeNodeId?: string | null },
      ) => {
        if (fields.localKnowledgeNodeId) {
          markerStore.set(`${type}:${externalId}`, fields.localKnowledgeNodeId);
        }

        return Promise.resolve({});
      },
    );

    (syncMarkerService.findMarker as jest.Mock).mockImplementation(
      (_c: string, type: ExternalImportMarkerType, externalId: string) => {
        const hit = markerStore.get(`${type}:${externalId}`);

        if (hit) {
          return { localKnowledgeNodeId: hit, contentHash: null };
        }

        return null;
      },
    );

    (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mockImplementation((params: { title: string }) =>
      Promise.resolve({ id: `local-${params.title}` }),
    );

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: 'type = page',
      agenstraParentFolderId: 'import-root',
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(knowledgeTreeService.importEnsureKnowledgeFolder).not.toHaveBeenCalled();
    expect(knowledgeTreeService.importUpsertKnowledgePage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Parent', parentFolderId: 'import-root' }),
    );
    expect(knowledgeTreeService.importUpsertKnowledgePage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Child', parentFolderId: 'import-root' }),
    );
    expect(knowledgeTreeService.importCreateRelation).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        sourceId: 'local-Parent',
        targetNodeId: 'local-Child',
      }),
    );
    const childUpsert = (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mock.calls.find(
      (c) => c[0].title === 'Child',
    );

    expect(childUpsert?.[0].content).toMatch(/\*body\*|_body_/);
  });

  it('runImport creates knowledge page relations from internal Confluence links', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });
    (atlassianFetchJson as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        results: [
          {
            id: '111',
            title: 'A',
            ancestors: [],
            body: { view: { value: '<p>See <ri:page ri:content-id="222" /></p>' } },
          },
          {
            id: '222',
            title: 'B',
            ancestors: [],
            body: { view: { value: '<p>Body</p>' } },
          },
        ],
        _links: {},
      },
      text: '',
    });

    const markerStore = new Map<string, string>();

    (syncMarkerService.upsertMarkerFields as jest.Mock).mockImplementation(
      (
        _c: string,
        type: ExternalImportMarkerType,
        externalId: string,
        fields: { localKnowledgeNodeId?: string | null },
      ) => {
        if (fields.localKnowledgeNodeId) {
          markerStore.set(`${type}:${externalId}`, fields.localKnowledgeNodeId);
        }

        return Promise.resolve({});
      },
    );

    (syncMarkerService.findMarker as jest.Mock).mockImplementation(
      (_c: string, type: ExternalImportMarkerType, externalId: string) => {
        const hit = markerStore.get(`${type}:${externalId}`);

        if (hit) {
          return { localKnowledgeNodeId: hit, contentHash: null };
        }

        return null;
      },
    );

    (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mockImplementation((params: { title: string }) =>
      Promise.resolve({ id: `local-${params.title}` }),
    );

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: 'type = page',
      agenstraParentFolderId: 'konw-root',
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(knowledgeTreeService.importEnsureKnowledgeFolder).not.toHaveBeenCalled();
    expect(knowledgeTreeService.importCreateRelation).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        sourceId: 'local-A',
        targetNodeId: 'local-B',
      }),
    );
  });

  it('runImport places a lone Confluence page without synthetic ancestor folders', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      baseUrl: 'https://example.atlassian.net',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    });
    (atlassianFetchJson as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        results: [
          {
            id: 'leaf',
            title: 'Only',
            ancestors: [{ id: 'space', type: 'page', title: 'Space' }],
            body: { view: { value: '<p>Hi</p>' } },
          },
        ],
        _links: {},
      },
      text: '',
    });

    (knowledgeTreeService.importEnsureKnowledgeFolder as jest.Mock).mockResolvedValue({ id: 'folder-x' });
    (knowledgeTreeService.importUpsertKnowledgePage as jest.Mock).mockResolvedValue({ id: 'page-only' });
    (syncMarkerService.findMarker as jest.Mock).mockResolvedValue(null);

    const config = {
      id: 'cfg-1',
      clientId: 'client-1',
      provider: ExternalImportProviderId.ATLASSIAN,
      importKind: ExternalImportKind.CONFLUENCE,
      atlassianConnectionId: 'conn-1',
      cql: 'type = page',
    } as ExternalImportConfigEntity;

    await provider().runImport({ config, itemBudget: 5 });

    expect(knowledgeTreeService.importEnsureKnowledgeFolder).not.toHaveBeenCalled();
    expect(knowledgeTreeService.importUpsertKnowledgePage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Only',
        parentFolderId: null,
      }),
    );
  });
});
