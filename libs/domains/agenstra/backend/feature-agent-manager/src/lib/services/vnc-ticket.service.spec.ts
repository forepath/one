import { UnauthorizedException } from '@nestjs/common';

import { VncTicketService } from './vnc-ticket.service';

describe('VncTicketService', () => {
  let service: VncTicketService;

  beforeEach(() => {
    service = new VncTicketService();
  });

  it('mints and consumes a ticket once', () => {
    const minted = service.mint('agent-1', 'container-1', 60_000);

    expect(minted.ticket).toBeTruthy();
    expect(minted.expiresIn).toBe(60);

    const record = service.consume(minted.ticket);

    expect(record.agentId).toBe('agent-1');
    expect(record.containerId).toBe('container-1');

    expect(() => service.consume(minted.ticket)).toThrow(UnauthorizedException);
  });

  it('rejects expired tickets', () => {
    const minted = service.mint('agent-1', 'container-1', 1);

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);

    expect(() => service.consume(minted.ticket)).toThrow(UnauthorizedException);

    jest.restoreAllMocks();
  });

  it('rejects agent mismatch when expectedAgentId is provided', () => {
    const minted = service.mint('agent-1', 'container-1');

    expect(() => service.consume(minted.ticket, 'other-agent')).toThrow(UnauthorizedException);
  });
});
