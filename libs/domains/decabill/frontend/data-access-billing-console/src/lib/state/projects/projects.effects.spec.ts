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
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjectSummaryFailure,
  loadProjectSummarySuccess,
  loadAdminProjectDetail,
  loadAdminProjectDetailFailure,
  loadAdminProjectDetailSuccess,
  createAdminProject,
  createAdminProjectFailure,
  createAdminProjectSuccess,
  updateAdminProject,
  updateAdminProjectFailure,
  updateAdminProjectSuccess,
  deleteAdminProject,
  deleteAdminProjectFailure,
  deleteAdminProjectSuccess,
} from './projects.actions';
import {
  loadAdminProjects$,
  loadAdminProjectsBatch$,
  loadProjects$,
  loadProjectsBatch$,
  billProjectTime$,
  loadProjectDetail$,
  loadProjectSummary$,
  loadAdminProjectDetail$,
  createAdminProject$,
  updateAdminProject$,
  deleteAdminProject$,
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

  it('loadProjectsBatch$ accumulates and completes', (done) => {
    actions$ = of(loadProjectsBatch({ offset: 10, accumulatedProjects: [project] }));
    projectsService.list.mockReturnValue(of({ items: [project], total: 2, limit: 10, offset: 10 }));

    loadProjectsBatch$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsSuccess({ projects: [project, project] }));
      done();
    });
  });

  it('loadProjectsBatch$ chains another batch when full page', (done) => {
    actions$ = of(loadProjectsBatch({ offset: 10, accumulatedProjects: [project] }));
    projectsService.list.mockReturnValue(of({ items: Array(10).fill(project), total: 30, limit: 10, offset: 10 }));

    loadProjectsBatch$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsBatch({ offset: 20, accumulatedProjects: Array(11).fill(project) }));
      done();
    });
  });

  it('loadProjectDetail$ returns success', (done) => {
    actions$ = of(loadProjectDetail({ projectId: 'p-1' }));
    projectsService.getById.mockReturnValue(of(project));

    loadProjectDetail$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectDetailSuccess({ project }));
      done();
    });
  });

  it('loadProjectDetail$ handles failure', (done) => {
    actions$ = of(loadProjectDetail({ projectId: 'p-1' }));
    projectsService.getById.mockReturnValue(throwError(() => ({ message: 'missing' })));

    loadProjectDetail$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectDetailFailure({ error: 'missing' }));
      done();
    });
  });

  it('loadProjectSummary$ returns success', (done) => {
    const summary = {
      projectId: 'p-1',
      totalTrackedMinutes: 0,
      unbilledMinutes: 0,
      openBillableAmountNet: 0,
      billedAmountNet: 0,
      openTicketCount: 0,
      doneTicketCount: 0,
      milestoneCount: 0,
    };
    actions$ = of(loadProjectSummary({ projectId: 'p-1' }));
    projectsService.getSummary.mockReturnValue(of(summary));

    loadProjectSummary$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectSummarySuccess({ summary }));
      done();
    });
  });

  it('loadProjectSummary$ handles failure', (done) => {
    actions$ = of(loadProjectSummary({ projectId: 'p-1' }));
    projectsService.getSummary.mockReturnValue(throwError(() => 'summary failed'));

    loadProjectSummary$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectSummaryFailure({ error: 'summary failed' }));
      done();
    });
  });

  it('loadAdminProjects$ chains batch when full page', (done) => {
    actions$ = of(loadAdminProjects());
    adminService.list.mockReturnValue(of({ items: Array(10).fill(project), total: 20, limit: 10, offset: 0 }));

    loadAdminProjects$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsBatch({ offset: 10, accumulatedProjects: Array(10).fill(project) }));
      done();
    });
  });

  it('loadAdminProjects$ handles failure', (done) => {
    actions$ = of(loadAdminProjects());
    adminService.list.mockReturnValue(throwError(() => new Error('admin failed')));

    loadAdminProjects$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsFailure({ error: 'admin failed' }));
      done();
    });
  });

  it('loadAdminProjectDetail$ returns success', (done) => {
    actions$ = of(loadAdminProjectDetail({ projectId: 'p-1' }));
    adminService.getById.mockReturnValue(of(project));

    loadAdminProjectDetail$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectDetailSuccess({ project }));
      done();
    });
  });

  it('loadAdminProjectDetail$ handles failure', (done) => {
    actions$ = of(loadAdminProjectDetail({ projectId: 'p-1' }));
    adminService.getById.mockReturnValue(throwError(() => new Error('missing')));

    loadAdminProjectDetail$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectDetailFailure({ error: 'missing' }));
      done();
    });
  });

  it('createAdminProject$ returns success', (done) => {
    actions$ = of(createAdminProject({ dto: { name: 'New', userId: 'u-1', hourlyRateNet: 100, currency: 'EUR' } }));
    adminService.create.mockReturnValue(of(project));

    createAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(createAdminProjectSuccess({ project }));
      done();
    });
  });

  it('createAdminProject$ handles failure', (done) => {
    actions$ = of(createAdminProject({ dto: { name: 'New', userId: 'u-1', hourlyRateNet: 100, currency: 'EUR' } }));
    adminService.create.mockReturnValue(throwError(() => new Error('create failed')));

    createAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(createAdminProjectFailure({ error: 'create failed' }));
      done();
    });
  });

  it('updateAdminProject$ returns success', (done) => {
    actions$ = of(updateAdminProject({ projectId: 'p-1', dto: { name: 'Beta' } }));
    adminService.update.mockReturnValue(of({ ...project, name: 'Beta' }));

    updateAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(updateAdminProjectSuccess({ project: { ...project, name: 'Beta' } }));
      done();
    });
  });

  it('updateAdminProject$ handles failure', (done) => {
    actions$ = of(updateAdminProject({ projectId: 'p-1', dto: { name: 'Beta' } }));
    adminService.update.mockReturnValue(throwError(() => new Error('update failed')));

    updateAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(updateAdminProjectFailure({ error: 'update failed' }));
      done();
    });
  });

  it('deleteAdminProject$ returns success', (done) => {
    actions$ = of(deleteAdminProject({ projectId: 'p-1' }));
    adminService.delete.mockReturnValue(of(undefined));

    deleteAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(deleteAdminProjectSuccess({ projectId: 'p-1' }));
      done();
    });
  });

  it('deleteAdminProject$ handles failure', (done) => {
    actions$ = of(deleteAdminProject({ projectId: 'p-1' }));
    adminService.delete.mockReturnValue(throwError(() => new Error('delete failed')));

    deleteAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(deleteAdminProjectFailure({ error: 'delete failed' }));
      done();
    });
  });
});
