import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SETTINGS_ADMIN_ENVIRONMENT } from '../tokens/settings-admin-environment';

import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: SETTINGS_ADMIN_ENVIRONMENT, useValue: { apiUrl: 'http://api', settingsBasePath: 'admin/settings' } },
      ],
    });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the backend default level without params', () => {
    service.getOverview(null).subscribe();
    const req = http.expectOne('http://api/admin/settings');

    expect(req.request.params.keys()).toEqual([]);
    req.flush({});
  });

  it('targets a tenant via level and viewTenantId', () => {
    service.upsert('SMTP_HOST', 'smtp.acme.test', { level: 'tenant', tenantId: 'acme' }).subscribe();
    const req = http.expectOne((r) => r.url === 'http://api/admin/settings/SMTP_HOST');

    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ value: 'smtp.acme.test' });
    expect(req.request.params.get('level')).toBe('tenant');
    expect(req.request.params.get('viewTenantId')).toBe('acme');
    req.flush({});
  });

  it('resets the override of all tenants without a tenant param', () => {
    service.reset('SMTP_HOST', { level: 'global', tenantId: 'acme' }).subscribe();
    const req = http.expectOne((r) => r.url === 'http://api/admin/settings/SMTP_HOST');

    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('level')).toBe('global');
    expect(req.request.params.has('viewTenantId')).toBe(false);
    req.flush({});
  });
});
