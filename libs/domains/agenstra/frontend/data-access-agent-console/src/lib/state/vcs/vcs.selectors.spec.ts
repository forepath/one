import { initialVcsState, type VcsState } from './vcs.reducer';
import {
  selectCommitting,
  selectCreatingBranch,
  selectCurrentBranch,
  selectDeletingBranch,
  selectFetching,
  selectGitBranches,
  selectGitDiff,
  selectGitStatus,
  selectGitStatusIndicator,
  selectLoadingBranches,
  selectLoadingDiff,
  selectLoadingStatus,
  selectPulling,
  selectPushing,
  selectRebasing,
  selectResolvingConflict,
  selectStaging,
  selectSwitchingBranch,
  selectUnstaging,
  selectVcsError,
  selectVcsState,
} from './vcs.selectors';
import type { GitBranch, GitDiff, GitStatus } from './vcs.types';

describe('Vcs Selectors', () => {
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
    {
      name: 'develop',
      ref: 'refs/heads/develop',
      isCurrent: false,
      isRemote: false,
      commit: 'def456',
      message: 'Develop commit',
    },
  ];
  const mockGitDiff: GitDiff = {
    path: 'file1.txt',
    originalContent: Buffer.from('Old content', 'utf-8').toString('base64'),
    modifiedContent: Buffer.from('New content', 'utf-8').toString('base64'),
    encoding: 'utf-8',
    isBinary: false,
  };
  const createState = (overrides?: Partial<VcsState>): VcsState => ({
    ...initialVcsState,
    ...overrides,
  });

  describe('selectVcsState', () => {
    it('should select the vcs feature state', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectVcsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectGitStatus', () => {
    it('should select git status', () => {
      const state = createState({ status: mockGitStatus });
      const rootState = { vcs: state };
      const result = selectGitStatus(rootState as any);

      expect(result).toEqual(mockGitStatus);
    });

    it('should return null when no status exists', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectGitStatus(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectGitBranches', () => {
    it('should select git branches', () => {
      const state = createState({ branches: mockBranches });
      const rootState = { vcs: state };
      const result = selectGitBranches(rootState as any);

      expect(result).toEqual(mockBranches);
    });
  });

  describe('selectCurrentBranch', () => {
    it('should select current branch from status', () => {
      const state = createState({ status: mockGitStatus });
      const rootState = { vcs: state };
      const result = selectCurrentBranch(rootState as any);

      expect(result).toBe('main');
    });

    it('should return undefined when no status exists', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectCurrentBranch(rootState as any);

      expect(result).toBeUndefined();
    });
  });

  describe('selectGitDiff', () => {
    it('should select git diff', () => {
      const state = createState({ diff: mockGitDiff });
      const rootState = { vcs: state };
      const result = selectGitDiff(rootState as any);

      expect(result).toEqual(mockGitDiff);
    });

    it('should return null when no diff exists', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectGitDiff(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectGitStatusIndicator', () => {
    it('should return "conflict" when files have conflict status', () => {
      const statusWithConflict: GitStatus = {
        ...mockGitStatus,
        files: [
          {
            path: 'file1.txt',
            status: 'UU',
            type: 'both',
          },
        ],
      };
      const state = createState({ status: statusWithConflict });
      const rootState = { vcs: state };
      const result = selectGitStatusIndicator(rootState as any);

      expect(result).toBe('conflict');
    });

    it('should return "changes" when repository has local changes', () => {
      const state = createState({ status: mockGitStatus });
      const rootState = { vcs: state };
      const result = selectGitStatusIndicator(rootState as any);

      expect(result).toBe('changes');
    });

    it('should return "clean" when repository is clean and in sync', () => {
      const cleanStatus: GitStatus = {
        currentBranch: 'main',
        isClean: true,
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      };
      const state = createState({ status: cleanStatus });
      const rootState = { vcs: state };
      const result = selectGitStatusIndicator(rootState as any);

      expect(result).toBe('clean');
    });

    it('should return null when no status exists', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectGitStatusIndicator(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('loading state selectors', () => {
    it('should select loadingStatus', () => {
      const state = createState({ loadingStatus: true });
      const rootState = { vcs: state };
      const result = selectLoadingStatus(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingBranches', () => {
      const state = createState({ loadingBranches: true });
      const rootState = { vcs: state };
      const result = selectLoadingBranches(rootState as any);

      expect(result).toBe(true);
    });

    it('should select loadingDiff', () => {
      const state = createState({ loadingDiff: true });
      const rootState = { vcs: state };
      const result = selectLoadingDiff(rootState as any);

      expect(result).toBe(true);
    });

    it('should select staging', () => {
      const state = createState({ staging: true });
      const rootState = { vcs: state };
      const result = selectStaging(rootState as any);

      expect(result).toBe(true);
    });

    it('should select unstaging', () => {
      const state = createState({ unstaging: true });
      const rootState = { vcs: state };
      const result = selectUnstaging(rootState as any);

      expect(result).toBe(true);
    });

    it('should select committing', () => {
      const state = createState({ committing: true });
      const rootState = { vcs: state };
      const result = selectCommitting(rootState as any);

      expect(result).toBe(true);
    });

    it('should select pushing', () => {
      const state = createState({ pushing: true });
      const rootState = { vcs: state };
      const result = selectPushing(rootState as any);

      expect(result).toBe(true);
    });

    it('should select pulling', () => {
      const state = createState({ pulling: true });
      const rootState = { vcs: state };
      const result = selectPulling(rootState as any);

      expect(result).toBe(true);
    });

    it('should select fetching', () => {
      const state = createState({ fetching: true });
      const rootState = { vcs: state };
      const result = selectFetching(rootState as any);

      expect(result).toBe(true);
    });

    it('should select rebasing', () => {
      const state = createState({ rebasing: true });
      const rootState = { vcs: state };
      const result = selectRebasing(rootState as any);

      expect(result).toBe(true);
    });

    it('should select switchingBranch', () => {
      const state = createState({ switchingBranch: true });
      const rootState = { vcs: state };
      const result = selectSwitchingBranch(rootState as any);

      expect(result).toBe(true);
    });

    it('should select creatingBranch', () => {
      const state = createState({ creatingBranch: true });
      const rootState = { vcs: state };
      const result = selectCreatingBranch(rootState as any);

      expect(result).toBe(true);
    });

    it('should select deletingBranch', () => {
      const state = createState({ deletingBranch: true });
      const rootState = { vcs: state };
      const result = selectDeletingBranch(rootState as any);

      expect(result).toBe(true);
    });

    it('should select resolvingConflict', () => {
      const state = createState({ resolvingConflict: true });
      const rootState = { vcs: state };
      const result = selectResolvingConflict(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectVcsError', () => {
    it('should select error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { vcs: state };
      const result = selectVcsError(rootState as any);

      expect(result).toBe('Test error');
    });

    it('should return null when no error exists', () => {
      const state = createState();
      const rootState = { vcs: state };
      const result = selectVcsError(rootState as any);

      expect(result).toBeNull();
    });
  });
});
