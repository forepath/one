import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleEndpointService,
  PlansService,
  SecretsService,
  type SecretSummary,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverSecretAdminPageComponent } from './secret-admin-page.component';

const VALUE = 'pa55w0rd-never-kept';

const summary = (patch: Partial<SecretSummary> = {}): SecretSummary => ({
  project: 'shop',
  name: 'db-password',
  version: 2,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-29T00:00:00Z',
  updatedBy: 'alice@example.test',
  reserved: false,
  usedBy: [{ kind: 'Deployment', project: 'shop', name: 'api', pinnedVersion: 2 }],
  ...patch,
});

describe('LoadweaverSecretAdminPageComponent (3.40)', () => {
  let fixture: ComponentFixture<LoadweaverSecretAdminPageComponent>;
  let service: Record<'list' | 'listAll' | 'setValue' | 'delete', jest.Mock>;
  let plans: { create: jest.Mock };

  async function setup(
    me: AccessMe,
    options: { project?: string; fleet?: boolean; rows?: SecretSummary[] } = {},
  ): Promise<LoadweaverSecretAdminPageComponent> {
    const rows = options.rows ?? [summary()];

    service = {
      list: jest.fn(() => of(rows)),
      listAll: jest.fn(() => of(rows)),
      setValue: jest.fn(() => of(summary({ version: 3 }))),
      delete: jest.fn(() => of(undefined)),
    };
    plans = { create: jest.fn(() => of({ id: 'plan-1' })) };

    await TestBed.configureTestingModule({
      imports: [LoadweaverSecretAdminPageComponent],
      providers: [
        provideRouter([]),
        { provide: SecretsService, useValue: service },
        { provide: PlansService, useValue: plans },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        {
          provide: ConsoleAccessManagementFacade,
          useValue: facadeStub({ projects$: ['shop', 'blog'] }, ['loadProjects']),
        },
        {
          provide: ConsoleEndpointService,
          useValue: {
            fleetMode: !!options.fleet,
            nativeConsoleUrl: (path: string) => `https://cluster.example${path}`,
          },
        },
        ...(options.project
          ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal({ project: options.project }) } }]
          : []),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverSecretAdminPageComponent);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const operator: AccessMe = { userId: 'u', clusterRole: null, projects: { shop: 'operator' } };

  it('lists the project’s secrets in the project tab (no project column)', async () => {
    const page = await setup(operator, { project: 'shop' });

    expect(service.list).toHaveBeenCalledWith('shop');
    expect(service.listAll).not.toHaveBeenCalled();
    expect(page.columns().map((c) => c.id)).not.toContain('project');
    expect(el().querySelector('[data-testid="secrets-table"]')?.textContent).toContain('db-password');
  });

  it('lists every manageable secret on the cluster-wide page, with the project column', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    expect(service.listAll).toHaveBeenCalled();
    expect(page.columns().map((c) => c.id)).toContain('project');
    expect(page.writableProjects()).toEqual(['blog', 'shop']);
  });

  it('shows nothing to developers and viewers', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } }, { project: 'shop' });

    expect(service.list).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="secrets-not-allowed"]')).not.toBeNull();
  });

  it('in fleet mode needs a cluster that verifies the fleet (secrets only as the signed person)', async () => {
    await setup({ ...operator, fleetIdentity: false }, { project: 'shop', fleet: true });

    expect(service.list).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="secrets-fleet-hint"]')?.textContent).toContain("cluster's console");
  });

  it('works through the fleet like natively once the cluster verifies the fleet', async () => {
    await setup({ ...operator, fleetIdentity: true }, { project: 'shop', fleet: true });

    expect(service.list).toHaveBeenCalledWith('shop');
  });

  it('sends the value once, clears it, and offers Roll out for resources on an older version', async () => {
    const page = await setup(operator, { project: 'shop' });

    page.openRotate(summary());
    page.value = VALUE;
    await page.save();

    expect(service.setValue).toHaveBeenCalledWith('shop', 'db-password', VALUE);
    expect(page.value).toBe('');
    expect(page.dialog()).toBeNull();
    expect(page.saved()?.stale.map((u) => u.name)).toEqual(['api']);
    expect(JSON.stringify(page.saved())).not.toContain(VALUE);

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await page.rollOut(page.saved()?.stale ?? []);
    expect(plans.create).toHaveBeenCalledWith({ refresh: [{ kind: 'Deployment', name: 'api', project: 'shop' }] });
    expect(navigate).toHaveBeenCalledWith(['/activity/plans', 'plan-1']);
  });

  it('clears the value when the dialog closes without saving, and on a failed save', async () => {
    const page = await setup(operator, { project: 'shop' });

    page.openCreate();
    page.value = VALUE;
    page.onDialogOpenChange(false);
    expect(page.value).toBe('');

    service.setValue.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 403, error: { message: 'project operator or admin role required' } }),
      ),
    );
    page.openCreate();
    page.patchDialog({ name: 'api-token' });
    page.value = VALUE;
    await page.save();
    expect(page.value).toBe('');
    expect(page.dialogError()).toContain('project operator or admin role required');
  });

  it('refuses invalid and reserved names before asking the cluster', async () => {
    const page = await setup(operator, { project: 'shop' });

    for (const name of ['lw-volume-key', '../x']) {
      page.openCreate();
      page.patchDialog({ name });
      page.value = VALUE;
      await page.save();
      expect(page.invalidName()).toBe(true);
    }
    expect(service.setValue).not.toHaveBeenCalled();
  });

  it('disables Delete while referenced and shows the referencing resources of a 409', async () => {
    const page = await setup(operator, { project: 'shop' });
    const used = summary();
    const unused = summary({ name: 'old', usedBy: [] });

    expect(page.rowMenu(used).find((i) => i.id === 'delete')?.disabled).toBe(true);
    expect(page.rowMenu(unused).find((i) => i.id === 'delete')?.disabled).toBe(false);
    expect(
      page.rowMenu(summary({ name: 'lw-x', reserved: true, usedBy: [] })).find((i) => i.id === 'set')?.disabled,
    ).toBe(true);

    service.delete.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'secret is in use; remove the references first', usedBy: used.usedBy },
          }),
      ),
    );
    page.onRowAction(unused, 'delete');
    await page.confirmDelete();

    expect(service.delete).toHaveBeenCalledWith('shop', 'old');
    expect(page.deleteError()?.usedBy).toEqual(used.usedBy);
  });
});
