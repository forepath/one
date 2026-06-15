import {
  clearGitDiff,
  commit,
  commitSuccess,
  createBranch,
  deleteBranch,
  fetch,
  loadGitBranches,
  loadGitBranchesSuccess,
  loadGitDiff,
  loadGitDiffSuccess,
  loadGitStatus,
  loadGitStatusFailure,
  loadGitStatusSuccess,
  pull,
  push,
  pushSuccess,
  rebase,
  resolveConflict,
  stageFiles,
  stageFilesSuccess,
  switchBranch,
} from './vcs.actions';
import { initialVcsState, vcsReducer, type VcsState } from './vcs.reducer';
import type { GitBranch, GitDiff, GitStatus } from './vcs.types';

describe('vcsReducer', () => {
  const mockGitStatus: GitStatus = {
    currentBranch: 'main',
    isClean: false,
    hasUnpushedCommits: true,
    aheadCount: 2,
    behindCount: 0,
    files: [
      {
        path: 'file1.txt',
        status: 'M',
        type: 'unstaged',
      },
    ],
  };
  const mockBranches: GitBranch[] = [
    {
      name: 'main',
      ref: 'refs/heads/main',
      isCurrent: true,
      isRemote: false,
      commit: 'abc123',
      message: 'Test commit',
    },
  ];
  const mockGitDiff: GitDiff = {
    path: 'file1.txt',
    originalContent: Buffer.from('Old content', 'utf-8').toString('base64'),
    modifiedContent: Buffer.from('New content', 'utf-8').toString('base64'),
    encoding: 'utf-8',
    isBinary: false,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = vcsReducer(undefined, action as any);

      expect(state).toEqual(initialVcsState);
    });
  });

  describe('loadGitStatus', () => {
    it('should set loadingStatus to true and clear error', () => {
      const state: VcsState = {
        ...initialVcsState,
        error: 'Previous error',
      };
      const newState = vcsReducer(state, loadGitStatus({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(newState.loadingStatus).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadGitStatusSuccess', () => {
    it('should store status and set loadingStatus to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        loadingStatus: true,
      };
      const newState = vcsReducer(state, loadGitStatusSuccess({ status: mockGitStatus }));

      expect(newState.status).toEqual(mockGitStatus);
      expect(newState.loadingStatus).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadGitStatusFailure', () => {
    it('should set error and set loadingStatus to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        loadingStatus: true,
      };
      const newState = vcsReducer(state, loadGitStatusFailure({ error: 'Failed to load status' }));

      expect(newState.loadingStatus).toBe(false);
      expect(newState.error).toBe('Failed to load status');
    });
  });

  describe('loadGitBranches', () => {
    it('should set loadingBranches to true', () => {
      const newState = vcsReducer(initialVcsState, loadGitBranches({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(newState.loadingBranches).toBe(true);
    });
  });

  describe('loadGitBranchesSuccess', () => {
    it('should store branches and set loadingBranches to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        loadingBranches: true,
      };
      const newState = vcsReducer(state, loadGitBranchesSuccess({ branches: mockBranches }));

      expect(newState.branches).toEqual(mockBranches);
      expect(newState.loadingBranches).toBe(false);
    });
  });

  describe('loadGitDiff', () => {
    it('should set loadingDiff to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        loadGitDiff({ clientId: 'client-1', agentId: 'agent-1', filePath: 'file1.txt' }),
      );

      expect(newState.loadingDiff).toBe(true);
    });
  });

  describe('loadGitDiffSuccess', () => {
    it('should store diff and set loadingDiff to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        loadingDiff: true,
      };
      const newState = vcsReducer(state, loadGitDiffSuccess({ diff: mockGitDiff }));

      expect(newState.diff).toEqual(mockGitDiff);
      expect(newState.loadingDiff).toBe(false);
    });
  });

  describe('clearGitDiff', () => {
    it('should clear diff', () => {
      const state: VcsState = {
        ...initialVcsState,
        diff: mockGitDiff,
      };
      const newState = vcsReducer(state, clearGitDiff());

      expect(newState.diff).toBeNull();
    });
  });

  describe('stageFiles', () => {
    it('should set staging to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        stageFiles({ clientId: 'client-1', agentId: 'agent-1', dto: { files: ['file1.txt'] } }),
      );

      expect(newState.staging).toBe(true);
    });
  });

  describe('stageFilesSuccess', () => {
    it('should set staging to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        staging: true,
      };
      const newState = vcsReducer(state, stageFilesSuccess());

      expect(newState.staging).toBe(false);
    });
  });

  describe('commit', () => {
    it('should set committing to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        commit({ clientId: 'client-1', agentId: 'agent-1', dto: { message: 'Test commit' } }),
      );

      expect(newState.committing).toBe(true);
    });
  });

  describe('commitSuccess', () => {
    it('should set committing to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        committing: true,
      };
      const newState = vcsReducer(state, commitSuccess());

      expect(newState.committing).toBe(false);
    });
  });

  describe('push', () => {
    it('should set pushing to true', () => {
      const newState = vcsReducer(initialVcsState, push({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(newState.pushing).toBe(true);
    });
  });

  describe('pushSuccess', () => {
    it('should set pushing to false', () => {
      const state: VcsState = {
        ...initialVcsState,
        pushing: true,
      };
      const newState = vcsReducer(state, pushSuccess());

      expect(newState.pushing).toBe(false);
    });
  });

  describe('pull', () => {
    it('should set pulling to true', () => {
      const newState = vcsReducer(initialVcsState, pull({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(newState.pulling).toBe(true);
    });
  });

  describe('fetch', () => {
    it('should set fetching to true', () => {
      const newState = vcsReducer(initialVcsState, fetch({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(newState.fetching).toBe(true);
    });
  });

  describe('createBranch', () => {
    it('should set creatingBranch to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        createBranch({ clientId: 'client-1', agentId: 'agent-1', dto: { name: 'new-branch' } }),
      );

      expect(newState.creatingBranch).toBe(true);
    });
  });

  describe('switchBranch', () => {
    it('should set switchingBranch to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        switchBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'feature/test' }),
      );

      expect(newState.switchingBranch).toBe(true);
    });
  });

  describe('deleteBranch', () => {
    it('should set deletingBranch to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        deleteBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'old-branch' }),
      );

      expect(newState.deletingBranch).toBe(true);
    });
  });

  describe('rebase', () => {
    it('should set rebasing to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        rebase({ clientId: 'client-1', agentId: 'agent-1', dto: { branch: 'main' } }),
      );

      expect(newState.rebasing).toBe(true);
    });
  });

  describe('resolveConflict', () => {
    it('should set resolvingConflict to true', () => {
      const newState = vcsReducer(
        initialVcsState,
        resolveConflict({
          clientId: 'client-1',
          agentId: 'agent-1',
          dto: { path: 'conflict-file.txt', strategy: 'yours' },
        }),
      );

      expect(newState.resolvingConflict).toBe(true);
    });
  });
});
