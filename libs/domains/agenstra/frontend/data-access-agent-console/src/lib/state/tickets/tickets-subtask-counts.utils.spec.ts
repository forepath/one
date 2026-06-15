import { computeDirectSubtaskCounts, enrichTicketsWithSubtaskCounts } from './tickets-subtask-counts.utils';
import { EMPTY_TICKET_TASKS, type TicketResponseDto } from './tickets.types';

describe('tickets-subtask-counts.utils', () => {
  const base = (over: Partial<TicketResponseDto>): TicketResponseDto => ({
    id: 't1',
    clientId: 'c1',
    title: 'T',
    content: null,
    priority: 'medium',
    status: 'draft',
    preferredChatAgentId: null,
    automationEligible: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tasks: EMPTY_TICKET_TASKS,
    ...over,
  });

  describe('computeDirectSubtaskCounts', () => {
    it('counts direct children by parentId when children is absent', () => {
      const parent = base({ id: 'p' });
      const list: TicketResponseDto[] = [
        parent,
        base({ id: 'a', parentId: 'p', status: 'todo' }),
        base({ id: 'b', parentId: 'p', status: 'done' }),
        base({ id: 'c', parentId: 'p', status: 'closed' }),
        base({ id: 'other', parentId: null, status: 'todo' }),
      ];

      expect(computeDirectSubtaskCounts(parent, list)).toEqual({ open: 1, done: 2 });
    });

    it('uses ticket.children when present instead of scanning the list', () => {
      const parent = base({
        id: 'p',
        children: [
          base({ id: 'x', parentId: 'p', status: 'in_progress' }),
          base({ id: 'y', parentId: 'p', status: 'done' }),
        ],
      });
      const list: TicketResponseDto[] = [parent];

      expect(computeDirectSubtaskCounts(parent, list)).toEqual({ open: 1, done: 1 });
    });
  });

  describe('enrichTicketsWithSubtaskCounts', () => {
    it('sets subtaskCounts on list rows and detail.children', () => {
      const parent = base({ id: 'p' });
      const c1 = base({ id: 'c1', parentId: 'p', status: 'todo' });
      const list = [parent, c1];
      const detail: TicketResponseDto = { ...parent, children: [c1] };
      const { list: outList, detail: outDetail } = enrichTicketsWithSubtaskCounts(list, detail);

      expect(outList.find((t) => t.id === 'p')?.subtaskCounts).toEqual({ open: 1, done: 0 });
      expect(outList.find((t) => t.id === 'c1')?.subtaskCounts).toEqual({ open: 0, done: 0 });
      expect(outDetail?.subtaskCounts).toEqual({ open: 1, done: 0 });
      expect(outDetail?.children?.[0].subtaskCounts).toEqual({ open: 0, done: 0 });
    });
  });
});
