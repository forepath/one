jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AccessManagementService,
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type ProjectAccess,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { ACCESS_EXPORT_FILE_NAME, LoadweaverAccessPageComponent } from './access-page.component';

const uuid = '3f2a1b4c-0000-4000-8000-000000000001';
const gone = '3f2a1b4c-0000-4000-8000-0000000000ff';

const projectAccess: ProjectAccess = {
  project: 'shop',
  members: [
    { project: 'shop', userId: 'bob', role: 'developer', createdBy: 'u1', createdAt: '2026-10-01T10:00:00.000Z' },
  ],
  settings: {
    project: 'shop',
    approvalMode: 'developers',
    developerExec: false,
    recordTerminals: false,
    createdBy: 'u1',
  },
  requests: [
    { project: 'web', policy: 'allow-shop', peer: 'shop', specHash: 'a'.repeat(64), planId: 'p1', accepted: false },
  ],
};

let api: { removeMember: jest.Mock; removeClusterMember: jest.Mock; accept: jest.Mock };

describe('LoadweaverAccessPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverAccessPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe, scope: Record<string, string> | null = null) {
    api = {
      removeMember: jest
        .fn()
        .mockImplementationOnce(() => of(undefined))
        .mockImplementationOnce(() => throwError(() => ({ status: 403, error: { message: 'Not allowed' } }))),
      removeClusterMember: jest.fn(() => of(undefined)),
      accept: jest.fn(() => of(undefined)),
    };
    facade = facadeStub(
      {
        projects$: ['shop', 'web'],
        clusterMembers$: [{ userId: uuid, role: 'auditor', createdBy: null, createdAt: '2026-10-01T10:00:00.000Z' }],
        clusterMembersLoading$: false,
        clusterMembersError$: null,
        projectAccess$: projectAccess,
        projectMembers$: projectAccess.members,
        requests$: projectAccess.requests,
        openRequestCount$: 1,
        projectLoading$: false,
        projectError$: null,
        changing$: false,
        changeError$: null,
        exporting$: false,
        exported$: null,
        exportError$: null,
        importing$: false,
        importResult$: null,
        importError$: null,
      },
      [
        'loadProjects',
        'loadClusterMembers',
        'openProject',
        'setClusterMember',
        'removeClusterMember',
        'setProjectMember',
        'removeProjectMember',
        'updateSettings',
        'accept',
        'clearChangeError',
        'exportAccess',
        'clearExport',
        'importAccess',
        'clearImport',
      ],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverAccessPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleAccessManagementFacade, useValue: facade },
        { provide: AccessManagementService, useValue: api },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: () => scope } }] : []),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverAccessPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lets cluster admins manage cluster members after confirmation', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    expect(facade['loadProjects']).toHaveBeenCalled();
    expect(facade['loadClusterMembers']).toHaveBeenCalled();
    expect(facade['openProject']).toHaveBeenCalledWith('shop');
    expect(el().querySelector('[data-testid="access-cluster-members"]')?.textContent).toContain('Auditor');
    // Export / import lives in a modal opened from the cluster lane header (3.38).
    expect(el().querySelector('[data-testid="access-transfer-open"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="access-requests-lane"]')).not.toBeNull();

    component.clusterUserId = 'not-a-uuid';
    component.saveClusterMember();
    expect(component.clusterInvalid()).toBe(true);
    expect(component.pending()).toBeNull();

    component.clusterUserId = uuid;
    component.clusterRole = 'infra-operator';
    component.saveClusterMember();
    expect(component.pending()?.title).toContain('cluster role');
    expect(facade['setClusterMember']).not.toHaveBeenCalled();

    component.confirmPending();
    expect(facade['setClusterMember']).toHaveBeenCalledWith(uuid, 'infra-operator');
    expect(component.pending()).toBeNull();

    component.removeClusterMember({ userId: uuid, role: 'auditor', createdBy: null, createdAt: '' });
    component.onConfirmOpenChange(false);
    expect(facade['removeClusterMember']).not.toHaveBeenCalled();
  });

  it('shows members and who granted them by email ("Deleted user" when gone), never the raw id (D11)', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} });
    (facade['clusterMembers$'] as BehaviorSubject<unknown>).next([
      {
        userId: uuid,
        userEmail: 'carol@example.com',
        role: 'auditor',
        createdBy: gone,
        createdByEmail: null,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const cluster = el().querySelector('[data-testid="access-cluster-members"]')?.textContent ?? '';

    expect(cluster).toContain('carol@example.com');
    expect(cluster).not.toContain(uuid);
    expect(component.clusterColumns.find((c) => c.id === 'by')?.value?.(component.clusterMembers()[0])).toBe(
      'Deleted user',
    );
    component.removeClusterMember(component.clusterMembers()[0]);
    expect(component.pending()?.message).toContain('carol@example.com');
    expect(component.pending()?.message).not.toContain(uuid);
    component.clusterSearch.set('carol@');
    expect(component.filteredClusterMembers()).toHaveLength(1);
  });

  it('puts member actions into ⋮ and searches the member tables', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    expect(component.clusterMenu().map((item) => item.id)).toEqual(['edit', 'remove', 'copy-id']);
    expect(component.memberMenu(projectAccess.members[0]).map((item) => item.id)).toEqual([
      'edit',
      'remove',
      'copy-id',
    ]);
    expect(el().querySelector('[data-testid="access-cluster-lane"] fpc-lane-header fpc-badge')).toBeNull();
    expect(el().textContent).toContain('Members of shop');
    expect(component.filteredMembers()).toHaveLength(1);

    component.clusterSearch.set('BOB');
    component.memberSearch.set('BOB');
    fixture.detectChanges();
    expect(component.filteredMembers().map((m) => m.userId)).toEqual(['bob']);
    expect(
      el().querySelector('[data-testid="access-cluster-members"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
    expect(el().querySelector('[data-testid="access-members"]')?.textContent).toContain('bob');
  });

  it('shows project members, settings and requests read-only to viewers', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'viewer' } });

    expect(facade['loadClusterMembers']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="access-cluster-members"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-members"]')?.textContent).toContain('bob');
    expect(el().querySelector('[data-testid="access-member-form"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-requests"]')?.textContent).toContain('allow-shop');
    expect(el().querySelector('[data-testid="access-accept-web-allow-shop"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-transfer-open"]')).toBeNull();
    expect(el().textContent).toContain('Project admins change these settings.');
  });

  it('lets project admins manage members (not admins), settings and requests', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;

    // Not the project's creator: no admin role to grant.
    expect(component.grantableRoles()).toEqual(['viewer', 'developer', 'operator']);

    // LW-20: the project picker is a live header select (no Filters strip above the lanes); the settings lane edits
    // through a quiet button and stacks label over value.
    expect(el().querySelector('fpc-page-header [data-testid="access-project"]')).not.toBeNull();
    expect(el().querySelector('.fpc-page > fpc-list-toolbar')).toBeNull();
    expect(el().querySelector('[data-testid="access-settings-edit"] button')?.classList).toContain('btn-dark');
    expect(el().querySelector('[data-testid="access-settings-summary"]')?.classList).toContain('lw-access__settings');

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.selectProject('web');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { project: 'web' } }));
    navigate.mockRestore();

    component.memberUserId = 'carol';
    component.memberRole = 'operator';
    component.saveMember();
    component.confirmPending();
    expect(facade['setProjectMember']).toHaveBeenCalledWith('shop', 'carol', 'operator');

    component.openSettings();
    expect(component.settingsOpen()).toBe(true);
    component.recordTerminals.set(true);
    expect(component.settingsDirty()).toBe(true);
    component.saveSettings();
    expect(component.settingsOpen()).toBe(false);
    component.confirmPending();
    expect(facade['updateSettings']).toHaveBeenCalledWith('shop', { recordTerminals: true });

    component.acceptRequest(projectAccess.requests[0]);
    component.confirmPending();
    expect(facade['accept']).toHaveBeenCalledWith('shop', projectAccess.requests[0]);

    component.removeMember(projectAccess.members[0]);
    component.confirmPending();
    expect(facade['removeProjectMember']).toHaveBeenCalledWith('shop', 'bob');
  });

  it('removes the selected project members one by one and reports each result (one denied)', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;

    (facade['projectMembers$'] as BehaviorSubject<unknown>).next([
      ...projectAccess.members,
      { project: 'shop', userId: 'dave', role: 'viewer', createdBy: 'u1', createdAt: '2026-10-01T10:00:00.000Z' },
    ]);
    component.selectedMembers.set(['bob', 'dave']);
    expect(component.canRemoveMembers()).toBe(true);
    component.confirmBulk.set('members');
    await component.removeSelected();

    expect(api.removeMember).toHaveBeenCalledWith('shop', 'bob');
    expect(api.removeMember).toHaveBeenCalledWith('shop', 'dave');
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('dave');
    expect(component.selectedMembers()).toEqual([]);
  });

  it('downloads the export, loads it into the editor and imports after confirmation', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;
    const createObjectURL = jest.fn().mockReturnValue('blob:x');
    const revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    Object.assign(URL, { createObjectURL, revokeObjectURL });

    component.exportAccess('download');
    expect(facade['exportAccess']).toHaveBeenCalledWith('download');

    (facade['exported$'] as BehaviorSubject<unknown>).next({ yaml: 'projects: []\n', target: 'download' });
    fixture.detectChanges();
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(facade['clearExport']).toHaveBeenCalledTimes(1);
    expect(ACCESS_EXPORT_FILE_NAME).toBe('loadweaver-access.yaml');

    (facade['exported$'] as BehaviorSubject<unknown>).next({ yaml: 'clusterMembers: []\n', target: 'editor' });
    fixture.detectChanges();
    expect(component.editorValue()).toBe('clusterMembers: []\n');

    component.importAccess();
    expect(facade['importAccess']).not.toHaveBeenCalled();
    component.confirmPending();
    expect(facade['importAccess']).toHaveBeenCalledWith('clusterMembers: []\n');

    click.mockRestore();
  });

  it('embedded in a project tab: the scope’s project, only its lanes, no header, picker or URL writes', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} }, { project: 'web' });

    const component = fixture.componentInstance;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    expect(component.project()).toBe('web');
    expect(facade['openProject']).toHaveBeenCalledWith('web');
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="access-project"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-cluster-lane"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-members"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="access-members-refresh"]')).not.toBeNull();

    component.selectProject('shop');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('embedded in the cluster tab: cluster members only', async () => {
    await setup({ userId: 'admin', clusterRole: 'cluster-admin', projects: {} }, {});

    const component = fixture.componentInstance;

    expect(component.project()).toBeNull();
    expect(facade['openProject']).not.toHaveBeenCalled();
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="access-cluster-lane"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="access-cluster-refresh"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="access-members"]')).toBeNull();
    // Weighted like the project lanes (7 / 4 / 5), so it never shrinks to a sliver beside them.
    const column = el().querySelector<HTMLElement>('[data-testid="access-cluster-lane"] fpc-section-column');

    expect(column?.style.flex).toMatch(/^5 1 0/);
  });
});
