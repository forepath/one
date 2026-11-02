import { ticketModelPlaceholder } from './ticket-model-placeholder';

describe('ticketModelPlaceholder', () => {
  it('asks for an agent first', () => {
    expect(ticketModelPlaceholder({ hasAgent: false, loading: true, failed: false })).toBe(
      'Select an environment to load models',
    );
  });

  it('shows the loading state while the catalog request runs', () => {
    expect(ticketModelPlaceholder({ hasAgent: true, loading: true, failed: false })).toBe('Loading models…');
  });

  it('ends the loading state with an error after a failure / timeout', () => {
    expect(ticketModelPlaceholder({ hasAgent: true, loading: false, failed: true })).toBe(
      'Models unavailable (environment not reachable)',
    );
  });

  it('says so when the agent has no models', () => {
    expect(ticketModelPlaceholder({ hasAgent: true, loading: false, failed: false })).toBe('No models available');
  });
});
