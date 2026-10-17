import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type ClusterRole,
  ConsoleAccessFacade,
  ConsoleRemoteAccessFacade,
  type VpnClient,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverDevicesPageComponent } from './devices-page.component';

const device = (overrides: Partial<VpnClient> = {}): VpnClient => ({
  id: 'd1',
  kind: 'user',
  name: 'laptop',
  owner: 'alice',
  address: '100.64.0.2',
  subnets: [],
  groups: ['staff'],
  effectiveGroups: ['staff-restricted'],
  restrictions: { staff: ['disk encryption off'] },
  status: 'active',
  createdAt: '2026-10-01T10:00:00.000Z',
  expiresAt: '2027-01-01T10:00:00.000Z',
  revokedAt: null,
  lastHandshakeAt: null,
  lastEndpoint: null,
  ...overrides,
});

describe('LoadweaverDevicesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverDevicesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(clusterRole: ClusterRole | null = null) {
    facade = facadeStub(
      {
        devices$: [device(), device({ id: 'd2', name: 'old', status: 'revoked', restrictions: {} })],
        all$: false,
        loading$: false,
        error$: null,
        revoking$: null,
        revokeError$: null,
        restrictedCount$: 1,
      },
      ['load', 'revoke'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverDevicesPageComponent],
      providers: [
        { provide: ConsoleRemoteAccessFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole, projects: {} }) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverDevicesPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists the caller’s devices with posture and shows how to enroll', async () => {
    await setup();

    const component = fixture.componentInstance;
    const list = el().querySelector('[data-testid="devices-list"]')?.textContent ?? '';

    expect(facade['load']).toHaveBeenCalledWith(false);
    expect(list).toContain('Restricted by posture');
    expect(list).toContain('staff: disk encryption off');
    expect(el().querySelector('[data-testid="devices-revoke-old"]')).toBeNull();
    expect(el().querySelector('[data-testid="devices-scope"]')).toBeNull();
    expect(el().querySelector('[data-testid="devices-restricted"]')).not.toBeNull();

    component.deviceName.set('work-laptop');
    fixture.detectChanges();
    expect((el().querySelector('[data-testid="devices-command"]') as HTMLInputElement).value).toBe(
      'loadweaver vpn enroll --name work-laptop',
    );

    component.showAll(true);
    expect(facade['load']).toHaveBeenLastCalledWith(false);
  });

  it('lets infra roles list every client and revokes after confirmation', async () => {
    await setup('infra-operator');

    const component = fixture.componentInstance;

    expect(el().querySelector('[data-testid="devices-scope"]')).not.toBeNull();
    component.showAll(true);
    expect(facade['load']).toHaveBeenLastCalledWith(true);

    component.revokeFor.set(device());
    expect(component.revokeMessage()).toContain('laptop');
    component.confirmRevoke();
    expect(facade['revoke']).toHaveBeenCalledWith('d1');
    expect(component.revokeFor()).toBeNull();
  });
});
