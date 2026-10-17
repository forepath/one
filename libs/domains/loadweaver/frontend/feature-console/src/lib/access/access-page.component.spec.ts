jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type ProjectAccess,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { ACCESS_EXPORT_FILE_NAME, LoadweaverAccessPageComponent } from './access-page.component';

const uuid = '3f2a1b4c-0000-4000-8000-000000000001';

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

describe('LoadweaverAccessPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverAccessPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe) {
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
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
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
    expect(el().querySelector('[data-testid="access-transfer"]')).not.toBeNull();

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

  it('shows project members, settings and requests read-only to viewers', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'viewer' } });

    expect(facade['loadClusterMembers']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="access-cluster-members"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-members"]')?.textContent).toContain('bob');
    expect(el().querySelector('[data-testid="access-member-form"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-requests"]')?.textContent).toContain('allow-shop');
    expect(el().querySelector('[data-testid="access-accept-web-allow-shop"]')).toBeNull();
    expect(el().querySelector('[data-testid="access-transfer"]')).toBeNull();
    expect(el().textContent).toContain('Project admins change these settings.');
  });

  it('lets project admins manage members (not admins), settings and requests', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;

    // Not the project's creator: no admin role to grant.
    expect(component.grantableRoles()).toEqual(['viewer', 'developer', 'operator']);

    component.memberUserId = 'carol';
    component.memberRole = 'operator';
    component.saveMember();
    component.confirmPending();
    expect(facade['setProjectMember']).toHaveBeenCalledWith('shop', 'carol', 'operator');

    component.recordTerminals.set(true);
    expect(component.settingsDirty()).toBe(true);
    component.saveSettings();
    component.confirmPending();
    expect(facade['updateSettings']).toHaveBeenCalledWith('shop', { recordTerminals: true });

    component.acceptRequest(projectAccess.requests[0]);
    component.confirmPending();
    expect(facade['accept']).toHaveBeenCalledWith('shop', projectAccess.requests[0]);

    component.removeMember(projectAccess.members[0]);
    component.confirmPending();
    expect(facade['removeProjectMember']).toHaveBeenCalledWith('shop', 'bob');
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
});
