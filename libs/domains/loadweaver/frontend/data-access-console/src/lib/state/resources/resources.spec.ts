import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { PlansService } from '../../services/plans.service';
import { ResourcesService } from '../../services/resources.service';
import type { Plan } from '../../types/plans.types';
import type { ConsoleResource } from '../../types/resources.types';
import {
  loadResource,
  loadResourceFailure,
  loadResourceSchema,
  loadResourceSchemaFailure,
  loadResourceSchemaSuccess,
  loadResourcesSuccess,
  loadResourceSuccess,
  planResourceChange,
  planResourceChangeFailure,
  planResourceChangeSuccess,
} from './resources.actions';
import { loadResource$, loadResourceSchema$, openResourcePlan$, planResourceChange$ } from './resources.effects';
import { consoleResourcesReducer, initialConsoleResourcesState } from './resources.reducer';
import { selectResourceCounts, selectResourceProjects } from './resources.selectors';

function resource(overrides: Partial<ConsoleResource> = {}): ConsoleResource {
  return {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Deployment',
    metadata: { name: 'web', project: 'shop' },
    spec: { compose: 'services: {}' },
    ...overrides,
  };
}

const site = resource({ kind: 'Site', metadata: { name: 'fra1' }, spec: {} });

describe('console resources state', () => {
  it('lists projects and counts per kind', () => {
    const state = consoleResourcesReducer(
      initialConsoleResourcesState,
      loadResourcesSuccess({ resources: [resource(), site, resource({ metadata: { name: 'db', project: 'blog' } })] }),
    );

    expect(selectResourceProjects({ consoleResources: state })).toEqual(['blog', 'shop']);
    expect(selectResourceCounts({ consoleResources: state })).toEqual({ Deployment: 2, Site: 1 });
  });

  it('opens a resource from the list and keeps only the answer for the open one', () => {
    const listed = consoleResourcesReducer(initialConsoleResourcesState, loadResourcesSuccess({ resources: [site] }));
    const key = { kind: 'Site', name: 'fra1', project: null };
    const opened = consoleResourcesReducer(listed, loadResource({ key }));

    expect(opened).toMatchObject({ selected: site, selectedLoading: true });
    expect(consoleResourcesReducer(opened, loadResourceSuccess({ resource: resource() })).selected).toBe(site);
    expect(consoleResourcesReducer(opened, loadResourceFailure({ key, error: 'resource not found' }))).toMatchObject({
      selected: null,
      selectedError: 'resource not found',
    });
  });

  it('caches schemas and records planning errors', () => {
    const withSchema = consoleResourcesReducer(
      consoleResourcesReducer(initialConsoleResourcesState, loadResourceSchemaFailure({ kind: 'Site', error: 'x' })),
      loadResourceSchemaSuccess({ kind: 'Policy', schema: { type: 'object' } }),
    );

    expect(withSchema.schemas).toEqual({ Policy: { type: 'object' } });
    expect(consoleResourcesReducer(withSchema, loadResourceSchema({ kind: 'Site' })).schemaErrors).toEqual({});

    const planning = consoleResourcesReducer(withSchema, planResourceChange({ request: { documents: 'x' } }));

    expect(planning.planning).toBe(true);
    expect(consoleResourcesReducer(planning, planResourceChangeFailure({ error: 'invalid' }))).toMatchObject({
      planning: false,
      planError: 'invalid',
    });
  });

  it('reads a resource with its project', async () => {
    const service = { get: jest.fn().mockReturnValue(of(resource())) };
    const key = { kind: 'Deployment', name: 'web', project: 'shop' };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadResource({ key })))] });

    expect(
      await firstValueFrom(loadResource$(TestBed.inject(Actions), service as unknown as ResourcesService)),
    ).toEqual(loadResourceSuccess({ resource: resource() }));
    expect(service.get).toHaveBeenCalledWith(key);
  });

  it('reads each schema once', async () => {
    const service = { schema: jest.fn().mockReturnValue(of({ type: 'object' })) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadResourceSchema({ kind: 'Policy' }), loadResourceSchema({ kind: 'Site' }))),
        provideMockStore({
          initialState: { consoleResources: { ...initialConsoleResourcesState, schemas: { Policy: true } } },
        }),
        { provide: ResourcesService, useValue: service },
      ],
    });

    const actions = await firstValueFrom(TestBed.runInInjectionContext(() => loadResourceSchema$()).pipe(toArray()));

    expect(actions).toEqual([loadResourceSchemaSuccess({ kind: 'Site', schema: { type: 'object' } })]);
    expect(service.schema).toHaveBeenCalledTimes(1);
  });

  it('plans a change and reports the plan issues', async () => {
    const plans = {
      create: jest
        .fn()
        .mockReturnValueOnce(of({ id: 'p1' } as Plan))
        .mockReturnValueOnce(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: { message: 'invalid resources', issues: [{ path: 'spec.from', message: 'Required' }] },
              }),
          ),
        ),
    };
    const request = { documents: 'apiVersion: loadweaver.com/v1', delete: [{ kind: 'Site', name: 'fra1' }] };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(planResourceChange({ request }), planResourceChange({ request })))],
    });

    const actions = await firstValueFrom(
      planResourceChange$(TestBed.inject(Actions), plans as unknown as PlansService).pipe(toArray()),
    );

    expect(actions).toEqual([
      planResourceChangeSuccess({ plan: { id: 'p1' } as Plan }),
      planResourceChangeFailure({ error: 'invalid resources: spec.from: Required' }),
    ]);
    expect(plans.create).toHaveBeenCalledWith(request);
  });

  it('opens the planned change', async () => {
    const router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(planResourceChangeSuccess({ plan: { id: 'p9' } as Plan })))],
    });

    await firstValueFrom(openResourcePlan$(TestBed.inject(Actions), router as unknown as Router));

    expect(router.navigate).toHaveBeenCalledWith(['/activity/plans', 'p9']);
  });
});
