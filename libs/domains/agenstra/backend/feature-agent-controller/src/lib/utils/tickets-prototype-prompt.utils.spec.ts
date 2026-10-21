import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import {
  appendRelatedContextSections,
  buildAutomationFollowUpMessage,
  buildAutonomousTicketRunPreamble,
  buildPrototypePrompt,
  withRelationContext,
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

  it('withRelationContext attaches trimmed relation sections as knowledge context', () => {
    const base = { includeWorkspace: true, environmentIds: ['a'], autoEnrichmentEnabled: true };

    expect(withRelationContext(base, [' Knowledge Page: A\nBody ', '  '])).toEqual({
      ...base,
      knowledgeContexts: ['Knowledge Page: A\nBody'],
    });
    expect(withRelationContext(base, [])).toBe(base);
  });

  it('buildAutomationFollowUpMessage references the ticket without its body', () => {
    expect(buildAutomationFollowUpMessage({ title: 'Fix login', longSha: 'abcdef1234567890' })).toBe(
      'Continue implementing ticket abcdef12 "Fix login" (the full ticket is attached as context). ' +
        'Finish the scoped work when possible; the platform will collect turn status after this turn.',
    );
    expect(buildAutomationFollowUpMessage({ title: 'Fix login' })).toContain(
      'Continue implementing ticket "Fix login"',
    );
  });
});
