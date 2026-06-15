import type { TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import { buildTicketBodyHierarchyContext } from './ticket-body-hierarchy-context';

const emptyTasks = (): TicketResponseDto['tasks'] => ({
  open: 0,
  done: 0,
  children: { open: 0, done: 0 },
});

describe('buildTicketBodyHierarchyContext', () => {
  const base = (overrides: Partial<TicketResponseDto>): TicketResponseDto => ({
    id: 'id',
    clientId: 'c1',
    title: 'T',
    priority: 'medium',
    status: 'draft',
    automationEligible: false,
    createdAt: '',
    updatedAt: '',
    tasks: emptyTasks(),
    ...overrides,
  });

  it('returns empty string when there are no parents or subtasks', () => {
    const detail = base({ id: 'a', title: 'Only' });

    expect(buildTicketBodyHierarchyContext(detail, [detail])).toBe('');
  });

  it('includes nested subtasks', () => {
    const detail = base({
      id: 'root',
      title: 'Epic',
      children: [
        base({
          id: 'c1',
          title: 'Child',
          children: [base({ id: 'g1', title: 'Grandchild' })],
        }),
      ],
    });
    const out = buildTicketBodyHierarchyContext(detail, [detail]);

    expect(out).toContain('Subtasks under this ticket');
    expect(out).toContain('[c1]');
    expect(out).toContain('[g1]');
    expect(out).toContain('Grandchild');
  });

  it('includes parent chain from breadcrumb', () => {
    const parent = base({ id: 'p', title: 'Parent', status: 'todo' });
    const detail = base({ id: 'leaf', title: 'Leaf', parentId: 'p' });
    const out = buildTicketBodyHierarchyContext(detail, [parent, detail]);

    expect(out).toContain('Parent tickets');
    expect(out).toContain('[p]');
    expect(out).toContain('Parent');
  });
});
