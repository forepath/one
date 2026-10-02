import { UnauthorizedException } from '@nestjs/common';

import { ControllerVncTicketService } from './controller-vnc-ticket.service';

describe('ControllerVncTicketService', () => {
  let service: ControllerVncTicketService;
  const redisCache = {
    setJson: jest.fn().mockResolvedValue(false),
    takeJson: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisCache.setJson.mockResolvedValue(false);
    redisCache.takeJson.mockResolvedValue(null);
    service = new ControllerVncTicketService(redisCache as never);
  });

  it('mints and consumes a ticket once from memory fallback', async () => {
    const minted = await service.mint({
      clientId: 'client-1',
      agentId: 'agent-1',
      subject: 'user-1',
      isApiKeyAuth: false,
      managerTicket: 'mgr-ticket',
      managerWsUrl: 'ws://manager:3000/socket/vnc',
      clientAuthHeader: 'Bearer abc',
    });

    expect(redisCache.setJson).toHaveBeenCalled();

    const record = await service.consume(minted.ticket);

    expect(record.clientId).toBe('client-1');
    expect(record.managerTicket).toBe('mgr-ticket');
    await expect(service.consume(minted.ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not keep a memory copy when Redis stores the ticket', async () => {
    redisCache.setJson.mockResolvedValue(true);

    const minted = await service.mint({
      clientId: 'client-1',
      agentId: 'agent-1',
      subject: 'user-1',
      isApiKeyAuth: false,
      managerTicket: 'mgr-ticket',
      managerWsUrl: 'ws://manager:3000/socket/vnc',
      clientAuthHeader: 'Bearer abc',
    });

    await expect(service.consume(minted.ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('consumes ticket from Redis when present', async () => {
    redisCache.takeJson.mockResolvedValueOnce({
      ticket: 't1',
      clientId: 'client-1',
      agentId: 'agent-1',
      subject: 'user-1',
      isApiKeyAuth: false,
      managerTicket: 'mgr-ticket',
      managerWsUrl: 'ws://manager:3000/socket/vnc',
      clientAuthHeader: 'Bearer abc',
      expiresAt: Date.now() + 60_000,
      consumed: false,
    });

    const record = await service.consume('t1');

    expect(record.clientId).toBe('client-1');
  });
});
