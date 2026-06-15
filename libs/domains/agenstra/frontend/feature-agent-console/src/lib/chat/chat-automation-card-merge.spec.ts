import { TicketAutomationRunChatEventPayload } from '@forepath/agenstra/frontend/data-access-agent-console';
import { TicketAutomationRunResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import { TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import { mergeTicketAutomationChatCardPayload } from './chat-automation-card-merge';

describe('mergeTicketAutomationChatCardPayload', () => {
  const basePayload = (): TicketAutomationRunChatEventPayload => ({
    timelineAt: '2024-01-01T00:00:00Z',
    hydrate: false,
    ticket: {
      id: 't1',
      clientId: 'c1',
      title: 'Old',
      priority: 'low',
      status: 'todo',
      automationEligible: true,
      preferredChatAgentId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    run: {
      id: 'r1',
      ticketId: 't1',
      clientId: 'c1',
      agentId: 'a1',
      status: 'running',
      phase: 'agent_loop',
      startedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      finishedAt: null,
      iterationCount: 0,
    },
    actions: [],
  });

  it('replaces ticket fields when a live ticket exists', () => {
    const live: TicketResponseDto = {
      id: 't1',
      clientId: 'c1',
      title: 'New title',
      priority: 'high',
      status: 'in_progress',
      automationEligible: false,
      preferredChatAgentId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    };
    const merged = mergeTicketAutomationChatCardPayload(basePayload(), live, undefined);

    expect(merged.ticket.title).toBe('New title');
    expect(merged.ticket.status).toBe('in_progress');
    expect(merged.ticket.priority).toBe('high');
  });

  it('uses cached run when newer than snapshot', () => {
    const cached: TicketAutomationRunResponseDto = {
      id: 'r1',
      ticketId: 't1',
      clientId: 'c1',
      agentId: 'a1',
      status: 'succeeded',
      phase: 'finalize',
      ticketStatusBefore: 'todo',
      branchName: null,
      baseBranch: null,
      baseSha: null,
      startedAt: '2024-01-01T00:00:00Z',
      finishedAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T12:00:00Z',
      iterationCount: 2,
      completionMarkerSeen: true,
      verificationPassed: true,
      failureCode: null,
      summary: null,
      cancelRequestedAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    };
    const merged = mergeTicketAutomationChatCardPayload(basePayload(), undefined, cached);

    expect(merged.run.status).toBe('succeeded');
    expect(merged.run.phase).toBe('finalize');
  });
});
