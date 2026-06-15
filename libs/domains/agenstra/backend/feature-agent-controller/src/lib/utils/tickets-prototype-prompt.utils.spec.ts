import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import { AGENSTRA_AUTOMATION_COMPLETE } from './automation-completion.constants';
import { buildAutonomousTicketRunPreamble, buildPrototypePrompt } from './tickets-prototype-prompt.utils';

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

  it('includes automation completion marker in autonomous preamble', () => {
    const preamble = buildAutonomousTicketRunPreamble();

    expect(preamble).toContain(AGENSTRA_AUTOMATION_COMPLETE);
  });
});
