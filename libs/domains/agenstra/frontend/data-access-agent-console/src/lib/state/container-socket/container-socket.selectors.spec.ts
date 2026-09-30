import { initialContainerSocketState } from './container-socket.reducer';
import {
  selectChatForwarding,
  selectContainerSocketState,
  selectSelectedAgentId,
  selectSocketConnected,
} from './container-socket.selectors';

describe('container-socket selectors', () => {
  const root = { containerSocket: { ...initialContainerSocketState, connected: true, selectedAgentId: 'a1' } };

  it('selectContainerSocketState', () => {
    expect(selectContainerSocketState(root as never).connected).toBe(true);
  });

  it('selectSocketConnected', () => {
    expect(selectSocketConnected.projector(root.containerSocket)).toBe(true);
  });

  it('selectSelectedAgentId', () => {
    expect(selectSelectedAgentId.projector(root.containerSocket)).toBe('a1');
  });

  it('selectChatForwarding', () => {
    expect(
      selectChatForwarding.projector({
        ...initialContainerSocketState,
        forwarding: true,
        forwardingEvent: 'chat',
      }),
    ).toBe(true);
  });
});
