import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import {
  AGENT_CONTEXT_REQUEST_EVENT,
  AgentContextRequestHandlerService,
} from './agent-context-request-handler.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- repository / query builder doubles */

function queryBuilder(rows: unknown[]) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getOne: jest.fn().mockResolvedValue(rows[0] ?? null),
  };

  return qb;
}

describe('AgentContextRequestHandlerService', () => {
  const clientId = 'client-1';
  const ticket = {
    id: 't1',
    clientId,
    parentId: 'p1',
    title: 'Fix login',
    content: 'Users see a blank page',
    longSha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
  };
  const page = {
    id: 'n1',
    clientId,
    parentId: null,
    title: 'Auth design',
    content: 'Tokens rotate daily',
    nodeType: KnowledgeNodeType.PAGE,
    longSha: 'ffff6666',
  };
  let ticketRepo: any;
  let knowledgeRepo: any;
  let ticketsService: any;
  let knowledgeTreeService: any;
  let service: AgentContextRequestHandlerService;

  beforeEach(() => {
    ticketRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder([ticket])),
      findOne: jest.fn().mockResolvedValue(ticket),
      find: jest.fn().mockResolvedValue([{ id: 'p1', longSha: '9999parent' }]),
    };
    knowledgeRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder([page])),
      findOne: jest.fn().mockResolvedValue(page),
      find: jest.fn().mockResolvedValue([]),
    };
    ticketsService = {
      getPrototypePromptByClientSha: jest.fn().mockResolvedValue({ prompt: 'TICKET PROMPT' }),
    };
    knowledgeTreeService = {
      collectPromptContextsByHashesInternal: jest
        .fn()
        .mockResolvedValue({ promptSections: ['Knowledge Page: A\nx', 'Knowledge Page: B\ny'] }),
    };
    service = new AgentContextRequestHandlerService(ticketRepo, knowledgeRepo, ticketsService, knowledgeTreeService);
  });

  it('searches both kinds scoped to the workspace with escaped LIKE terms and bounded limits', async () => {
    const result = await service.handle(clientId, { op: 'search', query: '100%_done', limit: 500 });
    const ticketQb = ticketRepo.createQueryBuilder.mock.results[0].value;

    expect(ticketQb.where).toHaveBeenCalledWith('t.client_id = :clientId', { clientId });
    expect(ticketQb.andWhere).toHaveBeenCalledWith('(t.title ILIKE :like OR t.long_sha LIKE :prefix)', {
      like: '%100\\%\\_done%',
      prefix: '100\\%\\_done%',
    });
    expect(ticketQb.take).toHaveBeenCalledWith(50);
    expect(result).toEqual({
      ok: true,
      items: [
        {
          kind: 'ticket',
          sha: ticket.longSha,
          title: 'Fix login',
          status: TicketStatus.TODO,
          priority: TicketPriority.HIGH,
          parentSha: '9999parent',
          size: ticket.content.length,
        },
        {
          kind: 'knowledge',
          sha: 'ffff6666',
          title: 'Auth design',
          nodeType: KnowledgeNodeType.PAGE,
          parentSha: null,
          size: page.content.length,
        },
      ],
    });
  });

  it('restricts search to the requested kinds', async () => {
    await service.handle(clientId, { op: 'search', kinds: ['knowledge'] });

    expect(ticketRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(knowledgeRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('describes refs and ignores malformed ones', async () => {
    const result = await service.handle(clientId, {
      op: 'describe',
      refs: [
        { kind: 'ticket', sha: ticket.longSha },
        { kind: 'ticket', sha: "x' OR 1=1" },
        { kind: 'secret', sha: 'abcd1234' },
      ],
    });

    expect(ticketRepo.findOne).toHaveBeenCalledWith({ where: { clientId, longSha: ticket.longSha } });
    expect(result).toMatchObject({ ok: true, items: [{ kind: 'ticket', title: 'Fix login' }] });
    expect((result as any).items).toHaveLength(1);
  });

  it('returns ticket content in the prototype prompt format', async () => {
    const result = await service.handle(clientId, { op: 'content', refs: [{ kind: 'ticket', sha: 'aaaa1111' }] });

    expect(ticketsService.getPrototypePromptByClientSha).toHaveBeenCalledWith(clientId, ticket.longSha);
    expect(result).toEqual({
      ok: true,
      contents: [{ kind: 'ticket', sha: ticket.longSha, title: 'Fix login', content: 'TICKET PROMPT' }],
    });
  });

  it('resolves short SHAs only when exactly one element matches', async () => {
    const other = { ...ticket, id: 't2', title: 'Secret', longSha: 'aaaa1111ffffffffffffffffffffffffffffffff' };

    ticketRepo.createQueryBuilder.mockImplementation(() => queryBuilder([ticket, other]));

    await expect(
      service.handle(clientId, { op: 'content', refs: [{ kind: 'ticket', sha: 'aaaa1111' }] }),
    ).resolves.toEqual({ ok: true, contents: [] });
    await expect(
      service.handle(clientId, { op: 'describe', refs: [{ kind: 'ticket', sha: 'aaaa1111' }] }),
    ).resolves.toEqual({ ok: true, items: [] });
    expect(ticketsService.getPrototypePromptByClientSha).not.toHaveBeenCalled();
  });

  it('scopes automatic grants to tickets of the same tree as an anchor ticket', async () => {
    const root = { ...ticket, id: 'root', parentId: null, longSha: 'aaaa' + '0'.repeat(36) };
    const anchor = { ...ticket, id: 'anchor', parentId: 'root', longSha: 'bbbb' + '0'.repeat(36) };
    const sibling = { ...ticket, id: 'sibling', parentId: 'root', title: 'Sibling', longSha: 'cccc' + '0'.repeat(36) };
    const foreign = { ...ticket, id: 'foreign', parentId: null, title: 'Other tree', longSha: 'dddd' + '0'.repeat(36) };
    const rows = [root, anchor, sibling, foreign];

    ticketRepo.findOne.mockImplementation(
      async ({ where }: any) =>
        rows.find((row) => (where.longSha ? row.longSha === where.longSha : row.id === where.id)) ?? null,
    );
    ticketRepo.find.mockResolvedValue([{ id: 'root', longSha: root.longSha }]);

    const result = await service.handle(clientId, {
      op: 'scope',
      anchors: [anchor.longSha],
      refs: [
        { kind: 'ticket', sha: sibling.longSha },
        { kind: 'ticket', sha: foreign.longSha },
        { kind: 'knowledge', sha: page.longSha },
      ],
    });

    expect(result).toMatchObject({ ok: true, items: [{ kind: 'ticket', sha: sibling.longSha, title: 'Sibling' }] });
    expect((result as any).items).toHaveLength(1);
    await expect(
      service.handle(clientId, { op: 'scope', anchors: [], refs: [{ kind: 'ticket', sha: sibling.longSha }] }),
    ).resolves.toEqual({ ok: true, items: [] });
  });

  it('returns knowledge pages directly and expands folders', async () => {
    const pageResult = await service.handle(clientId, {
      op: 'content',
      refs: [{ kind: 'knowledge', sha: 'ffff6666' }],
    });

    expect(pageResult).toEqual({
      ok: true,
      contents: [
        {
          kind: 'knowledge',
          sha: 'ffff6666',
          title: 'Auth design',
          content: 'Knowledge Page: Auth design\nTokens rotate daily',
        },
      ],
    });

    knowledgeRepo.createQueryBuilder.mockReturnValue(queryBuilder([{ ...page, nodeType: KnowledgeNodeType.FOLDER }]));
    const folderResult = await service.handle(clientId, {
      op: 'content',
      refs: [{ kind: 'knowledge', sha: 'ffff6666' }],
    });

    // Bound to this workspace's manager connection: system variant (no end-user identity on this path).
    expect(knowledgeTreeService.collectPromptContextsByHashesInternal).toHaveBeenCalledWith(clientId, ['ffff6666']);
    expect((folderResult as any).contents[0].content).toBe('Knowledge Page: A\nx\n\nKnowledge Page: B\ny');
  });

  it('rejects unsupported operations', async () => {
    await expect(service.handle(clientId, { op: 'delete' })).resolves.toEqual({
      ok: false,
      error: 'Unsupported context request',
    });
    await expect(service.handle(clientId, null)).resolves.toMatchObject({ ok: false });
  });

  it('answers socket requests through the ack and hides internal errors', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const remote: any = { on: jest.fn((event: string, handler: any) => handlers.set(event, handler)) };

    service.attach(remote, clientId);
    expect(remote.on).toHaveBeenCalledWith(AGENT_CONTEXT_REQUEST_EVENT, expect.any(Function));

    const ack = jest.fn();

    ticketRepo.createQueryBuilder.mockImplementation(() => {
      throw new Error('db down: secret details');
    });
    handlers.get(AGENT_CONTEXT_REQUEST_EVENT)?.({ op: 'search', kinds: ['ticket'] }, ack);
    await new Promise((resolve) => setImmediate(resolve));

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'Context lookup failed' });

    // Requests without an ack callback are ignored.
    expect(() => handlers.get(AGENT_CONTEXT_REQUEST_EVENT)?.({ op: 'search' })).not.toThrow();
  });
});
