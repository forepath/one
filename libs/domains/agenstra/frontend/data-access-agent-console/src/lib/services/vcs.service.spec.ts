import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  CommitDto,
  CreateBranchDto,
  GitBranch,
  GitDiff,
  GitStatus,
  RebaseDto,
  ResolveConflictDto,
  StageFilesDto,
  UnstageFilesDto,
} from '../state/vcs/vcs.types';

import { VcsService } from './vcs.service';

describe('VcsService', () => {
  let service: VcsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const mockGitStatus: GitStatus = {
    isClean: false,
    currentBranch: 'main',
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });

    service = TestBed.inject(VcsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getStatus', () => {
    it('should return git status', (done) => {
      service.getStatus(clientId, agentId).subscribe((status) => {
        expect(status).toEqual(mockGitStatus);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/status`);

      expect(req.request.method).toBe('GET');
      req.flush(mockGitStatus);
    });
  });

  describe('getBranches', () => {
    it('should return list of branches', (done) => {
      service.getBranches(clientId, agentId).subscribe((branches) => {
        expect(branches).toEqual(mockBranches);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches`);

      expect(req.request.method).toBe('GET');
      req.flush(mockBranches);
    });
  });

  describe('getFileDiff', () => {
    it('should return file diff', (done) => {
      const filePath = 'file1.txt';

      service.getFileDiff(clientId, agentId, filePath).subscribe((diff) => {
        expect(diff).toEqual(mockGitDiff);
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/diff?path=${encodeURIComponent(filePath)}`,
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockGitDiff);
    });
  });

  describe('createBranch', () => {
    it('should create branch', (done) => {
      const dto: CreateBranchDto = {
        name: 'new-feature',
        baseBranch: 'main',
      };

      service.createBranch(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });

  describe('switchBranch', () => {
    it('should switch branch', (done) => {
      const branch = 'feature/test';

      service.switchBranch(clientId, agentId, branch).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches/${encodeURIComponent(branch)}/switch`,
      );

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', (done) => {
      const branch = 'feature/old';

      service.deleteBranch(clientId, agentId, branch).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches/${encodeURIComponent(branch)}`,
      );

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('stageFiles', () => {
    it('should stage files', (done) => {
      const dto: StageFilesDto = {
        files: ['file1.txt', 'file2.txt'],
      };

      service.stageFiles(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/stage`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });

  describe('unstageFiles', () => {
    it('should unstage files', (done) => {
      const dto: UnstageFilesDto = {
        files: ['file1.txt'],
      };

      service.unstageFiles(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/unstage`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });

  describe('commit', () => {
    it('should commit changes', (done) => {
      const dto: CommitDto = {
        message: 'Test commit',
      };

      service.commit(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/commit`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });

  describe('fetch', () => {
    it('should fetch changes', (done) => {
      service.fetch(clientId, agentId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/fetch`);

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('pull', () => {
    it('should pull changes', (done) => {
      service.pull(clientId, agentId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/pull`);

      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  describe('push', () => {
    it('should push changes', (done) => {
      service.push(clientId, agentId).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/push`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ force: false });
      req.flush(null);
    });

    it('should force push when requested', (done) => {
      service.push(clientId, agentId, { force: true }).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/push`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ force: true });
      req.flush(null);
    });
  });

  describe('rebase', () => {
    it('should rebase branch', (done) => {
      const dto: RebaseDto = {
        branch: 'main',
      };

      service.rebase(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/rebase`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict', (done) => {
      const dto: ResolveConflictDto = {
        path: 'conflict-file.txt',
        strategy: 'yours',
      };

      service.resolveConflict(clientId, agentId, dto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/vcs/conflicts/resolve`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(null);
    });
  });
});
