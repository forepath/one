import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import {
  appendRelatedContextSections,
  buildAutonomousTicketRunPreamble,
  buildPrototypePrompt,
} from './tickets-prototype-prompt.utils';

describe('tickets-prototype-prompt.utils', () => {
  it('includes nested children in prompt text', () => {
    const tree = {
      id: 'root',
      title: 'Root',
      content: 'Spec',
      priority: TicketPriority.HIGH,
      status: TicketStatus.TODO,
      children: [
        {
          id: 'c1',
          title: 'Child',
          content: null,
          priority: TicketPriority.LOW,
          status: TicketStatus.DRAFT,
          children: [],
        },
      ],
    };
    const out = buildPrototypePrompt(tree);

    expect(out).toContain('[root]');
    expect(out).toContain('[c1]');
    expect(out).toContain('Child');
  });

  it('includes structured turn-status instructions in autonomous preamble', () => {
    const preamble = buildAutonomousTicketRunPreamble();

    expect(preamble).toContain('status');
    expect(preamble).toContain('complete');
    expect(preamble).toContain('continue');
    expect(preamble).not.toContain('AGENSTRA_AUTOMATION_COMPLETE');
  });

  it('appendRelatedContextSections adds labeled related blocks', () => {
    const out = appendRelatedContextSections('Ticket tree', ['Knowledge Page: A\nBody', '  ']);

    expect(out).toContain('Ticket tree');
    expect(out).toContain('Related context (from knowledge relations)');
    expect(out).toContain('### Related context 1');
    expect(out).toContain('Knowledge Page: A');
    expect(out).not.toContain('### Related context 2');
  });

  it('appendRelatedContextSections is a no-op for empty sections', () => {
    expect(appendRelatedContextSections('Ticket tree', [])).toBe('Ticket tree');
  });
});
