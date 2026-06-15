import { TicketEntity } from '../entities/ticket.entity';
import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import {
  buildDescendantCheckboxTaskTotalsByTicketId,
  countMarkdownCheckboxTasks,
} from './ticket-content-checkbox-tasks.utils';

describe('countMarkdownCheckboxTasks', () => {
  it('returns zeros for null or empty', () => {
    expect(countMarkdownCheckboxTasks(null)).toEqual({ open: 0, done: 0 });
    expect(countMarkdownCheckboxTasks(undefined)).toEqual({ open: 0, done: 0 });
    expect(countMarkdownCheckboxTasks('')).toEqual({ open: 0, done: 0 });
  });

  it('counts open and done', () => {
    const md = `
## Plan
- [ ] one
- [x] two
- [X] three
- [ ] four
`;

    expect(countMarkdownCheckboxTasks(md)).toEqual({ open: 2, done: 2 });
  });

  it('counts bracket-only checkboxes', () => {
    expect(countMarkdownCheckboxTasks('[ ] a [x] b')).toEqual({ open: 1, done: 1 });
  });

  it('treats whitespace-only brackets as open', () => {
    expect(countMarkdownCheckboxTasks('[  ]')).toEqual({ open: 1, done: 0 });
  });
});

describe('buildDescendantCheckboxTaskTotalsByTicketId', () => {
  function ent(id: string, parentId: string | null, content: string | null): TicketEntity {
    return {
      id,
      clientId: 'c1',
      parentId,
      title: id,
      content,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.DRAFT,
      createdByUserId: null,
      preferredChatAgentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TicketEntity;
  }

  it('aggregates only descendants', () => {
    const root = ent('root', null, '- [ ] r1\n- [x] r2');
    const a = ent('a', 'root', '- [ ] a1');
    const b = ent('b', 'a', '- [x] b1');
    const map = buildDescendantCheckboxTaskTotalsByTicketId([root, a, b]);

    expect(map.get('root')).toEqual({ open: 1, done: 1 });
    expect(map.get('a')).toEqual({ open: 0, done: 1 });
    expect(map.get('b')).toEqual({ open: 0, done: 0 });
  });
});
