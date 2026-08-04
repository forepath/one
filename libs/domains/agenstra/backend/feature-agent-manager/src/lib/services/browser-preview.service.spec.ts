import { Test, TestingModule } from '@nestjs/testing';

import { BrowserPreviewService } from './browser-preview.service';
import { DockerService } from './docker.service';

describe('BrowserPreviewService', () => {
  let service: BrowserPreviewService;
  let dockerService: jest.Mocked<
    Pick<
      DockerService,
      'getManagerContainerId' | 'connectContainerToNetwork' | 'disconnectContainerFromNetwork' | 'getContainerIpAddress'
    >
  >;

  beforeEach(async () => {
    dockerService = {
      getManagerContainerId: jest.fn().mockReturnValue('manager-container'),
      connectContainerToNetwork: jest.fn().mockResolvedValue(undefined),
      disconnectContainerFromNetwork: jest.fn().mockResolvedValue(undefined),
      getContainerIpAddress: jest.fn().mockResolvedValue('10.0.0.5'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrowserPreviewService,
        {
          provide: DockerService,
          useValue: dockerService,
        },
      ],
    }).compile();

    service = module.get(BrowserPreviewService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should reject invalid mouse input types', async () => {
    await expect(
      service.dispatchInput('missing', {
        kind: 'mouse',
        event: { type: 'mousePressed', x: 1, y: 2 },
      }),
    ).rejects.toThrow('Browser preview session not found');
  });

  it('should report session ownership', () => {
    expect(service.hasSession('s1', 'sock1')).toBe(false);
  });

  it('should normalize and reject invalid coordinates via private path through missing session', async () => {
    await expect(
      service.dispatchInput('s1', {
        kind: 'mouse',
        event: { type: 'not-a-type' as 'mousePressed', x: Number.NaN, y: 1 },
      }),
    ).rejects.toThrow('Browser preview session not found');
  });

  it('should stop sessions for a socket without error when none exist', async () => {
    await expect(service.stopSessionsForSocket('sock-1')).resolves.toBeUndefined();
  });

  it('should create a fresh page target and connect manager to agent network when starting a session', async () => {
    const openSpy = jest.spyOn(service as never, 'openWebSocket' as never).mockResolvedValue({
      on: jest.fn(),
      off: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
    } as never);
    const fetchSpy = jest.spyOn(service as never, 'fetchJson' as never).mockResolvedValue({
      id: 'target-abc',
      type: 'page',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/abc',
    } as never);
    const sendSpy = jest.spyOn(service as never, 'sendCommand' as never).mockResolvedValue({
      currentIndex: 0,
      entries: [{ id: 1, url: 'about:blank' }],
    } as never);
    const waitSpy = jest.spyOn(service as never, 'waitForCdpReady' as never).mockResolvedValue('10.0.0.5' as never);

    await service.startSession({
      sessionId: 'preview-1',
      agentId: 'agent-1',
      socketId: 'sock-1',
      vncContainerId: 'vnc-1',
      networkId: 'net-1',
      onFrame: jest.fn(),
      onLocation: jest.fn(),
      onClosed: jest.fn(),
    });

    expect(dockerService.connectContainerToNetwork).toHaveBeenCalledWith('manager-container', 'net-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://10.0.0.5:9222/json/new?about%3Ablank',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(openSpy).toHaveBeenCalledWith('ws://10.0.0.5:9222/devtools/page/abc');
    expect(service.hasSession('preview-1', 'sock-1')).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'Emulation.setDeviceMetricsOverride',
      expect.objectContaining({ width: 1910, height: 865 }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'Page.startScreencast',
      expect.objectContaining({ maxWidth: 1280, maxHeight: 720 }),
    );

    await service.stopSession('preview-1');
    expect(dockerService.disconnectContainerFromNetwork).toHaveBeenCalledWith('manager-container', 'net-1');
    expect(service.hasSession('preview-1', 'sock-1')).toBe(false);

    openSpy.mockRestore();
    fetchSpy.mockRestore();
    sendSpy.mockRestore();
    waitSpy.mockRestore();
  });

  it('should reject non-http navigate URLs', async () => {
    (service as unknown as { sessionsById: Map<string, unknown> }).sessionsById.set('preview-1', {
      sessionId: 'preview-1',
      socketId: 'sock-1',
      ws: { readyState: 1 },
      pending: new Map(),
      nextCommandId: 1,
      onLocation: jest.fn(),
    });

    await expect(
      service.dispatchCommand('preview-1', { type: 'navigate', url: 'javascript:alert(1)' }),
    ).rejects.toThrow('Invalid navigation URL');
  });
});
