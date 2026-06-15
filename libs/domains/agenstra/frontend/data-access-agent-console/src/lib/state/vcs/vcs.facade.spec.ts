import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import {
  clearGitDiff,
  commit,
  createBranch,
  deleteBranch,
  fetch,
  loadGitBranches,
  loadGitDiff,
  loadGitStatus,
  pull,
  push,
  rebase,
  resolveConflict,
  stageFiles,
  switchBranch,
  unstageFiles,
} from './vcs.actions';
import { VcsFacade } from './vcs.facade';
import type { VcsState } from './vcs.reducer';

describe('VcsFacade', () => {
  let facade: VcsFacade;
  let store: MockStore<{ vcs: VcsState }>;
  const initialState = {
    vcs: {
      status: null,
      branches: [],
      diff: null,
      loadingStatus: false,
      loadingBranches: false,
      loadingDiff: false,
      staging: false,
      unstaging: false,
      committing: false,
      pushing: false,
      pulling: false,
      fetching: false,
      rebasing: false,
      switchingBranch: false,
      creatingBranch: false,
      deletingBranch: false,
      resolvingConflict: false,
      error: null,
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [VcsFacade, provideMockStore({ initialState })],
    });

    facade = TestBed.inject(VcsFacade);
    store = TestBed.inject(MockStore);
  });

  it('should be created', () => {
    expect(facade).toBeTruthy();
  });

  describe('loadStatus', () => {
    it('should dispatch loadGitStatus action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadStatus('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(loadGitStatus({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('loadBranches', () => {
    it('should dispatch loadGitBranches action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadBranches('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(loadGitBranches({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('loadDiff', () => {
    it('should dispatch loadGitDiff action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.loadDiff('client-1', 'agent-1', 'file1.txt');

      expect(spy).toHaveBeenCalledWith(
        loadGitDiff({ clientId: 'client-1', agentId: 'agent-1', filePath: 'file1.txt' }),
      );
    });
  });

  describe('clearDiff', () => {
    it('should dispatch clearGitDiff action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.clearDiff();

      expect(spy).toHaveBeenCalledWith(clearGitDiff());
    });
  });

  describe('stageFiles', () => {
    it('should dispatch stageFiles action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.stageFiles('client-1', 'agent-1', { files: ['file1.txt'] });

      expect(spy).toHaveBeenCalledWith(
        stageFiles({ clientId: 'client-1', agentId: 'agent-1', dto: { files: ['file1.txt'] } }),
      );
    });
  });

  describe('unstageFiles', () => {
    it('should dispatch unstageFiles action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.unstageFiles('client-1', 'agent-1', { files: ['file1.txt'] });

      expect(spy).toHaveBeenCalledWith(
        unstageFiles({ clientId: 'client-1', agentId: 'agent-1', dto: { files: ['file1.txt'] } }),
      );
    });
  });

  describe('commit', () => {
    it('should dispatch commit action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.commit('client-1', 'agent-1', { message: 'Test commit' });

      expect(spy).toHaveBeenCalledWith(
        commit({ clientId: 'client-1', agentId: 'agent-1', dto: { message: 'Test commit' } }),
      );
    });
  });

  describe('push', () => {
    it('should dispatch push action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.push('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(push({ clientId: 'client-1', agentId: 'agent-1', force: undefined }));
    });

    it('should dispatch push action with force option', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.push('client-1', 'agent-1', { force: true });

      expect(spy).toHaveBeenCalledWith(push({ clientId: 'client-1', agentId: 'agent-1', force: true }));
    });
  });

  describe('pull', () => {
    it('should dispatch pull action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.pull('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(pull({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('fetch', () => {
    it('should dispatch fetch action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.fetch('client-1', 'agent-1');

      expect(spy).toHaveBeenCalledWith(fetch({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('rebase', () => {
    it('should dispatch rebase action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.rebase('client-1', 'agent-1', { branch: 'main' });

      expect(spy).toHaveBeenCalledWith(rebase({ clientId: 'client-1', agentId: 'agent-1', dto: { branch: 'main' } }));
    });
  });

  describe('switchBranch', () => {
    it('should dispatch switchBranch action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.switchBranch('client-1', 'agent-1', 'develop');

      expect(spy).toHaveBeenCalledWith(switchBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'develop' }));
    });
  });

  describe('createBranch', () => {
    it('should dispatch createBranch action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.createBranch('client-1', 'agent-1', { name: 'feature-branch' });

      expect(spy).toHaveBeenCalledWith(
        createBranch({ clientId: 'client-1', agentId: 'agent-1', dto: { name: 'feature-branch' } }),
      );
    });
  });

  describe('deleteBranch', () => {
    it('should dispatch deleteBranch action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.deleteBranch('client-1', 'agent-1', 'feature-branch');

      expect(spy).toHaveBeenCalledWith(
        deleteBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'feature-branch' }),
      );
    });
  });

  describe('resolveConflict', () => {
    it('should dispatch resolveConflict action', () => {
      const spy = jest.spyOn(store, 'dispatch');

      facade.resolveConflict('client-1', 'agent-1', { path: 'file1.txt', strategy: 'yours' });

      expect(spy).toHaveBeenCalledWith(
        resolveConflict({ clientId: 'client-1', agentId: 'agent-1', dto: { path: 'file1.txt', strategy: 'yours' } }),
      );
    });
  });
});
