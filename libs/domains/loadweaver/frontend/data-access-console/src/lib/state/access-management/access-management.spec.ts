import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { AccessManagementService } from '../../services/access-management.service';
import { ResourcesService } from '../../services/resources.service';
import type { CrossProjectRequest, ProjectAccess, ProjectSettings } from '../../types/access-management.types';
import { initialConsoleAccessState } from '../access/access.reducer';
import {
  acceptCrossProjectRequest,
  accessChangeFailure,
  accessChangeSuccess,
  clearAccessExport,
  exportAccessSuccess,
  importAccess,
  importAccessSuccess,
  loadAccessProjects,
  loadAccessProjectsSuccess,
  loadClusterMembers,
  loadProjectAccess,
  loadProjectAccessFailure,
  loadProjectAccessSuccess,
  removeProjectMember,
  setClusterMember,
  updateProjectSettings,
  updateProjectSettingsSuccess,
} from './access-management.actions';
import {
  acceptCrossProjectRequest$,
  changeClusterMember$,
  changeProjectMember$,
  importAccess$,
  loadAccessProjects$,
  loadProjectAccess$,
  updateProjectSettings$,
} from './access-management.effects';
import { consoleAccessManagementReducer, initialConsoleAccessManagementState } from './access-management.reducer';
import {
  selectCrossProjectRequests,
  selectOpenCrossProjectRequestCount,
  selectProjectMembers,
} from './access-management.selectors';

const settings: ProjectSettings = {
  project: 'shop',
  approvalMode: 'developers',
  developerExec: false,
  recordTerminals: false,
  createdBy: 'u1',
};

const request = (overrides: Partial<CrossProjectRequest> = {}): CrossProjectRequest => ({
  project: 'web',
  policy: 'allow-shop',
  peer: 'shop',
  specHash: 'a'.repeat(64),
  planId: null,
  accepted: false,
  ...overrides,
});

const access: ProjectAccess = {
  project: 'shop',
  members: [
    { project: 'shop', userId: 'zoe', role: 'viewer', createdBy: null, createdAt: '2026-10-01T10:00:00.000Z' },
    { project: 'shop', userId: 'bob', role: 'admin', createdBy: null, createdAt: '2026-10-01T10:00:00.000Z' },
  ],
  settings,
  requests: [request({ policy: 'z', accepted: true }), request()],
};

