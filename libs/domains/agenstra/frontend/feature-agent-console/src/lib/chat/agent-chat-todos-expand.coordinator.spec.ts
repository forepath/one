import { AgentChatTodosExpandCoordinator } from './agent-chat-todos-expand.coordinator';

describe('AgentChatTodosExpandCoordinator', () => {
  let coordinator: AgentChatTodosExpandCoordinator;

  beforeEach(() => {
    coordinator = new AgentChatTodosExpandCoordinator();
  });

  it('auto-opens only the latest claimed todos row within a message scope', () => {
    coordinator.claim('m1', 'a');
    expect(coordinator.isOpen('m1', 'a')).toBe(true);

    coordinator.claim('m1', 'b');
    expect(coordinator.isOpen('m1', 'a')).toBe(false);
    expect(coordinator.isOpen('m1', 'b')).toBe(true);
    expect(coordinator.latestTrackId('m1')).toBe('b');
  });

  it('keeps the latest todos open independently per message', () => {
    coordinator.claim('m1', 'a');
    coordinator.claim('m1', 'b');
    coordinator.claim('m2', 'x');

    expect(coordinator.isOpen('m1', 'b')).toBe(true);
    expect(coordinator.isOpen('m2', 'x')).toBe(true);
    expect(coordinator.isOpen('m1', 'a')).toBe(false);
  });

  it('ignores re-claims for the same trackId in a scope', () => {
    coordinator.claim('m1', 'a');
    coordinator.claim('m1', 'b');
    coordinator.claim('m1', 'a');

    expect(coordinator.latestTrackId('m1')).toBe('b');
    expect(coordinator.isOpen('m1', 'b')).toBe(true);
  });

  it('toggle closes the active row within that message only', () => {
    coordinator.claim('m1', 'a');
    coordinator.claim('m1', 'b');
    coordinator.claim('m2', 'x');
    coordinator.toggle('m1', 'b');

    expect(coordinator.isOpen('m1', 'b')).toBe(false);
    expect(coordinator.isOpen('m1', 'a')).toBe(false);
    expect(coordinator.isOpen('m2', 'x')).toBe(true);

    coordinator.toggle('m1', 'a');
    expect(coordinator.isOpen('m1', 'a')).toBe(true);
    expect(coordinator.isOpen('m2', 'x')).toBe(true);
  });

  it('a new claim in a message re-opens the latest after a manual close', () => {
    coordinator.claim('m1', 'a');
    coordinator.toggle('m1', 'a');
    expect(coordinator.isOpen('m1', 'a')).toBe(false);

    coordinator.claim('m1', 'b');
    expect(coordinator.isOpen('m1', 'a')).toBe(false);
    expect(coordinator.isOpen('m1', 'b')).toBe(true);
  });

  it('release promotes the previous todos row in that message', () => {
    coordinator.claim('m1', 'a');
    coordinator.claim('m1', 'b');
    coordinator.release('m1', 'b');

    expect(coordinator.latestTrackId('m1')).toBe('a');
    expect(coordinator.isOpen('m1', 'a')).toBe(true);
  });
});
