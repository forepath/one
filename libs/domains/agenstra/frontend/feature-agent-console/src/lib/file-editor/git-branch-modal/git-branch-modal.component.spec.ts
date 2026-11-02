import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VcsFacade, VcsService, type GitBranch } from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { GitBranchModalComponent } from './git-branch-modal.component';

function branch(name: string, overrides: Partial<GitBranch> = {}): GitBranch {
  return {
    name,
    ref: `refs/heads/${name}`,
    isCurrent: false,
    isRemote: false,
    commit: 'abc1234def',
    message: '',
    ...overrides,
  };
}

describe('GitBranchModalComponent', () => {
  let fixture: ComponentFixture<GitBranchModalComponent>;
  let facade: Record<string, unknown>;
  let service: { deleteBranch: jest.Mock };

  beforeEach(async () => {
    facade = {
      branches$: new BehaviorSubject([
        branch('main', { isCurrent: true }),
        branch('feat/a', { aheadCount: 2 }),
        branch('feat/b'),
        branch('feat/c', { isRemote: true, remote: 'origin', ref: 'refs/remotes/origin/feat/c' }),
      ]),
      currentBranch$: new BehaviorSubject('main'),
      loadingBranches$: new BehaviorSubject(false),
      creatingBranch$: new BehaviorSubject(false),
      deletingBranch$: new BehaviorSubject(false),
      switchingBranch$: new BehaviorSubject(false),
      loadBranches: jest.fn(),
      loadStatus: jest.fn(),
      switchBranch: jest.fn(),
      createBranch: jest.fn(),
    };
    service = {
      deleteBranch: jest.fn((_c: string, _a: string, name: string) =>
        name === 'feat/b' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(undefined),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [GitBranchModalComponent],
      providers: [
        { provide: VcsFacade, useValue: facade },
        { provide: VcsService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GitBranchModalComponent);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('agentId', 'agent-1');
    fixture.detectChanges();
  });

  it('splits local and remote branches and labels their state', () => {
    const component = fixture.componentInstance;

    expect(component.localBranches().map((b) => b.name)).toEqual(['feat/a', 'feat/b', 'main']);
    expect(component.remoteBranches().map((b) => b.name)).toEqual(['feat/c']);
    expect(component.localColumns[0].state?.(branch('main', { isCurrent: true }))?.label).toBe('Current branch');
    expect(component.localColumns[0].state?.(branch('x', { aheadCount: 1 }))?.label).toBe('Ahead');
  });

  it('deletes the selected local branches (never the current one) and reports per-branch results', async () => {
    const component = fixture.componentInstance;

    component.selectedLocalNames.set(['refs/heads/main', 'refs/heads/feat/a', 'refs/heads/feat/b']);
    await component.onConfirmBulkDelete();

    expect(service.deleteBranch).toHaveBeenCalledTimes(2);
    expect(service.deleteBranch).not.toHaveBeenCalledWith('client-1', 'agent-1', 'main');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedLocalNames()).toEqual(['refs/heads/feat/b']);
  });

  it('quick switch is a typeahead over the loaded branches (never the current one); free text still switches', () => {
    const component = fixture.componentInstance;

    expect(component.quickSwitchOptions().map((o) => o.value)).toEqual(['feat/a', 'feat/b', 'origin/feat/c']);

    component.manualSwitchBranchName.set('hotfix/typed');
    component.onManualSwitchBranch();

    expect(facade['switchBranch']).toHaveBeenCalledWith('client-1', 'agent-1', 'hotfix/typed');
  });
});
