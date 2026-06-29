import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminProjectsService } from '../../services/admin-projects.service';
import { ProjectsService } from '../../services/projects.service';

import {
  loadAdminProjects,
  loadAdminProjectsBatch,
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjects,
  loadProjectsBatch,
  loadProjectsFailure,
  loadProjectsSuccess,
  billProjectTime,
  billProjectTimeFailure,
  billProjectTimeSuccess,
  loadProjectSummary,
} from './projects.actions';
import {
  loadAdminProjects$,
  loadAdminProjectsBatch$,
  loadProjects$,
  loadProjectsBatch$,
  billProjectTime$,
} from './projects.effects';

describe('ProjectsEffects', () => {
  let actions$: Actions;
  let projectsService: jest.Mocked<ProjectsService>;
  let adminService: jest.Mocked<AdminProjectsService>;
  const project = {
    id: 'p-1',
    userId: 'u-1',
    name: 'Alpha',
    status: 'active' as const,
    hourlyRateNet: 100,
    currency: 'EUR',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  beforeEach(() => {
    projectsService = { list: jest.fn(), getById: jest.fn(), getSummary: jest.fn() } as never;
    adminService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      billTime: jest.fn(),
    } as never;
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: ProjectsService, useValue: projectsService },
        { provide: AdminProjectsService, useValue: adminService },
      ],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loadProjects$ returns empty success', (done) => {
    actions$ = of(loadProjects());
    projectsService.list.mockReturnValue(of({ items: [], total: 0, limit: 10, offset: 0 }));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsSuccess({ projects: [] }));
      done();
    });
  });

  it('loadProjects$ chains batch when full page', (done) => {
    actions$ = of(loadProjects());
    projectsService.list.mockReturnValue(of({ items: Array(10).fill(project), total: 20, limit: 10, offset: 0 }));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsBatch({ offset: 10, accumulatedProjects: Array(10).fill(project) }));
      done();
    });
  });

  it('loadProjects$ handles failure', (done) => {
    actions$ = of(loadProjects());
    projectsService.list.mockReturnValue(throwError(() => new Error('fail')));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsFailure({ error: 'fail' }));
      done();
    });
  });

  it('loadAdminProjects$ returns success for partial batch', (done) => {
    actions$ = of(loadAdminProjects());
    adminService.list.mockReturnValue(of({ items: [project], total: 1, limit: 10, offset: 0 }));

    loadAdminProjects$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsSuccess({ adminProjects: [project] }));
      done();
    });
  });

  it('loadAdminProjectsBatch$ accumulates', (done) => {
    actions$ = of(loadAdminProjectsBatch({ offset: 10, accumulatedProjects: [project] }));
    adminService.list.mockReturnValue(of({ items: [project], total: 2, limit: 10, offset: 10 }));

    loadAdminProjectsBatch$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsSuccess({ adminProjects: [project, project] }));
      done();
    });
  });

  it('billProjectTime dispatches success and reloads summary', (done) => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      lineItems: [{ description: 'Extra', quantity: 1, unitPriceNet: 10 }],
    };
    const result = { invoiceId: 'inv-1', billedMinutes: 60, amountNet: 110 };

    actions$ = of(billProjectTime({ projectId: 'p-1', dto }));
    adminService.billTime.mockReturnValue(of(result));

    const emissions: unknown[] = [];

    billProjectTime$(actions$, adminService).subscribe((action) => {
      emissions.push(action);

      if (emissions.length === 2) {
        expect(adminService.billTime).toHaveBeenCalledWith('p-1', dto);
        expect(emissions).toEqual([
          billProjectTimeSuccess({ projectId: 'p-1', result }),
          loadProjectSummary({ projectId: 'p-1' }),
        ]);
        done();
      }
    });
  });

  it('billProjectTime$ handles failure', (done) => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
    };

    actions$ = of(billProjectTime({ projectId: 'p-1', dto }));
    adminService.billTime.mockReturnValue(throwError(() => new Error('bill failed')));

    billProjectTime$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(billProjectTimeFailure({ error: 'bill failed' }));
      done();
    });
  });
});
