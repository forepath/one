import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleWallboardsFacade,
  type WallboardToken,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverWallboardsPageComponent } from './wallboards-page.component';

const token: WallboardToken = {
  id: 'w1',
  name: 'Office',
  projects: ['shop'],
  createdBy: 'u',
  createdAt: '2026-10-01T10:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
};

describe('LoadweaverWallboardsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverWallboardsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let management: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe) {
    facade = facadeStub(
      {
        tokens$: [token],
        loading$: false,
        error$: null,
        creating$: false,
        created$: null,
        revoking$: null,
        tokenError$: null,
      },
      ['load', 'create', 'clearCreated', 'revoke'],
    );
    management = facadeStub({ projects$: ['shop', 'web'] }, ['loadProjects']);

    await TestBed.configureTestingModule({
      imports: [LoadweaverWallboardsPageComponent],
      providers: [
        { provide: ConsoleWallboardsFacade, useValue: facade },
        { provide: ConsoleAccessManagementFacade, useValue: management },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverWallboardsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('creates a cluster-wide wallboard and shows its kiosk URL once', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    expect(facade['load']).toHaveBeenCalled();
    expect(management['loadProjects']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="wallboards-list"]')?.textContent).toContain('Office');

    component.openCreate();
    expect(component.scope).toBe('cluster');

    component.create();
    expect(component.invalid()).toBe(true);

    component.name = ' Lobby ';
    component.expiresInDays = 30;
    component.create();
    expect(facade['create']).toHaveBeenCalledWith({ name: 'Lobby', expiresInDays: 30 });

    (facade['created$'] as BehaviorSubject<unknown>).next({
      ...token,
      projects: null,
      token: `lw_wb_${'x'.repeat(43)}`,
    });
    fixture.detectChanges();
    expect(component.createdUrl()).toMatch(new RegExp(`/kiosk#lw_wb_x{43}$`));

    component.onCreateOpenChange(false);
    expect(facade['clearCreated']).toHaveBeenCalledTimes(2);
  });

  it('limits project admins to their projects', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'admin', web: 'viewer' } });

    const component = fixture.componentInstance;

    expect(management['loadProjects']).not.toHaveBeenCalled();
    expect(component.adminProjects()).toEqual(['shop']);

    component.openCreate();
    expect(component.scope).toBe('projects');
    expect(component.selectedProjects()).toEqual(['shop']);

    component.name = 'Team';
    component.expiresInDays = null;
    component.create();
    expect(facade['create']).toHaveBeenCalledWith({ name: 'Team', projects: ['shop'] });

    component.toggleProject('shop', false);
    component.create();
    expect(component.invalid()).toBe(true);
  });

  it('revokes after confirmation', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;

    component.revokeFor.set(token);
    component.confirmRevoke();
    expect(facade['revoke']).toHaveBeenCalledWith('w1');
  });
});
