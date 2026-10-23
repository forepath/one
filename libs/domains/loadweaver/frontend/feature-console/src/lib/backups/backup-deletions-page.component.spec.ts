import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type AccessMe,
} from '@forepath/loadweaver/frontend/data-access-console';

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
      },
      ['loadDeletions', 'actOnDeletion', 'clearDeletionActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupDeletionsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupDeletionsPageComponent);
    fixture.detectChanges();
  }

  const q = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  it('lists open requests and history with requester, approver and earliest execution', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    expect(facade['loadDeletions']).toHaveBeenCalled();

    const open = q('deletions-open')?.textContent ?? '';

    expect(open).toContain('Waiting for a second admin');
    expect(open).toContain('Approved, waiting for the delay');
    expect(open).toContain('u1');
    expect(open).toContain('u3');
    expect(open).toContain('Takes effect at the earliest');
    expect(q('deletions-history')?.textContent).toContain('Deleted');
  });

  it('lets a second admin approve after a confirmation', async () => {
    await setup({ userId: 'u2', clusterRole: null, projects: { shop: 'admin' } });

    (q('deletions-approve-d1')?.querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.confirm()).toMatchObject({ action: 'approve' });
    fixture.componentInstance.confirmed();
    expect(facade['actOnDeletion']).toHaveBeenCalledWith('d1', 'approve');
    // An approved request can only be cancelled.
    expect(q('deletions-approve-d2')).toBeNull();
    expect(q('deletions-cancel-d2')).not.toBeNull();
  });

  it("doesn't offer the requester their own approval, but cancelling", async () => {
    await setup({ userId: 'u1', clusterRole: null, projects: { shop: 'admin' } });

    expect(q('deletions-approve-d1')).toBeNull();
    expect(q('deletions-open')?.textContent).toContain('Another admin approves');
    fixture.componentInstance.ask(fixture.componentInstance.open()[0], 'cancel');
    fixture.componentInstance.confirmed();
    expect(facade['actOnDeletion']).toHaveBeenCalledWith('d1', 'cancel');
  });

  it('shows no actions to non-admins and the API’s refusal', async () => {
    await setup({ userId: 'u4', clusterRole: null, projects: { shop: 'operator' } }, 'a second admin must approve');

    expect(q('deletions-cancel-d1')).toBeNull();
    expect(q('deletions-action-error')?.textContent).toContain('a second admin must approve');
  });
});
