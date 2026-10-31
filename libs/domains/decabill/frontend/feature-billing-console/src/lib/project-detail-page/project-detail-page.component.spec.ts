import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminBillingService,
  AdminProjectsService,
  ProjectBoardSocketFacade,
  ProjectTimeEntriesFacade,
  ProjectTimeEntriesService,
  ProjectsFacade,
  type ProjectTimeEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { EMPTY, of, throwError } from 'rxjs';

import { ProjectDetailPageComponent } from './project-detail-page.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
jest.mock('../project-board/project-board.component', () => {
  const { Component } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-project-board', standalone: true, template: '' })
  class ProjectBoardComponent {}

  return { ProjectBoardComponent };
});
jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

/** Facade / service stub: unknown members are spies returning `of([])` that can also be subscribed to. */
function stub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(overrides, {
    get: (target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;

      if (!(key in target)) {
        const fn = jest.fn(() => of([]));

        Object.assign(fn, {
          subscribe: (...args: unknown[]) => (of([]).subscribe as (...a: unknown[]) => unknown)(...args),
          pipe: (...ops: unknown[]) => (of([]).pipe as (...o: unknown[]) => unknown)(...ops),
        });
        target[key] = fn;
      }

      return target[key];
    },
  });
}

const entry = (id: string, billed = false): ProjectTimeEntryResponse =>
  ({
    id,
    projectId: 'pr1',
    recordedByUserId: 'u1',
    durationMinutes: 30,
    description: `Work ${id}`,
    startedAt: '2026-10-01T08:00:00Z',
    endedAt: '2026-10-01T08:30:00Z',
    recordedAt: '2026-10-01T08:00:00Z',
    billedAt: billed ? '2026-10-02T00:00:00Z' : null,
    invoiceId: billed ? 'inv' : null,
    createdAt: '2026-10-01T08:00:00Z',
  }) as ProjectTimeEntryResponse;

describe('ProjectDetailPageComponent (time entries bulk Delete)', () => {
  let service: Record<string, jest.Mock>;
  let timeFacade: Record<string, unknown>;
  let component: ProjectDetailPageComponent;

  beforeEach(() => {
    service = { delete: jest.fn() };
    timeFacade = stub({ entries$: of([entry('t1'), entry('t2'), entry('t3', true)]), load: jest.fn() });
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
        { provide: Router, useValue: { events: EMPTY, url: '/', navigate: jest.fn(), createUrlTree: jest.fn() } },
        { provide: ProjectTimeEntriesService, useValue: stub(service) },
        { provide: ProjectTimeEntriesFacade, useValue: timeFacade },
        { provide: ProjectsFacade, useValue: stub() },
        { provide: AdminProjectsService, useValue: stub() },
        { provide: AdminBillingService, useValue: stub() },
        { provide: ProjectBoardSocketFacade, useValue: stub() },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ProjectDetailPageComponent());
    component.projectId = 'pr1';
    component.isAdminView.set(true);
  });

  it('deletes each selected unbilled entry (billed ones are skipped), per-item results incl. denied', async () => {
    service['delete'].mockImplementation((_project: string, id: string) =>
      id === 't2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selectedTimeEntries.set(['t1', 't2', 't3']);

    await component.deleteSelectedTimeEntries();

    expect(service['delete']).toHaveBeenCalledTimes(2);
    expect(service['delete']).not.toHaveBeenCalledWith('pr1', 't3');
    expect(component.timeBulkResult()?.message).toContain('1 done');
    expect(component.timeBulkResult()?.message).toContain('1 not allowed');
    // Reloads the current page (replace-page), not page 1 / an append.
    expect(timeFacade['load']).toHaveBeenLastCalledWith('pr1', 1, 25, '');
  });

  it('reloads the current page with its size after a bulk action', async () => {
    service['delete'].mockReturnValue(of(undefined));
    component.timePage.set(3);
    component.timePageSize.set(50);
    component.selectedTimeEntries.set(['t1']);

    await component.deleteSelectedTimeEntries();

    expect(timeFacade['load']).toHaveBeenLastCalledWith('pr1', 3, 50, '');
    expect(component.selectedTimeEntries()).toEqual([]);
  });
});
