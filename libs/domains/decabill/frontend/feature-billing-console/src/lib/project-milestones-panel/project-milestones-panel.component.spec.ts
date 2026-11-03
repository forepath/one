import { TestBed } from '@angular/core/testing';
import {
  ProjectMilestonesFacade,
  ProjectMilestonesService,
  type ProjectMilestoneResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { ProjectMilestonesPanelComponent } from './project-milestones-panel.component';

const milestone = (id: string, overrides: Partial<ProjectMilestoneResponse> = {}): ProjectMilestoneResponse =>
  ({
    id,
    name: `Milestone ${id}`,
    progressPercent: 50,
    openTicketCount: 1,
    doneTicketCount: 1,
    lockedAt: null,
    ...overrides,
  }) as ProjectMilestoneResponse;

describe('ProjectMilestonesPanelComponent (nested table)', () => {
  let service: { lock: jest.Mock; delete: jest.Mock };
  let facade: { load: jest.Mock } & Record<string, unknown>;
  let component: ProjectMilestonesPanelComponent;

  beforeEach(() => {
    service = { lock: jest.fn(), delete: jest.fn() };
    facade = {
      milestones$: of([milestone('m1'), milestone('m2'), milestone('m3', { lockedAt: '2026-10-01T00:00:00Z' })]),
      loading$: of(false),
      saving$: of(false),
      error$: of(null),
      load: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectMilestonesFacade, useValue: facade },
        { provide: ProjectMilestonesService, useValue: service },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ProjectMilestonesPanelComponent());
    component.projectId = 'p1';
    component.isAdmin = true;
  });

  it('shows readable states (locked / in progress / completed / not started)', () => {
    const state = component.columns[0].state!;

    expect(state(milestone('a', { lockedAt: 'x' })).label).toBe('Locked');
    expect(state(milestone('b')).label).toBe('In progress');
    expect(state(milestone('c', { progressPercent: 100 })).label).toBe('Completed');
    expect(state(milestone('d', { progressPercent: 0 })).label).toBe('Not started');
  });

  it('offers row actions only on unlocked milestones for admins', () => {
    expect(component.rowMenu(milestone('a')).map((item) => item.id)).toEqual(['edit', 'lock', 'delete', 'copy-id']);
    expect(component.rowMenu(milestone('b', { lockedAt: 'x' })).map((item) => item.id)).toEqual(['copy-id']);
  });

  it('bulk Lock skips locked milestones and reports per-item results (incl. denied)', async () => {
    service.lock.mockImplementation((_: string, id: string) =>
      id === 'm2' ? throwError(() => ({ status: 403 })) : of(milestone(id)),
    );
    component.selected.set(['m1', 'm2', 'm3']);

    await component.lockSelected();

    expect(service.lock).toHaveBeenCalledTimes(2);
    expect(service.lock).toHaveBeenCalledWith('p1', 'm1');
    expect(component.bulkResult()?.message).toMatch(/1 done · 1 not allowed/);
    expect(facade.load).toHaveBeenCalledWith('p1');
  });
});
