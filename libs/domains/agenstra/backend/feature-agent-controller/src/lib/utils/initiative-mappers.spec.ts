import type { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import type { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import type { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import type { InitiativeEntity } from '../entities/initiative.entity';
import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import {
  effectiveWorkItemStatus,
  initiativeArtifactEntityToDto,
  initiativeEntityToDto,
  initiativeWorkItemToDto,
} from './initiative-mappers';
import { buildInitiativeTicketBody, initiativeTicketTitle } from './initiative-ticket-body';

const now = new Date('2026-11-07T10:00:00.000Z');

const item = (overrides: Partial<InitiativeWorkItemEntity> = {}): InitiativeWorkItemEntity =>
  ({
    id: 'item-1',
    initiativeId: 'ini-1',
    clientId: 'client-1',
    parentId: 'epic-1',
    kind: 'story',
    key: 'E1.S2',
    title: 'Login',
    requirements: 'FR-1 users sign in',
    verify: 'e2e login passes',
    doneWhen: 'merged',
    refined: false,
    planCheckpoint: false,
    doneCheckpoint: false,
    priority: TicketPriority.HIGH,
    sortOrder: 0,
    status: 'draft',
    ticketId: 'ticket-1',
    retrospectiveVerdict: null,
    retrospectiveOverridden: false,
    automationBlocked: false,
    iterationCreated: 1,
    version: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }) as InitiativeWorkItemEntity;

describe('initiative mappers', () => {
  it('maps initiatives with short and long refs', () => {
    const dto = initiativeEntityToDto({
      id: 'ini-1',
      clientId: 'client-1',
      title: 'Checkout',
      intent: '',
      path: 'epic',
      phase: 'plan',
      state: 'active',
      iteration: 2,
      prerequisiteSatisfiedAt: 'done',
      autoRelease: false,
      version: 5,
      longSha: 'a'.repeat(40),
      createdAt: now,
      updatedAt: now,
    } as InitiativeEntity);

    expect(dto.shas).toEqual({ short: 'aaaaaaaa', long: 'a'.repeat(40) });
    expect(dto.defaultAgentId).toBeNull();
  });

  it('derives the document status from accepted and current version and hides content unless asked', () => {
    const artifact = {
      id: 'a1',
      initiativeId: 'ini-1',
      type: 'prd',
      title: 'PRD',
      content: '# PRD',
      currentVersion: 3,
      acceptedVersion: 2,
      version: 4,
      longSha: 'b'.repeat(40),
      createdAt: now,
      updatedAt: now,
    } as InitiativeArtifactEntity;

    expect(initiativeArtifactEntityToDto(artifact).status).toBe('draft');
    expect(initiativeArtifactEntityToDto(artifact).content).toBeUndefined();
    expect(
      initiativeArtifactEntityToDto({ ...artifact, acceptedVersion: 3 } as InitiativeArtifactEntity, true),
    ).toMatchObject({
      status: 'accepted',
      content: '# PRD',
      size: 5,
    });
  });

  it('takes the status from the linked ticket of the same workspace and locks built items', () => {
    expect(effectiveWorkItemStatus(item(), TicketStatus.PROTOTYPE)).toBe('built');
    // Ticket of another workspace (or missing): not linked, own status.
    expect(effectiveWorkItemStatus(item({ status: 'blocked' }), undefined)).toBe('blocked');

    const dto = initiativeWorkItemToDto(item(), {
      ticketStatus: TicketStatus.DONE,
      prerequisiteIds: [],
      readiness: { ready: true, blockedBy: [], satisfied: true },
      unknowns: [],
    });

    expect(dto).toMatchObject({ status: 'done', locked: true, ticketId: 'ticket-1', ticketStatus: TicketStatus.DONE });
    expect(
      initiativeWorkItemToDto(item(), { ticketStatus: null, prerequisiteIds: [], readiness: undefined, unknowns: [] })
        .ticketId,
    ).toBeNull();
  });
});

describe('initiative ticket body', () => {
  it('renders title, refs, checks and questions', () => {
    const unknowns = [
      { question: 'Which IdP?', resolution: 'settle_now', resolvedAt: null },
      { question: 'SSO?', resolution: 'spike', resolvedAt: now, answer: 'Later' },
    ] as InitiativeUnknownEntity[];
    const body = buildInitiativeTicketBody({ title: 'Checkout', longSha: 'c'.repeat(40), iteration: 2 }, item(), {
      epic: item({ kind: 'epic', key: 'E1', title: 'Accounts', parentId: null }),
      after: ['E1.S1'],
      unknowns,
    });

    expect(initiativeTicketTitle(item())).toBe('[E1.S2] Login');
    expect(body).toContain(`initiative:${'c'.repeat(40)}`);
    expect(body).toContain('Epic: **E1** Accounts');
    expect(body).toContain('Builds after: E1.S1');
    expect(body).toContain('## Verify');
    expect(body).toContain('- Which IdP? (settle_now)');
    expect(body).toContain('- SSO?: Later');
  });
});
