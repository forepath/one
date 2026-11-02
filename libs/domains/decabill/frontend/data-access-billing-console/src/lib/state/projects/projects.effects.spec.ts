import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminProjectsService } from '../../services/admin-projects.service';
import { ProjectsService } from '../../services/projects.service';

import {
  loadAdminProjects,
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjects,
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
  loadProjects$,
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
    actions$ = of(loadProjects({}));
    projectsService.list.mockReturnValue(of({ items: [], total: 0, limit: 25, offset: 0 }));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsSuccess({ projects: [], total: 0 }));
      expect(projectsService.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
      done();
    });
  });

  it('loadProjects$ loads the requested page with the total', (done) => {
    actions$ = of(loadProjects({ page: 2, pageSize: 10 }));
    const items = Array(10).fill(project);
    projectsService.list.mockReturnValue(of({ items, total: 20, limit: 10, offset: 10 }));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsSuccess({ projects: items, total: 20 }));
      expect(projectsService.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 10 }));
      done();
    });
  });

  it('loadProjects$ handles failure', (done) => {
    actions$ = of(loadProjects({}));
    projectsService.list.mockReturnValue(throwError(() => new Error('fail')));

    loadProjects$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectsFailure({ error: 'fail' }));
      done();
    });
  });

  it('loadAdminProjects$ loads the requested page with filters', (done) => {
    actions$ = of(loadAdminProjects({ search: 'alpha', page: 3 }));
    adminService.list.mockReturnValue(of({ items: [project], total: 51, limit: 25, offset: 50 }));

    loadAdminProjects$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsSuccess({ adminProjects: [project], total: 51 }));
      expect(adminService.list).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 50, search: 'alpha', limit: 25 }),
      );
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

  it('loadProjectDetail$', (done) => {
    actions$ = of(loadProjectDetail({ projectId: 'p-1' }));
    projectsService.getById.mockReturnValue(of(project));

    loadProjectDetail$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectDetailSuccess({ project }));
      done();
    });
  });

  it('loadProjectDetail$ failure', (done) => {
    actions$ = of(loadProjectDetail({ projectId: 'p-1' }));
    projectsService.getById.mockReturnValue(throwError(() => new Error('missing')));

    loadProjectDetail$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectDetailFailure({ error: 'missing' }));
      done();
    });
  });

  it('loadProjectSummary$', (done) => {
    const summary = {
      projectId: 'p-1',
      totalTrackedMinutes: 10,
      unbilledMinutes: 5,
      openBillableAmountNet: 1,
      billedAmountNet: 2,
      openTicketCount: 0,
      doneTicketCount: 0,
      milestoneCount: 0,
      openMilestoneCount: 0,
    };
    actions$ = of(loadProjectSummary({ projectId: 'p-1' }));
    projectsService.getSummary.mockReturnValue(of(summary));

    loadProjectSummary$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectSummarySuccess({ summary }));
      done();
    });
  });

  it('loadProjectSummary$ failure', (done) => {
    actions$ = of(loadProjectSummary({ projectId: 'p-1' }));
    projectsService.getSummary.mockReturnValue(throwError(() => new Error('summary failed')));

    loadProjectSummary$(actions$, projectsService).subscribe((result) => {
      expect(result).toEqual(loadProjectSummaryFailure({ error: 'summary failed' }));
      done();
    });
  });

  it('loadAdminProjectDetail$', (done) => {
    actions$ = of(loadAdminProjectDetail({ projectId: 'p-1' }));
    adminService.getById.mockReturnValue(of({ ...project, unbilledMinutes: 0, openBillableAmountNet: 0 }));

    loadAdminProjectDetail$(actions$, adminService).subscribe((result) => {
      expect(result.type).toBe(loadAdminProjectDetailSuccess.type);
      done();
    });
  });

  it('loadAdminProjectDetail$ failure', (done) => {
    actions$ = of(loadAdminProjectDetail({ projectId: 'p-1' }));
    adminService.getById.mockReturnValue(throwError(() => new Error('admin missing')));

    loadAdminProjectDetail$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectDetailFailure({ error: 'admin missing' }));
      done();
    });
  });

  it('create/update/delete admin project', (done) => {
    actions$ = of(createAdminProject({ dto: { userId: 'u-1', name: 'Alpha', hourlyRateNet: 100 } }));
    adminService.create.mockReturnValue(of(project));

    createAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(createAdminProjectSuccess({ project }));
      done();
    });
  });

  it('createAdminProject$ failure', (done) => {
    actions$ = of(createAdminProject({ dto: { userId: 'u-1', name: 'Alpha', hourlyRateNet: 100 } }));
    adminService.create.mockReturnValue(throwError(() => new Error('create failed')));

    createAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(createAdminProjectFailure({ error: 'create failed' }));
      done();
    });
  });

  it('updateAdminProject$', (done) => {
    actions$ = of(updateAdminProject({ projectId: 'p-1', dto: { name: 'Beta' } }));
    adminService.update.mockReturnValue(of({ ...project, name: 'Beta' }));

    updateAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(updateAdminProjectSuccess({ project: { ...project, name: 'Beta' } }));
      done();
    });
  });

  it('updateAdminProject$ failure', (done) => {
    actions$ = of(updateAdminProject({ projectId: 'p-1', dto: { name: 'Beta' } }));
    adminService.update.mockReturnValue(throwError(() => new Error('update failed')));

    updateAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(updateAdminProjectFailure({ error: 'update failed' }));
      done();
    });
  });

  it('deleteAdminProject$', (done) => {
    actions$ = of(deleteAdminProject({ projectId: 'p-1' }));
    adminService.delete.mockReturnValue(of(void 0));

    deleteAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(deleteAdminProjectSuccess({ projectId: 'p-1' }));
      done();
    });
  });

  it('deleteAdminProject$ failure', (done) => {
    actions$ = of(deleteAdminProject({ projectId: 'p-1' }));
    adminService.delete.mockReturnValue(throwError(() => new Error('delete failed')));

    deleteAdminProject$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(deleteAdminProjectFailure({ error: 'delete failed' }));
      done();
    });
  });

  it('loadAdminProjects$ failure', (done) => {
    actions$ = of(loadAdminProjects({}));
    adminService.list.mockReturnValue(throwError(() => new Error('admin fail')));

    loadAdminProjects$(actions$, adminService).subscribe((result) => {
      expect(result).toEqual(loadAdminProjectsFailure({ error: 'admin fail' }));
      done();
    });
  });
});
