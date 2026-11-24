import '@angular/localize/init';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DECABILL_PLATFORM_ACTION_LINKS, decabillActionCenterPresenters } from './decabill-action-center.presenters';

/** Item types declared by the billing manager (the backend catalog is the source of truth). */
function backendTypes(): string[] {
  const file = join(
    __dirname,
    '../../../../../backend/feature-billing-manager/src/lib/action-center/decabill-action-center.types.ts',
  );

  return [...readFileSync(file, 'utf-8').matchAll(/'(decabill\.[a-z_.]+)'/g)].map((match) => match[1]);
}

describe('decabillActionCenterPresenters', () => {
  const set = decabillActionCenterPresenters();

  it('presents every item type of the billing manager', () => {
    const types = backendTypes();

    expect(types.length).toBeGreaterThan(30);
    expect(types.filter((type) => !set.types[type])).toEqual([]);
    expect(Object.keys(set.types).filter((type) => !types.includes(type))).toEqual([]);
  });

  it('names every category the billing manager reports', () => {
    const file = readFileSync(
      join(
        __dirname,
        '../../../../../backend/feature-billing-manager/src/lib/action-center/billing-setup.action-source.ts',
      ),
      'utf-8',
    );

    expect(file).toContain("category: 'accounting'");
    expect(Object.keys(set.categories ?? {})).toEqual(
      expect.arrayContaining([
        'receivables',
        'offers',
        'payables',
        'customers',
        'subscriptions',
        'inventory',
        'accounting',
      ]),
    );
  });

  it('deep-links records by number', () => {
    const presenter = set.types['decabill.invoices.unsent'];
    const item = { id: 'i', params: { number: 'R-1' }, occurredAt: null, silencedBy: null };

    expect(presenter.itemLink?.(item, {} as never)).toEqual({
      commands: ['/administration/billing'],
      queryParams: { 'inv-q': 'R-1' },
    });
    expect(set.types['decabill.payables.due'].itemLink?.(item, {} as never)).toEqual({
      commands: ['/administration/billing'],
      queryParams: { perspective: 'supplier', 'sinv-q': 'R-1' },
    });
    expect(DECABILL_PLATFORM_ACTION_LINKS.emailSettings.commands).toEqual(['/administration/settings']);
  });
});
