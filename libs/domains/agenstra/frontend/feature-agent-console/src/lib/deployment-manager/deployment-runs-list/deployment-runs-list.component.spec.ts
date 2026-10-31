import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DeploymentsFacade,
  DeploymentsService,
  type DeploymentRun,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { deploymentTableState } from '../deployment-labels';
import { DeploymentRunsListComponent } from './deployment-runs-list.component';

function run(id: string, runName: string, status: string, conclusion?: string): DeploymentRun {
  return {
    id,
    configurationId: 'cfg',
    providerRunId: `p-${id}`,
    runName,
    status,
    conclusion,
    ref: 'main',
    sha: 'abcdef1234567',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
  };
}

describe('DeploymentRunsListComponent', () => {
  let fixture: ComponentFixture<DeploymentRunsListComponent>;
  let facade: { runs$: BehaviorSubject<DeploymentRun[]>; loadRuns: jest.Mock } & Record<string, unknown>;
  let service: { cancelRun: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    facade = {
      runs$: new BehaviorSubject([
        run('r-1', 'Deploy prod', 'in_progress'),
        run('r-2', 'Deploy stage', 'queued'),
        run('r-3', 'Deploy old', 'completed', 'failure'),
      ]),
      loadingRuns$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      loadRuns: jest.fn(),
    };
    service = {
      cancelRun: jest.fn((_c: string, _a: string, id: string) =>
        id === 'r-2' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(undefined),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [DeploymentRunsListComponent],
      providers: [
        { provide: DeploymentsFacade, useValue: facade },
        { provide: DeploymentsService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeploymentRunsListComponent);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('agentId', 'agent-1');
    fixture.detectChanges();
  });

  afterEach(() => jest.useRealTimers());

  it('loads one page (+1 for "has next") from the server', () => {
    jest.advanceTimersByTime(300);

    expect(facade.loadRuns).toHaveBeenLastCalledWith('client-1', 'agent-1', 26, 0, undefined);

    fixture.componentInstance.page.set(2);
    fixture.detectChanges();
    jest.advanceTimersByTime(300);

    expect(facade.loadRuns).toHaveBeenLastCalledWith('client-1', 'agent-1', 26, 25, undefined);
  });

  it('shows readable run states (conclusion wins once completed)', () => {
    expect(deploymentTableState(run('x', 'x', 'completed', 'failure')).label).toBe('Failed');
    expect(deploymentTableState(run('x', 'x', 'in_progress')).label).toBe('In progress');
    expect(deploymentTableState(run('x', 'x', 'weird_state')).label).toBe('weird_state');
  });

  it('cancels the selected active runs one by one and reports per-run results (incl. denied)', async () => {
    jest.useRealTimers();
    const component = fixture.componentInstance;

    component.selectedIds.set(['r-1', 'r-2', 'r-3']);
    await component.onConfirmBulkCancel();

    // r-3 is completed and cannot be cancelled.
    expect(service.cancelRun).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedIds()).toEqual(['r-2']);
  });
});