describe('console access management state', () => {
  it('keeps the shown project and ignores late answers for another one', () => {
    const opened = consoleAccessManagementReducer(
      initialConsoleAccessManagementState,
      loadProjectAccess({ project: 'shop' }),
    );
    const loaded = consoleAccessManagementReducer(opened, loadProjectAccessSuccess({ access }));
    const other = consoleAccessManagementReducer(loaded, loadProjectAccess({ project: 'web' }));

    expect(opened).toMatchObject({ project: 'shop', projectLoading: true });
    expect(loaded.projectAccess?.members).toHaveLength(2);
    expect(other.projectAccess).toBeNull();
    expect(consoleAccessManagementReducer(other, loadProjectAccessSuccess({ access }))).toBe(other);
    expect(
      consoleAccessManagementReducer(other, loadProjectAccessFailure({ project: 'web', error: 'denied' })),
    ).toMatchObject({ projectLoading: false, projectError: 'denied' });
  });

  it('tracks changes, settings and the export', () => {
    const loaded = consoleAccessManagementReducer(
      consoleAccessManagementReducer(initialConsoleAccessManagementState, loadProjectAccess({ project: 'shop' })),
      loadProjectAccessSuccess({ access }),
    );
    const changing = consoleAccessManagementReducer(
      loaded,
      updateProjectSettings({ project: 'shop', patch: { developerExec: true } }),
    );
    const saved = consoleAccessManagementReducer(
      changing,
      updateProjectSettingsSuccess({ settings: { ...settings, developerExec: true } }),
    );

    expect(changing.changing).toBe(true);
    expect(saved).toMatchObject({ changing: false, projectAccess: { settings: { developerExec: true } } });
    expect(consoleAccessManagementReducer(changing, accessChangeFailure({ error: 'no' }))).toMatchObject({
      changing: false,
      changeError: 'no',
    });
    expect(consoleAccessManagementReducer(changing, accessChangeSuccess()).changing).toBe(false);

    const exported = consoleAccessManagementReducer(loaded, exportAccessSuccess({ yaml: 'a: 1', target: 'download' }));

    expect(exported.exported).toEqual({ yaml: 'a: 1', target: 'download' });
    expect(consoleAccessManagementReducer(exported, clearAccessExport()).exported).toBeNull();
  });

  it('orders members by role and requests open first', () => {
    const state = {
      consoleAccessManagement: { ...initialConsoleAccessManagementState, project: 'shop', projectAccess: access },
    };

    expect(selectProjectMembers(state).map((m) => m.userId)).toEqual(['bob', 'zoe']);
    expect(selectCrossProjectRequests(state).map((r) => r.accepted)).toEqual([false, true]);
    expect(selectOpenCrossProjectRequestCount(state)).toBe(1);
  });

  it('lists own projects plus every project for cluster roles', async () => {
    const resources = {
      list: jest.fn().mockReturnValue(of([{ metadata: { name: 'web' } }, { metadata: { name: 'shop' } }])),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadAccessProjects())),
        provideMockStore({
          initialState: {
            consoleAccess: {
              ...initialConsoleAccessState,
              me: { userId: 'u', clusterRole: 'auditor', projects: { shop: 'viewer' } },
            },
          },
        }),
      ],
    });

    expect(
      await firstValueFrom(
        loadAccessProjects$(TestBed.inject(Actions), TestBed.inject(Store), resources as unknown as ResourcesService),
      ),
    ).toEqual(loadAccessProjectsSuccess({ projects: ['shop', 'web'] }));
    expect(resources.list).toHaveBeenCalledWith('Project');
  });

  it('loads a project’s members, settings and requests together', async () => {
    const service = {
      members: jest.fn().mockReturnValue(of(access.members)),
      settings: jest.fn().mockReturnValue(of(settings)),
      requests: jest
        .fn()
        .mockReturnValueOnce(of(access.requests))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'forbidden' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadProjectAccess({ project: 'shop' }), loadProjectAccess({ project: 'x' }))),
      ],
    });

    const result = await firstValueFrom(
      loadProjectAccess$(TestBed.inject(Actions), service as unknown as AccessManagementService).pipe(toArray()),
    );

    expect(result).toEqual([
      loadProjectAccessSuccess({ access }),
      loadProjectAccessFailure({ project: 'x', error: 'forbidden' }),
    ]);
  });

  it('changes memberships and reloads what changed', async () => {
    const service = {
      setClusterMember: jest.fn().mockReturnValue(of(undefined)),
      removeMember: jest
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'admins only' } }))),
      accept: jest.fn().mockReturnValue(of(undefined)),
      updateSettings: jest.fn().mockReturnValue(of(settings)),
    };
    const uuid = '3f2a1b4c-0000-4000-8000-000000000001';

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            setClusterMember({ userId: uuid, role: 'auditor' }),
            removeProjectMember({ project: 'shop', userId: 'bob' }),
            acceptCrossProjectRequest({ project: 'shop', request: request() }),
            updateProjectSettings({ project: 'shop', patch: { approvalMode: 'everyone' } }),
          ),
        ),
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as AccessManagementService;

    expect(await firstValueFrom(changeClusterMember$(actions, api).pipe(toArray()))).toEqual([
      accessChangeSuccess(),
      loadClusterMembers(),
    ]);
    expect(service.setClusterMember).toHaveBeenCalledWith(uuid, 'auditor');
    expect(await firstValueFrom(changeProjectMember$(actions, api).pipe(toArray()))).toEqual([
      accessChangeFailure({ error: 'admins only' }),
    ]);
    expect(await firstValueFrom(acceptCrossProjectRequest$(actions, api).pipe(toArray()))).toEqual([
      accessChangeSuccess(),
      loadProjectAccess({ project: 'shop', silent: true }),
    ]);
    expect(service.accept).toHaveBeenCalledWith('shop', request());
    expect(await firstValueFrom(updateProjectSettings$(actions, api).pipe(toArray()))).toEqual([
      updateProjectSettingsSuccess({ settings }),
    ]);
  });

  it('imports and reloads cluster members and the project shown', async () => {
    const service = { importAccess: jest.fn().mockReturnValue(of({ changed: 3 })) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(importAccess({ yaml: 'projects: []' }))),
        provideMockStore({
          initialState: { consoleAccessManagement: { ...initialConsoleAccessManagementState, project: 'shop' } },
        }),
      ],
    });

    expect(
      await firstValueFrom(
        importAccess$(
          TestBed.inject(Actions),
          service as unknown as AccessManagementService,
          TestBed.inject(Store),
        ).pipe(toArray()),
      ),
    ).toEqual([
      importAccessSuccess({ result: { changed: 3 } }),
      loadClusterMembers(),
      loadProjectAccess({ project: 'shop', silent: true }),
    ]);
  });
});
