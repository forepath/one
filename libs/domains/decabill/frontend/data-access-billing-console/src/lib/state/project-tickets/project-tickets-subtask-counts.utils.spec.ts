import { computeDirectSubtaskCounts, enrichTicketsWithSubtaskCounts } from './project-tickets-subtask-counts.utils';

describe('project-tickets-subtask-counts.utils', () => {
  const parent = {
    id: 'p',
    projectId: 'proj',
    title: 'Parent',
    status: 'todo' as const,
    priority: 'medium' as const,
    shas: { short: 'a', long: 'a' },
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    locked: false,
    createdAt: '',
    updatedAt: '',
  };
  const openChild = { ...parent, id: 'c1', parentId: 'p', status: 'todo' as const };
  const doneChild = { ...parent, id: 'c2', parentId: 'p', status: 'done' as const };

  it('computeDirectSubtaskCounts counts open and done', () => {
    const counts = computeDirectSubtaskCounts(parent, [parent, openChild, doneChild]);

    expect(counts).toEqual({ open: 1, done: 1 });
  });

  it('enrichTicketsWithSubtaskCounts adds subtaskCounts', () => {
    const { list } = enrichTicketsWithSubtaskCounts([parent, openChild], null);

    expect(list[0].subtaskCounts).toEqual({ open: 1, done: 0 });
  });
});
