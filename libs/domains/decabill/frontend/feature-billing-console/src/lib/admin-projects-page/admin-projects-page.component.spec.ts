import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminProjectsService,
  ProjectsFacade,
  type AdminProjectListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { AdminProjectsPageComponent } from './admin-projects-page.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const project = (id: string, status = 'active'): AdminProjectListItem =>
  ({
    id,
    name: `Project ${id}`,
    status,
    hourlyRateNet: 100,
    currency: 'EUR',
    unbilledMinutes: 0,
    openBillableAmountNet: 0,
  }) as AdminProjectListItem;

describe('AdminProjectsPageComponent (data list)', () => {
  const projects$ = of([project('p1'), project('p2'), project('p3', 'archived')]);
  let service: { update: jest.Mock; delete: jest.Mock; getById: jest.Mock };
  let facade: Record<string, unknown>;
  let component: AdminProjectsPageComponent;

  beforeEach(() => {
    service = { update: jest.fn(), delete: jest.fn(), getById: jest.fn() };
    facade = {
      adminProjects$: projects$,
      adminTotal$: of(3),
      loading$: of(false),
      creating$: of(false),
      updating$: of(false),
      deleting$: of(false),
      error$: of(null),
      loadAdminProjects: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectsFacade, useValue: facade },
        { provide: AdminProjectsService, useValue: service },
        { provide: AuthenticationFacade, useValue: { users$: of([]), loadUsers: jest.fn() } },
        { provide: ActivatedRoute, useValue: {} },
        {
          provide: Router,
          useValue: { serializeUrl: () => '/x', createUrlTree: () => ({}), navigateByUrl: jest.fn() },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminProjectsPageComponent());
  });

  it('has a State column first, the project name as required name column, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true, priority: 1 }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.rowMenu().map((item) => item.id)).toEqual(['open', 'edit', 'delete', 'copy-id']);
  });

  it('bulk Archive calls update per active project and reports per-item results (incl. denied)', async () => {
    service.update.mockImplementation((id: string) =>
      id === 'p2' ? throwError(() => ({ status: 403, message: 'Forbidden' })) : of({}),
    );
    component.selected.set(['p1', 'p2', 'p3']);

    expect(component.canArchiveSelection()).toBe(true);
    await component.archiveSelected();

    expect(service.update).toHaveBeenCalledTimes(2);
    expect(service.update).toHaveBeenCalledWith('p1', { status: 'archived' });
    expect(component.bulkResult()).toEqual(
      expect.objectContaining({ tone: 'warning', message: expect.stringContaining('1 not allowed') }),
    );
    expect(component.selected()).toEqual([]);
  });

  it('bulk Delete calls delete per project; a refused project (unbilled time) is reported as failed', async () => {
    service.delete.mockImplementation((id: string) =>
      id === 'p1' ? throwError(() => ({ status: 409, message: 'Unbilled time' })) : of(undefined),
    );
    component.selected.set(['p1', 'p2']);

    await component.deleteSelected();

    expect(service.delete).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 failed');
  });
});
