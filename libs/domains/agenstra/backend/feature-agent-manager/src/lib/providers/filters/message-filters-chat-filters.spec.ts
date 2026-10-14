import { FilterDirection } from '../chat-filter.interface';

import { MessageFiltersIncomingChatFilter } from './message-filters-incoming-chat-filter';
import { MessageFiltersOutgoingChatFilter } from './message-filters-outgoing-chat-filter';

describe('Message filter chat filters', () => {
  const evaluate = jest.fn().mockResolvedValue({ filtered: true, action: 'drop', reason: 'Rule (global)' });
  const service = { evaluate } as never;

  beforeEach(() => evaluate.mockClear());

  it('evaluates incoming messages for the context agent', async () => {
    const filter = new MessageFiltersIncomingChatFilter(service);

    expect(filter.getType()).toBe('message-filters-incoming');
    expect(filter.getDisplayName()).toBe('Message filters (incoming)');
    expect(filter.getDirection()).toBe(FilterDirection.INCOMING);
    await expect(filter.filter('hi', { agentId: 'agent-1', actor: 'user' })).resolves.toEqual({
      filtered: true,
      action: 'drop',
      reason: 'Rule (global)',
    });
    expect(evaluate).toHaveBeenCalledWith('agent-1', 'hi', 'incoming');
  });

  it('evaluates outgoing messages for the context agent', async () => {
    const filter = new MessageFiltersOutgoingChatFilter(service);

    expect(filter.getType()).toBe('message-filters-outgoing');
    expect(filter.getDirection()).toBe(FilterDirection.OUTGOING);
    await filter.filter('reply');
    expect(evaluate).toHaveBeenCalledWith(undefined, 'reply', 'outgoing');
  });
});
