import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { KioskRequestError, WallboardsService } from './wallboards.service';

describe('WallboardsService.kiosk', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the wallboard token itself, not the user’s credentials', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'Office', sections: [] }) });

    expect(await firstValueFrom(TestBed.inject(WallboardsService).kiosk('lw_wb_x'))).toEqual({
      name: 'Office',
      sections: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cp.example.com/api/public/wallboard',
      expect.objectContaining({
        credentials: 'omit',
        headers: expect.objectContaining({ Authorization: 'Wallboard lw_wb_x' }),
      }),
    );
  });

  it('reports the status and the API’s message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'wallboard token no longer valid' }),
    });

    const error = await firstValueFrom(TestBed.inject(WallboardsService).kiosk('lw_wb_x')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KioskRequestError);
    expect(error).toMatchObject({ status: 401, message: 'wallboard token no longer valid' });
  });
});
