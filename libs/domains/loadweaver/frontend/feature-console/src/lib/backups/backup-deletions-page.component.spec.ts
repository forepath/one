import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type AccessMe,
  BackupsService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub, testBackupDeletion } from '../testing';
import { LoadweaverBackupDeletionsPageComponent } from './backup-deletions-page.component';

describe('LoadweaverBackupDeletionsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupDeletionsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe, actionError: string | null = null) {
    facade = facadeStub(
      {
        deletions$: [
          testBackupDeletion(),
          testBackupDeletion({ id: 'd2', state: 'approved', approvedBy: 'u3', approvedAt: '2026-10-02T10:00:00.000Z' }),
          testBackupDeletion({ id: 'd3', state: 'executed', executedAt: '2026-10-05T10:00:00.000Z' }),
        ],
        deletionsLoading$: false,
        deletionsError$: null,
        deletionActing$: null,
        deletionActionError$: actionError,
        volumes$: [],
      },
      ['loadDeletions', 'actOnDeletion', 'clearDeletionActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupDeletionsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        { provide: BackupsService, useValue: { actOnDeletion: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupDeletionsPageComponent);
    fixture.detectChanges();
  }

  const q = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  const states = (testId: string) =>
    [...(q(testId)?.querySelectorAll('[data-testid="fpc-data-table-state"]') ?? [])].map((s) =>
      s.getAttribute('aria-label'),
    );

  it('lists open requests and history as tables (tabs) with requester, approver and earliest execution', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    expect(facade['loadDeletions']).toHaveBeenCalled();

    const open = q('deletions-open')?.textContent ?? '';

    expect(states('deletions-open')).toEqual(['Waiting for a second admin', 'Approved, waiting for the delay']);
    expect(open).toContain('u1');
    expect(open).toContain('u3');
    expect(open).toContain('Takes effect at the earliest');
    expect(open).toContain('1 backups');
    // No raw backup ids (D11): the row detail names them.
    expect(open).not.toContain('6f0c1b0e');
    fixture.componentInstance.toggle(fixture.componentInstance.open()[0]);
    fixture.detectChanges();
    expect(q('deletions-backups')?.textContent).toContain('Backup 1');
    expect(q('deletions-backups')?.textContent).not.toContain('6f0c1b0e');

    fixture.componentInstance.lane.set('history');
    fixture.detectChanges();
    expect(states('deletions-history')).toEqual(['Deleted']);
  });

  it('lets a second admin approve after a confirmation', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;
    const [d1, d2] = component.open();

    expect(component.menu(d1).map((i) => i.id)).toEqual(['cancel', 'approve', 'copy-id']);
    component.onRowAction(d1, 'approve');
    expect(component.confirm()).toMatchObject({ action: 'approve' });
    component.confirmed();
    expect(facade['actOnDeletion']).toHaveBeenCalledWith('d1', 'approve');
    // An approved request can only be cancelled.
    expect(component.menu(d2).map((i) => i.id)).toEqual(['cancel', 'copy-id']);
  });

  it("doesn't offer the requester their own approval, but cancelling", async () => {
    await setup({ userId: 'u1', clusterRole: null, projects: { shop: 'admin' } });

    expect(fixture.componentInstance.menu(fixture.componentInstance.open()[0]).map((i) => i.id)).toEqual([
      'cancel',
      'copy-id',
    ]);
    expect(q('deletions-open')?.textContent).toContain('Another admin approves');
    fixture.componentInstance.ask(fixture.componentInstance.open()[0], 'cancel');
    fixture.componentInstance.confirmed();
    expect(facade['actOnDeletion']).toHaveBeenCalledWith('d1', 'cancel');
  });

  it('bulk Cancel: one call per request after a confirmation, per-request results', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;
    const act = (TestBed.inject(BackupsService).actOnDeletion as jest.Mock)
      .mockImplementationOnce(() => of(testBackupDeletion({ state: 'cancelled' })))
      .mockImplementationOnce(() => throwError(() => ({ status: 403 })));

    component.selected.set(['d1', 'd2']);
    expect(component.canCancelSelection()).toBe(true);
    expect(component.canApproveSelection()).toBe(false); // d2 is approved already
    component.bulkConfirm.set('cancel');
    await component.runBulk();
    expect(act).toHaveBeenCalledWith('d1', 'cancel');
    expect(act).toHaveBeenCalledWith('d2', 'cancel');
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.selected()).toEqual([]);
  });

  it('shows no actions to non-admins and the API’s refusal', async () => {
    await setup({ userId: 'u4', clusterRole: null, projects: { shop: 'operator' } }, 'a second admin must approve');

    expect(fixture.componentInstance.menu(fixture.componentInstance.open()[0]).map((i) => i.id)).toEqual(['copy-id']);
    expect(q('deletions-action-error')?.textContent).toContain('a second admin must approve');
  });
});
