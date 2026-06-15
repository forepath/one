import { AgentSessionHydrationService } from './agent-session-hydration.service';

describe('AgentSessionHydrationService', () => {
  let service: AgentSessionHydrationService;

  beforeEach(() => {
    service = new AgentSessionHydrationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores and consumes a trimmed summary once', () => {
    service.storePendingSummary('agent-1', '  keep this context  ');

    expect(service.consumePendingSummary('agent-1')).toBe('keep this context');
    expect(service.consumePendingSummary('agent-1')).toBeUndefined();
  });

  it('does not store empty or whitespace-only summaries', () => {
    service.storePendingSummary('agent-1', '   ');

    expect(service.consumePendingSummary('agent-1')).toBeUndefined();
  });

  it('returns undefined for expired pending summaries', () => {
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    service.storePendingSummary('agent-1', 'summary');

    // TTL is 15 minutes; consume after expiry.
    nowSpy.mockReturnValue(1_000 + 15 * 60 * 1_000 + 1);

    expect(service.consumePendingSummary('agent-1')).toBeUndefined();
  });
});
