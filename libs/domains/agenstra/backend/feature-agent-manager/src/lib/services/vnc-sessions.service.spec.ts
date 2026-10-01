import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { VncSessionsService } from './vnc-sessions.service';

describe('VncSessionsService', () => {
  const agentsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const dockerService = {
    getContainerStatus: jest.fn(),
  };
  const vncTicketService = {
    mint: jest.fn(),
  };

  let service: VncSessionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VncSessionsService(agentsRepository as never, dockerService as never, vncTicketService as never);
  });

  it('mints a ticket for a running agent container', async () => {
    agentsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'agent-1',
      containerId: 'container-1',
    });
    dockerService.getContainerStatus.mockResolvedValue({ running: true });
    vncTicketService.mint.mockReturnValue({ ticket: 't1', expiresIn: 60 });

    await expect(service.createSession('agent-1')).resolves.toEqual({
      ticket: 't1',
      expiresIn: 60,
    });

    expect(vncTicketService.mint).toHaveBeenCalledWith('agent-1', 'container-1');
  });

  it('rejects when container id is missing', async () => {
    agentsRepository.findByIdOrThrow.mockResolvedValue({ id: 'agent-1', containerId: null });

    await expect(service.createSession('agent-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when container is not running', async () => {
    agentsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'agent-1',
      containerId: 'container-1',
    });
    dockerService.getContainerStatus.mockResolvedValue({ running: false });

    await expect(service.createSession('agent-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
