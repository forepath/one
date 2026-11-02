import { MAX_LIVE_MESSAGES_PER_WINDOW, MAX_MESSAGES_PER_WINDOW, MessageBudget, RATE_WINDOW_MS } from './message-budget';

describe('agent stream message budget', () => {
  it('lets a VM boot burst of live output through without touching the control budget (G5)', () => {
    const budget = new MessageBudget(0);

    // ~900 serial lines in 10 s closed the whole node stream with the shared 200-message budget.
    for (let i = 0; i < 900; i++) expect(budget.allow(true, 1_000)).toBe(true);
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW; i++) expect(budget.allow(false, 2_000)).toBe(true);
    expect(budget.allow(false, 2_000)).toBe(false);
  });

  it('still stops a runaway agent and starts a fresh window', () => {
    const budget = new MessageBudget(0);

    for (let i = 0; i < MAX_LIVE_MESSAGES_PER_WINDOW; i++) budget.allow(true, 5_000);
    expect(budget.allow(true, 5_000)).toBe(false);
    expect(budget.allow(true, RATE_WINDOW_MS + 1)).toBe(true);
    expect(budget.allow(false, RATE_WINDOW_MS + 1)).toBe(true);
  });
});
