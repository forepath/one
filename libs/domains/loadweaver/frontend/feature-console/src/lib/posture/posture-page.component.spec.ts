import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ConsoleAccessFacade,
  ConsolePostureService,
  type ClusterRole,
  type PostureIntegration,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { accessStub } from '../testing';
import { LoadweaverPosturePageComponent } from './posture-page.component';

const integration: PostureIntegration = {
  id: 'i1',
  name: 'intune',
  type: 'intune',
  displayName: 'Microsoft Intune',
  category: 'mdm',
  enabled: true,
  config: { tenantId: 'contoso.onmicrosoft.com', clientId: 'app' },
  secretsSet: ['clientSecret'],
  matchBy: ['serial', 'hostname'],
  requireUserMatch: true,
  intervalMinutes: 30,
  maxAgeMinutes: 1440,
  status: 'failing',
  lastSyncAt: '2026-10-20T10:00:00Z',
  lastSuccessAt: null,
  lastError: 'POST login.microsoftonline.com/x/oauth2/v2.0/token answered 401',
  failures: 2,
  nextSyncAt: '2026-10-20T11:00:00Z',
  vendorDevices: 0,
  matchedDevices: 0,
};

describe('LoadweaverPosturePageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPosturePageComponent>;
  let api: Record<string, jest.Mock>;

  async function setup(clusterRole: ClusterRole | null) {
    api = {
      plugins: jest.fn(() =>
        of([
          {
            id: 'intune',
            displayName: 'Microsoft Intune',
            category: 'mdm',
            defaultMatchBy: ['serial', 'deviceId'],
            supportsUserMatch: true,
            fields: [
              { key: 'tenantId', label: 'Tenant ID', required: true },
              { key: 'clientId', label: 'Client ID', required: true },
              { key: 'clientSecret', label: 'Client secret', required: true, secret: true },
            ],
          },
        ]),
      ),
      integrations: jest.fn(() => of([integration])),
      certificateTrust: jest.fn(() =>
        of({
          companyCaPem: null,
          crlPem: null,
          trustClusterCa: true,
          requireProof: true,
          companyCaSubjects: [],
          updatedAt: null,
        }),
      ),
      test: jest.fn(() => of({ ok: true, message: 'Microsoft Graph answered' })),
      testUnsaved: jest.fn(() => of({ ok: true, message: 'ok' })),
      create: jest.fn(() => of(integration)),
      update: jest.fn(() => of(integration)),
      sync: jest.fn(() => of(undefined)),
      remove: jest.fn(() => of(undefined)),
      updateCertificateTrust: jest.fn(() =>
        of({
          companyCaPem: null,
          crlPem: null,
          trustClusterCa: false,
          requireProof: true,
          companyCaSubjects: [],
          updatedAt: null,
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverPosturePageComponent],
      providers: [
        { provide: ConsolePostureService, useValue: api },
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole, projects: {} }) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPosturePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists integrations with their sync state; operators get no edit actions', async () => {
    await setup('infra-operator');

    const list = el().querySelector('[data-testid="posture-list"]')?.textContent ?? '';

    expect(list).toContain('intune');
    expect(list).toContain('Failing');
    expect(list).toContain('answered 401');
    // Hostname matching is opt-in and always warned about.
    expect(el().querySelector('[data-testid="posture-warning-intune"]')?.textContent).toContain(
      'Matching by hostname is weak',
    );
    expect(el().querySelector('[data-testid="posture-add"]')).toBeNull();
    expect(el().querySelector('[data-testid="posture-test-intune"]')).toBeNull();
  });

  it('lets cluster admins test, edit (keeping stored secrets) and create integrations', async () => {
    await setup('cluster-admin');

    const component = fixture.componentInstance;

    await component.test(integration);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="posture-test-result-intune"]')?.textContent).toContain(
      'Microsoft Graph answered',
    );

    component.openEdit(integration);
    expect(component.formValid()).toBe(true);
    await component.save();
    expect(api['update']).toHaveBeenCalledWith('i1', {
      enabled: true,
      config: { tenantId: 'contoso.onmicrosoft.com', clientId: 'app' },
      matchBy: ['serial', 'hostname'],
      requireUserMatch: true,
      intervalMinutes: 30,
      maxAgeMinutes: 1440,
    });
    component.openEdit(integration);
    component.patchForm({ requireUserMatch: false });
    expect(
      component.integrationWarnings(component.form() as NonNullable<ReturnType<typeof component.form>>),
    ).toHaveLength(2);

    component.openCreate();
    component.patchForm({ name: 'intune-eu' });
    expect(component.formValid()).toBe(false);
    component.setValue('tenantId', 'contoso.onmicrosoft.com');
    component.setValue('clientId', 'app');
    component.setValue('clientSecret', 's3cr3t');
    component.toggleMatch('hostname', false);
    expect(component.formValid()).toBe(true);
    await component.save();
    expect(api['create']).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'intune-eu',
        type: 'intune',
        matchBy: ['serial', 'deviceId'],
        requireUserMatch: true,
        config: { tenantId: 'contoso.onmicrosoft.com', clientId: 'app', clientSecret: 's3cr3t' },
      }),
    );
  });

  it('saves the certificate trust', async () => {
    await setup('cluster-admin');

    const component = fixture.componentInstance;

    component.patchTrust({ trustClusterCa: false });
    await component.saveTrust();
    expect(api['updateCertificateTrust']).toHaveBeenCalledWith({
      companyCaPem: null,
      crlPem: null,
      trustClusterCa: false,
      requireProof: true,
    });
    expect(component.trustSaved()).toBe(true);
  });

  it('shows a declared field that is not in the form yet as its default (or empty)', async () => {
    await setup('cluster-admin');

    const component = fixture.componentInstance;

    expect(component.fieldValue({ cloud: 'eu' }, 'cloud', 'us')).toBe('eu');
    expect(component.fieldValue({}, 'cloud', 'us')).toBe('us');
    expect(component.fieldValue({}, 'tenantId')).toBe('');
  });
});
