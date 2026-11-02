import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of } from 'rxjs';

import { DriftService } from '../../services/drift.service';
import type { DriftReport } from '../../types/drift.types';
import type { Plan } from '../../types/plans.types';
import {
  loadDrift,
  loadDriftSuccess,
  proposeDriftPlan,
  proposeDriftPlanFailure,
  proposeDriftPlanSuccess,
} from './drift.actions';
import { loadDrift$, openProposedDriftPlan$ } from './drift.effects';
import { consoleDriftReducer, initialConsoleDriftState } from './drift.reducer';
import { selectDriftCount } from './drift.selectors';

const report: DriftReport = {
  containers: [
    {
      node: 'n1',
      id: 'abcdef123456',
      name: 'adminer',
      image: 'adminer:4',
      state: 'running',
      ports: ['0.0.0.0:8080->8080/tcp'],
      reportedAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  inconsistent: [{ planId: 'p1', error: 'n2 failed', fixForward: 'p2' }],
};

describe('console drift state', () => {
  it('counts drift items and tracks proposals', () => {
    const loaded = consoleDriftReducer(initialConsoleDriftState, loadDriftSuccess({ report }));
    const proposing = consoleDriftReducer(
      loaded,
      proposeDriftPlan({ proposal: { node: 'n1', container: 'abcdef123456', project: 'shop', deployment: 'adminer' } }),
    );

    expect(selectDriftCount({ consoleDrift: loaded })).toBe(2);
    expect(proposing.proposing).toBe(true);
    expect(consoleDriftReducer(proposing, proposeDriftPlanFailure({ error: 'nope' }))).toMatchObject({
      proposing: false,
      proposeError: 'nope',
    });
  });

  it('loads the report', async () => {
    const service = { report: jest.fn().mockReturnValue(of(report)) };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadDrift({})))] });

    expect(await firstValueFrom(loadDrift$(TestBed.inject(Actions), service as unknown as DriftService))).toEqual(
      loadDriftSuccess({ report }),
    );
  });

  it('opens the proposed plan', async () => {
    const router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(proposeDriftPlanSuccess({ plan: { id: 'p9' } as Plan })))],
    });

    await firstValueFrom(openProposedDriftPlan$(TestBed.inject(Actions), router as unknown as Router));

    expect(router.navigate).toHaveBeenCalledWith(['/activity/plans', 'p9']);
  });
});
