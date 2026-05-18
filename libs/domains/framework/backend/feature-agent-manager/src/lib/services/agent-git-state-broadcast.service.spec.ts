import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';

describe('AgentGitStateBroadcastService', () => {
  let service: AgentGitStateBroadcastService;

  beforeEach(() => {
    service = new AgentGitStateBroadcastService();
  });

  it('invokes registered broadcaster with agent id', () => {
    const broadcaster = jest.fn();

    service.registerBroadcaster(broadcaster);
    service.notifyGitStateMayHaveChanged('agent-1');

    expect(broadcaster).toHaveBeenCalledWith('agent-1');
  });

  it('no-ops when broadcaster is not registered', () => {
    expect(() => service.notifyGitStateMayHaveChanged('agent-1')).not.toThrow();
  });

  it('logs and swallows broadcaster errors', () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    service.registerBroadcaster(() => {
      throw new Error('broadcast failed');
    });
    service.notifyGitStateMayHaveChanged('agent-1');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broadcast failed'));
    warnSpy.mockRestore();
  });
});
