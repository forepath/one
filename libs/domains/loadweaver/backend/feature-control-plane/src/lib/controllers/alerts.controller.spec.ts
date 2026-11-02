import type { AlertService } from '../alerts/alert.service';

import { AlertsController, ExportAlertsQueryDto } from './alerts.controller';

describe('AlertsController export', () => {
  function setup() {
    const list = jest.fn().mockResolvedValue([]);

    return { list, controller: new AlertsController({ list } as unknown as AlertService) };
  }

  it('exports every state by default, also when the query DTO carries unset fields as own undefined properties', async () => {
    const { list, controller } = setup();
    // What class-transformer produces under `useDefineForClassFields` (ES2022 class fields): declared, unset → undefined.
    const query = Object.assign(new ExportAlertsQueryDto(), { state: undefined, project: undefined, limit: undefined });

    await controller.export(query);

    expect(list).toHaveBeenCalledWith(undefined, { state: 'all', project: undefined, limit: 1000 });
  });

  it('keeps an explicit state, project and limit', async () => {
    const { list, controller } = setup();

    await controller.export(Object.assign(new ExportAlertsQueryDto(), { state: 'open', project: 'shop', limit: 5 }));

    expect(list).toHaveBeenCalledWith(undefined, { state: 'open', project: 'shop', limit: 5 });
  });
});
