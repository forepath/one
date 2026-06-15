import {
  patchTicketAutomationSuccess,
  ticketBoardAutomationUpsert,
} from '../ticket-automation/ticket-automation.actions';

import {
  addTicketComment,
  addTicketCommentFailure,
  addTicketCommentSuccess,
  closeTicketDetail,
  createTicket,
  createTicketFailure,
  createTicketSuccess,
  loadTicketDetailBundleSuccess,
  loadTicketDetailFailure,
  loadTickets,
  loadTicketsFailure,
  loadTicketsSuccess,
  migrateTicket,
  migrateTicketFailure,
  migrateTicketSuccess,
  openTicketDetail,
  prependTicketDetailActivity,
  replaceTicketDetailActivity,
  ticketBoardActivityCreated,
  ticketBoardCommentCreated,
  ticketBoardTicketRemoved,
  ticketBoardTicketUpsert,
  updateTicket,
  updateTicketFailure,
  updateTicketSuccess,
} from './tickets.actions';
import { initialTicketsState, ticketsReducer, type TicketsState } from './tickets.reducer';
import {
  EMPTY_TICKET_TASKS,
  type TicketActivityResponseDto,
  type TicketCommentResponseDto,
  type TicketResponseDto,
} from './tickets.types';

describe('ticketsReducer', () => {
  const mockTicket: TicketResponseDto = {
    id: 'ticket-1',
    clientId: 'client-1',
    title: 'Example',
    content: null,
    priority: 'medium',
    status: 'draft',
    preferredChatAgentId: null,
    automationEligible: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tasks: EMPTY_TICKET_TASKS,
  };
  const mockComment: TicketCommentResponseDto = {
    id: 'comment-1',
    ticketId: 'ticket-1',
    body: 'Hi',
    createdAt: '2024-01-02T00:00:00Z',
  };
  const mockActivity: TicketActivityResponseDto = {
    id: 'act-1',
    ticketId: 'ticket-1',
    occurredAt: '2024-01-02T00:00:00Z',
    actorType: 'human',
    actionType: 'updated',
    payload: {},
  };

  it('should return initial state for unknown action', () => {
    const state = ticketsReducer(undefined, { type: 'UNKNOWN' } as never);

    expect(state).toEqual(initialTicketsState);
  });

  describe('loadTickets', () => {
    it('should set loadingList and clear error', () => {
      const prev: TicketsState = { ...initialTicketsState, error: 'oops' };
      const next = ticketsReducer(prev, loadTickets({ params: { clientId: 'client-1', parentId: null } }));

      expect(next.loadingList).toBe(true);
      expect(next.error).toBeNull();
    });
  });

  describe('loadTicketsSuccess', () => {
    it('should store tickets and clear loading', () => {
      const prev: TicketsState = { ...initialTicketsState, loadingList: true };
      const next = ticketsReducer(prev, loadTicketsSuccess({ tickets: [mockTicket] }));

      expect(next.loadingList).toBe(false);
      expect(next.list).toEqual([{ ...mockTicket, subtaskCounts: { open: 0, done: 0 } }]);
    });
  });

  describe('loadTicketsFailure', () => {
    it('should set error and stop loading', () => {
      const prev: TicketsState = { ...initialTicketsState, loadingList: true };
      const next = ticketsReducer(prev, loadTicketsFailure({ error: 'failed' }));

      expect(next.loadingList).toBe(false);
      expect(next.error).toBe('failed');
    });
  });

  describe('openTicketDetail', () => {
    it('should select id, clear bundle, and start loading detail', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        detail: mockTicket,
        comments: [mockComment],
        error: 'x',
      };
      const next = ticketsReducer(prev, openTicketDetail({ id: 'ticket-2' }));

      expect(next.selectedTicketId).toBe('ticket-2');
      expect(next.loadingDetail).toBe(true);
      expect(next.detail).toBeNull();
      expect(next.comments).toEqual([]);
      expect(next.activity).toEqual([]);
      expect(next.error).toBeNull();
    });
  });

  describe('loadTicketDetailBundleSuccess', () => {
    it('should populate detail, comments, and activity', () => {
      const prev: TicketsState = { ...initialTicketsState, loadingDetail: true };
      const next = ticketsReducer(
        prev,
        loadTicketDetailBundleSuccess({
          ticket: mockTicket,
          comments: [mockComment],
          activity: [],
        }),
      );

      expect(next.loadingDetail).toBe(false);
      expect(next.detail).toEqual({ ...mockTicket, subtaskCounts: { open: 0, done: 0 } });
      expect(next.comments).toEqual([mockComment]);
    });
  });

  describe('loadTicketDetailFailure', () => {
    it('should clear selection and stop loading', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: 'ticket-1',
        loadingDetail: true,
      };
      const next = ticketsReducer(prev, loadTicketDetailFailure({ error: 'nf' }));

      expect(next.loadingDetail).toBe(false);
      expect(next.error).toBe('nf');
      expect(next.selectedTicketId).toBeNull();
    });
  });

  describe('createTicketSuccess', () => {
    it('should append new ticket to list', () => {
      const prev: TicketsState = { ...initialTicketsState, saving: true, list: [mockTicket] };
      const created: TicketResponseDto = { ...mockTicket, id: 'ticket-2', title: 'New' };
      const next = ticketsReducer(prev, createTicketSuccess({ ticket: created }));

      expect(next.saving).toBe(false);
      expect(next.list.map((t) => t.id)).toEqual(['ticket-1', 'ticket-2']);
    });

    it('should append new subtask to open parent detail.children', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [mockTicket],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
      };
      const subtask: TicketResponseDto = {
        ...mockTicket,
        id: 'sub-1',
        title: 'Subtask',
        parentId: mockTicket.id,
      };
      const next = ticketsReducer(prev, createTicketSuccess({ ticket: subtask }));

      expect(next.detail?.children?.map((c) => c.id)).toEqual(['sub-1']);
    });

    it('should not change detail when created ticket is not a child of open detail', () => {
      const otherParent: TicketResponseDto = { ...mockTicket, id: 'other' };
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [mockTicket, otherParent],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
      };
      const subtask: TicketResponseDto = {
        ...mockTicket,
        id: 'sub-1',
        title: 'Subtask',
        parentId: otherParent.id,
      };
      const next = ticketsReducer(prev, createTicketSuccess({ ticket: subtask }));

      expect(next.detail?.children).toBeUndefined();
    });

    it('should merge parent and createdChildTickets into list and detail.children', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [],
        detail: null,
        selectedTicketId: null,
      };
      const parent: TicketResponseDto = { ...mockTicket, id: 'root-1', title: 'Epic' };
      const c1: TicketResponseDto = { ...mockTicket, id: 'c1', title: 'Proposal', parentId: 'root-1' };
      const c2: TicketResponseDto = { ...mockTicket, id: 'c2', title: 'Specifications', parentId: 'root-1' };
      const next = ticketsReducer(prev, createTicketSuccess({ ticket: parent, createdChildTickets: [c1, c2] }));

      expect(next.list.map((t) => t.id).sort()).toEqual(['c1', 'c2', 'root-1']);
      const openParent: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [],
        detail: parent,
        selectedTicketId: parent.id,
      };
      const next2 = ticketsReducer(openParent, createTicketSuccess({ ticket: parent, createdChildTickets: [c1, c2] }));

      expect(next2.detail?.children?.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    });
  });

  describe('createTicketFailure', () => {
    it('should set saving false and error', () => {
      const prev: TicketsState = { ...initialTicketsState, saving: true };
      const next = ticketsReducer(prev, createTicketFailure({ error: 'bad' }));

      expect(next.saving).toBe(false);
      expect(next.error).toBe('bad');
    });
  });

  describe('updateTicketSuccess', () => {
    it('should merge ticket in list and detail when ids match', () => {
      const updated: TicketResponseDto = { ...mockTicket, status: 'done' };
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [mockTicket],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
        activity: [],
      };
      const next = ticketsReducer(prev, updateTicketSuccess({ ticket: updated, activity: [mockActivity] }));

      expect(next.saving).toBe(false);
      expect(next.list[0].status).toBe('done');
      expect(next.detail?.status).toBe('done');
      expect(next.activity).toEqual([mockActivity]);
    });

    it('should not replace activity when detail is not open for that ticket', () => {
      const updated: TicketResponseDto = { ...mockTicket, status: 'done' };
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [mockTicket],
        detail: null,
        selectedTicketId: null,
        activity: [],
      };
      const next = ticketsReducer(prev, updateTicketSuccess({ ticket: updated, activity: [mockActivity] }));

      expect(next.activity).toEqual([]);
    });

    it('should preserve detail.children when PATCH payload omits children', () => {
      const child: TicketResponseDto = {
        ...mockTicket,
        id: 'child-1',
        title: 'Sub',
        parentId: mockTicket.id,
      };
      const detailWithTree: TicketResponseDto = { ...mockTicket, children: [child] };
      const patchResponse: TicketResponseDto = { ...mockTicket, status: 'done' };
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        list: [mockTicket],
        detail: detailWithTree,
        selectedTicketId: mockTicket.id,
        activity: [],
      };
      const next = ticketsReducer(prev, updateTicketSuccess({ ticket: patchResponse, activity: [] }));

      expect(next.detail?.children).toEqual([{ ...child, subtaskCounts: { open: 0, done: 0 } }]);
      expect(next.detail?.status).toBe('done');
    });
  });

  describe('updateTicketFailure', () => {
    it('should clear saving and set error', () => {
      const prev: TicketsState = { ...initialTicketsState, saving: true };
      const next = ticketsReducer(prev, updateTicketFailure({ error: 'nope' }));

      expect(next.saving).toBe(false);
      expect(next.error).toBe('nope');
    });
  });

  describe('addTicketCommentSuccess', () => {
    it('should append comment and refresh activity when detail is open', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        comments: [],
        selectedTicketId: mockTicket.id,
        activity: [],
      };
      const next = ticketsReducer(prev, addTicketCommentSuccess({ comment: mockComment, activity: [mockActivity] }));

      expect(next.saving).toBe(false);
      expect(next.comments).toEqual([mockComment]);
      expect(next.activity).toEqual([mockActivity]);
    });

    it('should not duplicate when the same comment was already applied via ticketBoardCommentCreated', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        saving: true,
        comments: [mockComment],
        selectedTicketId: mockTicket.id,
        activity: [],
      };
      const next = ticketsReducer(prev, addTicketCommentSuccess({ comment: mockComment, activity: [mockActivity] }));

      expect(next.saving).toBe(false);
      expect(next.comments).toEqual([mockComment]);
      expect(next.activity).toEqual([mockActivity]);
    });
  });

  describe('addTicketCommentFailure', () => {
    it('should set error', () => {
      const prev: TicketsState = { ...initialTicketsState, saving: true };
      const next = ticketsReducer(prev, addTicketCommentFailure({ error: 'fail' }));

      expect(next.saving).toBe(false);
      expect(next.error).toBe('fail');
    });
  });

  describe('prependTicketDetailActivity', () => {
    const bodyGenActivity: TicketActivityResponseDto = {
      id: 'act-body-gen',
      ticketId: mockTicket.id,
      occurredAt: '2024-01-03T12:00:00Z',
      actorType: 'human',
      actionType: 'BODY_GENERATION_STARTED',
      payload: { generationId: 'gen-1' },
    };

    it('should prepend activity when detail is open for that ticket', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        activity: [mockActivity],
      };
      const next = ticketsReducer(prev, prependTicketDetailActivity({ activity: bodyGenActivity }));

      expect(next.activity).toEqual([bodyGenActivity, mockActivity]);
    });

    it('should not change activity when selected ticket differs', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: 'other-ticket',
        activity: [mockActivity],
      };
      const next = ticketsReducer(prev, prependTicketDetailActivity({ activity: bodyGenActivity }));

      expect(next.activity).toEqual([mockActivity]);
    });

    it('should not duplicate when activity id already exists', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        activity: [mockActivity],
      };
      const next = ticketsReducer(
        prev,
        prependTicketDetailActivity({ activity: { ...mockActivity, id: mockActivity.id } }),
      );

      expect(next.activity).toEqual([mockActivity]);
    });
  });

  describe('replaceTicketDetailActivity', () => {
    it('should replace activity when detail is open for that ticket', () => {
      const fresh: TicketActivityResponseDto[] = [
        {
          id: 'act-new',
          ticketId: mockTicket.id,
          occurredAt: '2024-01-04T12:00:00Z',
          actorType: 'human',
          actionType: 'AUTOMATION_APPROVED',
          payload: {},
        },
      ];
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        activity: [mockActivity],
      };
      const next = ticketsReducer(prev, replaceTicketDetailActivity({ ticketId: mockTicket.id, activity: fresh }));

      expect(next.activity).toEqual(fresh);
    });

    it('should not change activity when selected ticket differs', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: 'other-ticket',
        activity: [mockActivity],
      };
      const next = ticketsReducer(prev, replaceTicketDetailActivity({ ticketId: mockTicket.id, activity: [] }));

      expect(next.activity).toEqual([mockActivity]);
    });
  });

  describe('closeTicketDetail', () => {
    it('should clear detail state', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        detail: mockTicket,
        comments: [mockComment],
        activity: [],
      };
      const next = ticketsReducer(prev, closeTicketDetail());

      expect(next.selectedTicketId).toBeNull();
      expect(next.detail).toBeNull();
      expect(next.comments).toEqual([]);
      expect(next.activity).toEqual([]);
    });
  });

  describe('createTicket', () => {
    it('should set saving', () => {
      const next = ticketsReducer(initialTicketsState, createTicket({ dto: { title: 'x', clientId: 'c' } }));

      expect(next.saving).toBe(true);
      expect(next.error).toBeNull();
    });
  });

  describe('updateTicket', () => {
    it('should set saving', () => {
      const next = ticketsReducer(initialTicketsState, updateTicket({ id: '1', dto: { status: 'done' } }));

      expect(next.saving).toBe(true);
    });
  });

  describe('addTicketComment', () => {
    it('should set saving', () => {
      const next = ticketsReducer(initialTicketsState, addTicketComment({ ticketId: '1', body: 'a' }));

      expect(next.saving).toBe(true);
    });
  });

  describe('patchTicketAutomationSuccess → tickets slice', () => {
    const automationConfig = {
      ticketId: 'ticket-1',
      eligible: true,
      allowedAgentIds: [] as string[],
      includeWorkspaceContext: true,
      contextEnvironmentIds: [] as string[],
      autoEnrichmentEnabled: true,
      verifierProfile: null,
      requiresApproval: false,
      approvedAt: null,
      approvedByUserId: null,
      approvalBaselineTicketUpdatedAt: null,
      defaultBranchOverride: null,
      automationBranchStrategy: 'reuse_per_ticket',
      forceNewAutomationBranchNextRun: false,
      nextRetryAt: null,
      consecutiveFailureCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    it('updates automationEligible on list and open detail', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [mockTicket],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
      };
      const next = ticketsReducer(prev, patchTicketAutomationSuccess({ config: automationConfig }));

      expect(next.list[0].automationEligible).toBe(true);
      expect(next.detail?.automationEligible).toBe(true);
    });

    it('updates automationEligible from board socket automation upsert', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [{ ...mockTicket, automationEligible: false }],
        detail: { ...mockTicket, automationEligible: false },
        selectedTicketId: mockTicket.id,
      };
      const next = ticketsReducer(
        prev,
        ticketBoardAutomationUpsert({
          config: { ...automationConfig, eligible: true },
        }),
      );

      expect(next.list[0].automationEligible).toBe(true);
      expect(next.detail?.automationEligible).toBe(true);
    });
  });

  describe('board socket ticket upsert', () => {
    it('merges ticket into list and open detail', () => {
      const updated = { ...mockTicket, title: 'Renamed' };
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [mockTicket],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
      };
      const next = ticketsReducer(prev, ticketBoardTicketUpsert({ ticket: updated }));

      expect(next.list[0].title).toBe('Renamed');
      expect(next.detail?.title).toBe('Renamed');
    });
  });

  describe('board socket ticket removed', () => {
    it('removes ticket from list and clears open detail', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [mockTicket],
        detail: mockTicket,
        selectedTicketId: mockTicket.id,
      };
      const next = ticketsReducer(prev, ticketBoardTicketRemoved({ id: mockTicket.id, clientId: mockTicket.clientId }));

      expect(next.list).toEqual([]);
      expect(next.detail).toBeNull();
      expect(next.selectedTicketId).toBeNull();
    });

    it('does not clear detail or drop list row when removal targets another workspace', () => {
      const migrated = { ...mockTicket, clientId: 'client-2' };
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [migrated],
        detail: migrated,
        selectedTicketId: mockTicket.id,
      };
      const next = ticketsReducer(prev, ticketBoardTicketRemoved({ id: mockTicket.id, clientId: mockTicket.clientId }));

      expect(next.list).toHaveLength(1);
      expect(next.list[0]).toMatchObject(migrated);
      expect(next.detail).toMatchObject(migrated);
      expect(next.selectedTicketId).toBe(mockTicket.id);
    });
  });

  describe('board socket comment', () => {
    it('appends comment when detail is open for that ticket', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        comments: [],
      };
      const next = ticketsReducer(prev, ticketBoardCommentCreated({ comment: mockComment }));

      expect(next.comments).toEqual([mockComment]);
    });
  });

  describe('board socket activity', () => {
    it('prepends activity when detail is open for that ticket', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        selectedTicketId: mockTicket.id,
        activity: [],
      };
      const next = ticketsReducer(prev, ticketBoardActivityCreated({ activity: mockActivity }));

      expect(next.activity).toEqual([mockActivity]);
    });
  });

  describe('migrateTicket', () => {
    const child: TicketResponseDto = {
      ...mockTicket,
      id: 'ticket-child',
      parentId: mockTicket.id,
      clientId: 'client-1',
    };
    const migratedRoot: TicketResponseDto = {
      ...mockTicket,
      clientId: 'client-2',
      children: [{ ...child, clientId: 'client-2' }],
    };

    it('sets saving on migrateTicket', () => {
      const next = ticketsReducer(
        initialTicketsState,
        migrateTicket({ id: 'ticket-child', targetClientId: 'client-2' }),
      );

      expect(next.saving).toBe(true);
      expect(next.error).toBeNull();
    });

    it('replaces list rows and detail on migrateTicketSuccess', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [mockTicket, child],
        detail: child,
        selectedTicketId: child.id,
        saving: true,
      };
      const next = ticketsReducer(
        prev,
        migrateTicketSuccess({
          rootTicket: migratedRoot,
          migratedTicketIds: [mockTicket.id, child.id],
          requestedTicketId: child.id,
        }),
      );

      expect(next.saving).toBe(false);
      expect(next.list.map((t) => t.id).sort()).toEqual([mockTicket.id, child.id].sort());
      expect(next.list.every((t) => t.clientId === 'client-2')).toBe(true);
      expect(next.detail?.id).toBe(child.id);
      expect(next.detail?.clientId).toBe('client-2');
    });

    it('updates migrated detail from detail.id when selectedTicketId is null', () => {
      const prev: TicketsState = {
        ...initialTicketsState,
        list: [mockTicket, child],
        detail: child,
        selectedTicketId: null,
        saving: true,
      };
      const next = ticketsReducer(
        prev,
        migrateTicketSuccess({
          rootTicket: migratedRoot,
          migratedTicketIds: [mockTicket.id, child.id],
          requestedTicketId: child.id,
        }),
      );

      expect(next.detail?.id).toBe(child.id);
      expect(next.detail?.clientId).toBe('client-2');
    });

    it('clears saving on migrateTicketFailure', () => {
      const prev = { ...initialTicketsState, saving: true };
      const next = ticketsReducer(prev, migrateTicketFailure({ error: 'x' }));

      expect(next.saving).toBe(false);
      expect(next.error).toBe('x');
    });
  });
});
