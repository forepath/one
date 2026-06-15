import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of } from 'rxjs';

import { VcsService } from '../../services/vcs.service';

import {
  commit,
  commitSuccess,
  createBranch,
  createBranchSuccess,
  deleteBranch,
  deleteBranchSuccess,
  fetch,
  fetchSuccess,
  loadGitBranches,
  loadGitBranchesSuccess,
  loadGitDiff,
  loadGitDiffSuccess,
  loadGitStatus,
  loadGitStatusFailure,
  loadGitStatusSuccess,
  pull,
  pullSuccess,
  push,
  pushSuccess,
  rebase,
  rebaseSuccess,
  resolveConflict,
  resolveConflictSuccess,
  stageFiles,
  stageFilesSuccess,
  switchBranch,
  switchBranchSuccess,
} from './vcs.actions';
import {
  commit$,
  createBranch$,
  deleteBranch$,
  fetch$,
  loadGitBranches$,
  loadGitDiff$,
  loadGitStatus$,
  pull$,
  push$,
  rebase$,
  resolveConflict$,
  stageFiles$,
  switchBranch$,
  unstageFiles$,
} from './vcs.effects';
import type { GitDiff } from './vcs.types';

describe('VcsEffects', () => {
  let actions$: Actions;
  let effects: {
    loadGitStatus$: ReturnType<typeof loadGitStatus$>;
    loadGitBranches$: ReturnType<typeof loadGitBranches$>;
    loadGitDiff$: ReturnType<typeof loadGitDiff$>;
    stageFiles$: ReturnType<typeof stageFiles$>;
    unstageFiles$: ReturnType<typeof unstageFiles$>;
    commit$: ReturnType<typeof commit$>;
    push$: ReturnType<typeof push$>;
    pull$: ReturnType<typeof pull$>;
    fetch$: ReturnType<typeof fetch$>;
    rebase$: ReturnType<typeof rebase$>;
    switchBranch$: ReturnType<typeof switchBranch$>;
    createBranch$: ReturnType<typeof createBranch$>;
    deleteBranch$: ReturnType<typeof deleteBranch$>;
    resolveConflict$: ReturnType<typeof resolveConflict$>;
  };
  let vcsService: VcsService;
  let httpMock: HttpTestingController;
  const mockEnvironment: Environment = {
    controller: {
      restApiUrl: 'https://api.example.com',
    },
  } as Environment;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideMockActions(() => actions$),
        VcsService,
        {
          provide: ENVIRONMENT,
          useValue: mockEnvironment,
        },
      ],
    });

    vcsService = TestBed.inject(VcsService);
    httpMock = TestBed.inject(HttpTestingController);
    const actions = TestBed.inject(Actions);

    effects = {
      loadGitStatus$: loadGitStatus$(actions, vcsService),
      loadGitBranches$: loadGitBranches$(actions, vcsService),
      loadGitDiff$: loadGitDiff$(actions, vcsService),
      stageFiles$: stageFiles$(actions, vcsService),
      unstageFiles$: unstageFiles$(actions, vcsService),
      commit$: commit$(actions, vcsService),
      push$: push$(actions, vcsService),
      pull$: pull$(actions, vcsService),
      fetch$: fetch$(actions, vcsService),
      rebase$: rebase$(actions, vcsService),
      switchBranch$: switchBranch$(actions, vcsService),
      createBranch$: createBranch$(actions, vcsService),
      deleteBranch$: deleteBranch$(actions, vcsService),
      resolveConflict$: resolveConflict$(actions, vcsService),
    };
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadGitStatus$', () => {
    it('should dispatch success action on successful load', (done) => {
      const mockStatus = {
        currentBranch: 'main',
        isClean: false,
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      };

      actions$ = of(loadGitStatus({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.loadGitStatus$.subscribe((action) => {
        expect(action).toEqual(loadGitStatusSuccess({ status: mockStatus }));
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/status');

      expect(req.request.method).toBe('GET');
      req.flush(mockStatus);
    });

    it('should dispatch failure action on error', (done) => {
      actions$ = of(loadGitStatus({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.loadGitStatus$.subscribe((action) => {
        expect(action).toEqual(loadGitStatusFailure({ error: expect.any(String) }));
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/status');

      req.error(new ErrorEvent('Network error'));
    });
  });

  describe('loadGitBranches$', () => {
    it('should dispatch success action on successful load', (done) => {
      const mockBranches = [
        {
          name: 'main',
          ref: 'refs/heads/main',
          isCurrent: true,
          isRemote: false,
          commit: 'abc123',
          message: 'Test commit',
        },
      ];

      actions$ = of(loadGitBranches({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.loadGitBranches$.subscribe((action) => {
        expect(action).toEqual(loadGitBranchesSuccess({ branches: mockBranches }));
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/branches');

      expect(req.request.method).toBe('GET');
      req.flush(mockBranches);
    });
  });

  describe('loadGitDiff$', () => {
    it('should dispatch success action on successful load', (done) => {
      const mockDiff: GitDiff = {
        path: 'file1.txt',
        originalContent: Buffer.from('Old content', 'utf-8').toString('base64'),
        modifiedContent: Buffer.from('New content', 'utf-8').toString('base64'),
        encoding: 'utf-8' as const,
        isBinary: false,
      };

      actions$ = of(loadGitDiff({ clientId: 'client-1', agentId: 'agent-1', filePath: 'file1.txt' }));

      effects.loadGitDiff$.subscribe((action) => {
        expect(action).toEqual(loadGitDiffSuccess({ diff: mockDiff }));
        done();
      });

      const req = httpMock.expectOne(
        (request) =>
          request.url === 'https://api.example.com/clients/client-1/agents/agent-1/vcs/diff' &&
          request.params.get('path') === 'file1.txt',
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockDiff);
    });
  });

  describe('stageFiles$', () => {
    it('should dispatch success action on successful stage', (done) => {
      actions$ = of(stageFiles({ clientId: 'client-1', agentId: 'agent-1', dto: { files: ['file1.txt'] } }));

      effects.stageFiles$.subscribe((action) => {
        expect(action).toEqual(stageFilesSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/stage');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('commit$', () => {
    it('should dispatch success action on successful commit', (done) => {
      actions$ = of(commit({ clientId: 'client-1', agentId: 'agent-1', dto: { message: 'Test commit' } }));

      effects.commit$.subscribe((action) => {
        expect(action).toEqual(commitSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/commit');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('push$', () => {
    it('should dispatch success action on successful push', (done) => {
      actions$ = of(push({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.push$.subscribe((action) => {
        expect(action).toEqual(pushSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/push');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('pull$', () => {
    it('should dispatch success action on successful pull', (done) => {
      actions$ = of(pull({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.pull$.subscribe((action) => {
        expect(action).toEqual(pullSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/pull');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('fetch$', () => {
    it('should dispatch success action on successful fetch', (done) => {
      actions$ = of(fetch({ clientId: 'client-1', agentId: 'agent-1' }));

      effects.fetch$.subscribe((action) => {
        expect(action).toEqual(fetchSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/fetch');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('rebase$', () => {
    it('should dispatch success action on successful rebase', (done) => {
      actions$ = of(rebase({ clientId: 'client-1', agentId: 'agent-1', dto: { branch: 'main' } }));

      effects.rebase$.subscribe((action) => {
        expect(action).toEqual(rebaseSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/rebase');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('switchBranch$', () => {
    it('should dispatch success action on successful switch', (done) => {
      actions$ = of(switchBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'develop' }));

      effects.switchBranch$.subscribe((action) => {
        expect(action).toEqual(switchBranchSuccess());
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/vcs/branches/develop/switch',
      );

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('createBranch$', () => {
    it('should dispatch success action on successful create', (done) => {
      actions$ = of(createBranch({ clientId: 'client-1', agentId: 'agent-1', dto: { name: 'feature-branch' } }));

      effects.createBranch$.subscribe((action) => {
        expect(action).toEqual(createBranchSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/branches');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('deleteBranch$', () => {
    it('should dispatch success action on successful delete', (done) => {
      actions$ = of(deleteBranch({ clientId: 'client-1', agentId: 'agent-1', branch: 'feature-branch' }));

      effects.deleteBranch$.subscribe((action) => {
        expect(action).toEqual(deleteBranchSuccess());
        done();
      });

      const req = httpMock.expectOne(
        'https://api.example.com/clients/client-1/agents/agent-1/vcs/branches/feature-branch',
      );

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('resolveConflict$', () => {
    it('should dispatch success action on successful resolve', (done) => {
      actions$ = of(
        resolveConflict({
          clientId: 'client-1',
          agentId: 'agent-1',
          dto: { path: 'file1.txt', strategy: 'yours' },
        }),
      );

      effects.resolveConflict$.subscribe((action) => {
        expect(action).toEqual(resolveConflictSuccess());
        done();
      });

      const req = httpMock.expectOne('https://api.example.com/clients/client-1/agents/agent-1/vcs/conflicts/resolve');

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });
});
