import { TicketAutomationEntity, TicketVerifierProfileJson } from './ticket-automation.entity';

describe('TicketAutomationEntity', () => {
  it('should create an instance', () => {
    const entity = new TicketAutomationEntity();

    expect(entity).toBeDefined();
  });

  it('should map ticket automation columns', () => {
    const verifierProfile: TicketVerifierProfileJson = {
      commands: [{ cmd: 'npm test', cwd: '/app' }],
    };
    const entity = new TicketAutomationEntity();

    entity.ticketId = 'ticket-uuid';
    entity.eligible = true;
    entity.allowedAgentIds = ['agent-uuid'];
    entity.includeWorkspaceContext = true;
    entity.contextEnvironmentIds = ['context-agent-uuid'];
    entity.autoEnrichmentEnabled = true;
    entity.verifierProfile = verifierProfile;
    entity.requiresApproval = true;
    entity.approvedAt = new Date();
    entity.approvedByUserId = 'user-uuid';
    entity.approvalBaselineTicketUpdatedAt = new Date();
    entity.defaultBranchOverride = 'develop';
    entity.nextRetryAt = null;
    entity.consecutiveFailureCount = 0;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.ticketId).toBe('ticket-uuid');
    expect(entity.eligible).toBe(true);
    expect(entity.allowedAgentIds).toEqual(['agent-uuid']);
    expect(entity.includeWorkspaceContext).toBe(true);
    expect(entity.contextEnvironmentIds).toEqual(['context-agent-uuid']);
    expect(entity.autoEnrichmentEnabled).toBe(true);
    expect(entity.verifierProfile).toEqual(verifierProfile);
    expect(entity.requiresApproval).toBe(true);
    expect(entity.approvedByUserId).toBe('user-uuid');
    expect(entity.defaultBranchOverride).toBe('develop');
    expect(entity.nextRetryAt).toBeNull();
  });
});
