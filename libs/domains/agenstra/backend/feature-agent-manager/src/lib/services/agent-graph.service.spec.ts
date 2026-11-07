import {
  AGENT_GRAPH_MANUAL_REFRESH_COOLDOWN_MS,
  AGENT_GRAPH_STARTUP_DELAY_MS_ENV,
  AGENT_GRAPH_STARTUP_REBUILD_ENV,
  AgentGraphService,
} from './agent-graph.service';

describe('AgentGraphService startup rebuild', () => {
  const env = { ...process.env };
  let agentsRepository: { findAllWithContainers: jest.Mock; findById: jest.Mock };
  let service: AgentGraphService;
  let build: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    agentsRepository = {
      findAllWithContainers: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]),
      findById: jest.fn(),
    };
    service = new AgentGraphService(
      agentsRepository as never,
      { findStatus: jest.fn(), upsert: jest.fn() } as never,
      {} as never,
      { registerTurnFinishedListener: jest.fn() } as never,
      { registerTreeInvalidator: jest.fn(() => () => undefined) } as never,
    );
    build = jest.spyOn(service, 'build');
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    process.env = { ...env };
  });

  it('rebuilds every environment with a worker and retries failures once', async () => {
    build
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('worker not ready'))
      .mockResolvedValue(undefined);

    await expect(service.rebuildAll(true)).resolves.toEqual({ built: 1, failed: ['a2'] });
    expect(build.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2']);

    await jest.advanceTimersByTimeAsync(2 * 60_000);

    expect(build.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2', 'a2']);
  });

  it('schedules the rebuild after the configured delay on bootstrap', async () => {
    process.env[AGENT_GRAPH_STARTUP_DELAY_MS_ENV] = '5000';
    build.mockResolvedValue(undefined);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(4_999);
    expect(agentsRepository.findAllWithContainers).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('can be disabled', async () => {
    process.env[AGENT_GRAPH_STARTUP_REBUILD_ENV] = 'false';

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10 * 60_000);

    expect(agentsRepository.findAllWithContainers).not.toHaveBeenCalled();
  });
});

describe('AgentGraphService manual refresh', () => {
  const findStatus = jest.fn();
  let service: AgentGraphService;
  let build: jest.SpyInstance;

  beforeEach(() => {
    findStatus.mockReset();
    service = new AgentGraphService(
      { findById: jest.fn().mockResolvedValue({ id: 'a1' }) } as never,
      { findStatus, upsert: jest.fn() } as never,
      {} as never,
      { registerTurnFinishedListener: jest.fn() } as never,
      { registerTreeInvalidator: jest.fn(() => () => undefined) } as never,
    );
    build = jest.spyOn(service, 'build').mockResolvedValue(undefined);
  });

  afterEach(() => service.onModuleDestroy());

  it('rebuilds a graph older than the cooldown', async () => {
    findStatus.mockResolvedValue({
      status: 'ready',
      builtAt: new Date(Date.now() - AGENT_GRAPH_MANUAL_REFRESH_COOLDOWN_MS - 1000),
    });

    await expect(service.refresh('a1')).resolves.toEqual({ environmentId: 'a1', queued: true, status: 'building' });
    expect(build).toHaveBeenCalledWith('a1');
  });

  it('does not rebuild a graph that was just built', async () => {
    findStatus.mockResolvedValue({ status: 'ready', builtAt: new Date(Date.now() - 1000) });

    await expect(service.refresh('a1')).resolves.toEqual({ environmentId: 'a1', queued: false, status: 'ready' });
    expect(build).not.toHaveBeenCalled();
  });
});
