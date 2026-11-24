import '@angular/localize/init';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { agenstraActionCenterPresenters } from './agenstra-action-center.presenters';

function backendTypes(): string[] {
  const file = join(
    __dirname,
    '../../../../../backend/feature-agent-controller/src/lib/action-center/agenstra-action-center.types.ts',
  );

  return [...readFileSync(file, 'utf-8').matchAll(/'(agenstra\.[a-z_.]+)'/g)].map((match) => match[1]);
}

describe('agenstraActionCenterPresenters', () => {
  const set = agenstraActionCenterPresenters();

  it('presents every item type of the agent controller', () => {
    const types = backendTypes();

    expect(types.length).toBeGreaterThan(10);
    expect(types.filter((type) => !set.types[type])).toEqual([]);
    expect(Object.keys(set.types).filter((type) => !types.includes(type))).toEqual([]);
  });

  it('links records into their workspace', () => {
    const item = { id: 't-1', params: { clientId: 'c-1', title: 'Fix' }, occurredAt: null, silencedBy: null };

    expect(set.types['agenstra.tickets.automation_approval'].itemLink?.(item, {} as never)).toEqual({
      commands: ['/tickets', 'c-1'],
      queryParams: { openTicketId: 't-1' },
    });
    expect(set.types['agenstra.tasks.approval_pending'].itemLink?.(item, {} as never)).toEqual({
      commands: ['/tasks', 'c-1'],
      queryParams: undefined,
    });
  });

  it('links a group to its workspace when all records share it', () => {
    const group = {
      items: [
        { id: 'a', params: { clientId: 'c-1' }, occurredAt: null, silencedBy: null },
        { id: 'b', params: { clientId: 'c-1' }, occurredAt: null, silencedBy: null },
      ],
    };

    expect(set.types['agenstra.deployments.run_failed'].link?.(group as never)).toEqual({
      commands: ['/pipelines', 'c-1'],
      queryParams: undefined,
    });
  });
});
