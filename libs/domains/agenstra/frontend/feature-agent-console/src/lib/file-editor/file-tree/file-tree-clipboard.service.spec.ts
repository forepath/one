import { TestBed } from '@angular/core/testing';
import {
  FilesFacade,
  FilesService,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  moveFileOrDirectoryFailure,
  moveFileOrDirectorySuccess,
  type FileNodeDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions } from '@ngrx/effects';
import { Subject, of } from 'rxjs';

import { FileTreeClipboardService } from './file-tree-clipboard.service';

describe('FileTreeClipboardService', () => {
  let service: FileTreeClipboardService;
  let actions$: Subject<unknown>;
  let filesFacade: {
    createFileOrDirectory: jest.Mock;
    moveFileOrDirectory: jest.Mock;
    deleteFileOrDirectory: jest.Mock;
    listDirectory: jest.Mock;
  };
  let filesService: {
    readFile: jest.Mock;
    listDirectory: jest.Mock;
  };

  const batch = { clientId: 'c1', agentId: 'a1', context: 'app' as const };

  beforeEach(() => {
    actions$ = new Subject();
    filesFacade = {
      createFileOrDirectory: jest.fn(),
      moveFileOrDirectory: jest.fn(),
      deleteFileOrDirectory: jest.fn(),
      listDirectory: jest.fn(),
    };
    filesService = {
      readFile: jest.fn(),
      listDirectory: jest.fn().mockReturnValue(of([])),
    };

    TestBed.configureTestingModule({
      providers: [
        FileTreeClipboardService,
        { provide: FilesFacade, useValue: filesFacade },
        { provide: FilesService, useValue: filesService },
        { provide: Actions, useValue: actions$ },
      ],
    });

    service = TestBed.inject(FileTreeClipboardService);
  });

  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('copies a directory recursively including nested files', async () => {
    const children: FileNodeDto[] = [
      { name: 'a.ts', type: 'file', path: 'src/a.ts' },
      { name: 'lib', type: 'directory', path: 'src/lib' },
    ];
    const nested: FileNodeDto[] = [{ name: 'b.ts', type: 'file', path: 'src/lib/b.ts' }];

    filesService.listDirectory.mockImplementation((_c: string, _a: string, params?: { path?: string }) => {
      if (params?.path === 'src') {
        return of(children);
      }

      if (params?.path === 'src/lib') {
        return of(nested);
      }

      if (params?.path === 'dest' || params?.path === undefined) {
        return of([]);
      }

      return of([]);
    });
    filesService.readFile.mockReturnValue(of({ content: 'YQ==', encoding: 'base64', path: 'x', size: 1 }));

    service.setClipboard('copy', [{ path: 'src', type: 'directory' }]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'dest', done);
    await flushMicrotasks();

    // directory create
    expect(filesFacade.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src',
      { type: 'directory' },
      'app',
    );
    actions$.next(
      createFileOrDirectorySuccess({ clientId: 'c1', agentId: 'a1', filePath: 'dest/src', fileType: 'directory' }),
    );
    await flushMicrotasks();

    expect(filesFacade.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/a.ts',
      { type: 'file', content: 'YQ==' },
      'app',
    );
    actions$.next(
      createFileOrDirectorySuccess({ clientId: 'c1', agentId: 'a1', filePath: 'dest/src/a.ts', fileType: 'file' }),
    );
    await flushMicrotasks();

    expect(filesFacade.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/lib',
      { type: 'directory' },
      'app',
    );
    actions$.next(
      createFileOrDirectorySuccess({ clientId: 'c1', agentId: 'a1', filePath: 'dest/src/lib', fileType: 'directory' }),
    );
    await flushMicrotasks();

    expect(filesFacade.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/lib/b.ts',
      { type: 'file', content: 'YQ==' },
      'app',
    );
    actions$.next(
      createFileOrDirectorySuccess({ clientId: 'c1', agentId: 'a1', filePath: 'dest/src/lib/b.ts', fileType: 'file' }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(done).toHaveBeenCalledWith({
      mode: 'copy',
      destinations: ['dest/src'],
      moves: [{ source: 'src', destination: 'dest/src', type: 'directory' }],
    });
  });

  it('moves queued cut entries via facade move', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [
      { path: 'readme.md', type: 'file' },
      { path: 'src', type: 'directory' },
    ]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'lib', done);
    await flushMicrotasks();

    expect(filesFacade.moveFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'readme.md',
      { destination: 'lib/readme.md' },
      'app',
    );
    actions$.next(
      moveFileOrDirectorySuccess({
        clientId: 'c1',
        agentId: 'a1',
        sourcePath: 'readme.md',
        destinationPath: 'lib/readme.md',
      }),
    );
    await flushMicrotasks();

    expect(filesFacade.moveFileOrDirectory).toHaveBeenCalledWith('c1', 'a1', 'src', { destination: 'lib/src' }, 'app');
    actions$.next(
      moveFileOrDirectorySuccess({
        clientId: 'c1',
        agentId: 'a1',
        sourcePath: 'src',
        destinationPath: 'lib/src',
      }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.clipboard()).toBeNull();
    expect(done).toHaveBeenCalledWith({
      mode: 'cut',
      destinations: ['lib/readme.md', 'lib/src'],
      moves: [
        { source: 'readme.md', destination: 'lib/readme.md', type: 'file' },
        { source: 'src', destination: 'lib/src', type: 'directory' },
      ],
    });
  });

  it('rejects moving a directory into itself without calling move', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [{ path: 'src', type: 'directory' }]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'src/lib', done);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(filesFacade.moveFileOrDirectory).not.toHaveBeenCalled();
    expect(service.lastError()).toContain('Cannot move');
    expect(done).not.toHaveBeenCalled();
  });

  it('allows moving a short-named folder into a prefix-similar folder', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [{ path: 'app', type: 'directory' }]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'apps', done);
    await flushMicrotasks();

    expect(filesFacade.moveFileOrDirectory).toHaveBeenCalledWith('c1', 'a1', 'app', { destination: 'apps/app' }, 'app');
    actions$.next(
      moveFileOrDirectorySuccess({
        clientId: 'c1',
        agentId: 'a1',
        sourcePath: 'app',
        destinationPath: 'apps/app',
      }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(done).toHaveBeenCalled();
    expect(service.lastError()).toBeNull();
  });

  it('surfaces move failures on the error signal', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [{ path: 'a.ts', type: 'file' }]);
    service.enqueuePaste(batch, 'lib');
    await flushMicrotasks();

    actions$.next(
      moveFileOrDirectoryFailure({
        clientId: 'c1',
        agentId: 'a1',
        sourcePath: 'a.ts',
        error: 'Move failed',
      }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Move failed');
  });

  it('surfaces create failures while copying', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    filesService.readFile.mockReturnValue(of({ content: 'YQ==', encoding: 'base64', path: 'a.ts', size: 1 }));
    service.setClipboard('copy', [{ path: 'a.ts', type: 'file' }]);
    service.enqueuePaste(batch, 'lib');
    await flushMicrotasks();

    actions$.next(
      createFileOrDirectoryFailure({
        clientId: 'c1',
        agentId: 'a1',
        filePath: 'lib/a.ts',
        error: 'Create failed',
      }),
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Create failed');
  });
});
