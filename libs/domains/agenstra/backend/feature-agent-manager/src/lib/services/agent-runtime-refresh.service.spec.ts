import { Test } from '@nestjs/testing';

import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { OpenCodeEventBridge } from '../providers/opencode/opencode-event-bridge';

import { AgentGitCredentialsService } from './agent-git-credentials.service';
import { AgentRuntimeRefreshService } from './agent-runtime-refresh.service';
import { WorkspaceInotifySupervisor } from './workspace-inotify-supervisor.service';

describe('AgentRuntimeRefreshService', () => {
  const clientFactory = { invalidate: jest.fn(), waitForHealthy: jest.fn() };
  const eventBridge = { closeForAgent: jest.fn() };
  const inotifySupervisor = { restartWatcherIfActive: jest.fn() };
  const gitCredentials = { restoreFromContainerEnvironment: jest.fn() };
  let service: AgentRuntimeRefreshService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AgentRuntimeRefreshService,
        { provide: OpenCodeClientFactory, useValue: clientFactory },
        { provide: OpenCodeEventBridge, useValue: eventBridge },
        { provide: WorkspaceInotifySupervisor, useValue: inotifySupervisor },
        { provide: AgentGitCredentialsService, useValue: gitCredentials },
      ],
    }).compile();

    service = module.get(AgentRuntimeRefreshService);
  });

  it('invalidates cached OpenCode clients and closes the shared event stream', () => {
    service.invalidateConnections('agent-1');

    expect(clientFactory.invalidate).toHaveBeenCalledWith('agent-1');
    expect(eventBridge.closeForAgent).toHaveBeenCalledWith('agent-1');
  });

  it('returns true once OpenCode is healthy', async () => {
    clientFactory.waitForHealthy.mockResolvedValue(undefined);

    await expect(service.waitForHealthy('agent-1', 'container-1')).resolves.toBe(true);
    expect(clientFactory.waitForHealthy).toHaveBeenCalledWith('agent-1', 'container-1');
  });

  it('returns false instead of throwing when OpenCode does not become healthy', async () => {
    clientFactory.waitForHealthy.mockRejectedValue(new Error('timeout'));

    await expect(service.waitForHealthy('agent-1', 'container-1')).resolves.toBe(false);
  });

  it('re-attaches the workspace watcher', async () => {
    inotifySupervisor.restartWatcherIfActive.mockResolvedValue(undefined);

    await service.reattachWatchers('agent-1');

    expect(inotifySupervisor.restartWatcherIfActive).toHaveBeenCalledWith('agent-1');
  });

  it('swallows watcher re-attach failures', async () => {
    inotifySupervisor.restartWatcherIfActive.mockRejectedValue(new Error('exec failed'));

    await expect(service.reattachWatchers('agent-1')).resolves.toBeUndefined();
  });

  it.each(['ssh', 'netrc', 'skipped'])('restores Git credentials from the container env (%s)', async (result) => {
    gitCredentials.restoreFromContainerEnvironment.mockResolvedValue(result);

    await expect(service.restoreGitCredentials('agent-1', 'container-1')).resolves.toBe(true);
    expect(gitCredentials.restoreFromContainerEnvironment).toHaveBeenCalledWith('container-1');
  });

  it('reports Git credential restore failures without throwing', async () => {
    gitCredentials.restoreFromContainerEnvironment.mockRejectedValue(new Error('Invalid SSH private key'));

    await expect(service.restoreGitCredentials('agent-1', 'container-1')).resolves.toBe(false);
  });

  it('works without optional dependencies', async () => {
    const standalone = new AgentRuntimeRefreshService();

    expect(() => standalone.invalidateConnections('agent-1')).not.toThrow();
    await expect(standalone.waitForHealthy('agent-1', 'container-1')).resolves.toBe(true);
    await expect(standalone.reattachWatchers('agent-1')).resolves.toBeUndefined();
    await expect(standalone.restoreGitCredentials('agent-1', 'container-1')).resolves.toBe(true);
  });
});
