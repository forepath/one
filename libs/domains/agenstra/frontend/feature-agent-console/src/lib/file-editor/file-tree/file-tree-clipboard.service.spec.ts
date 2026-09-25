import { TestBed } from '@angular/core/testing';
import {
  FilesFacade,
  FilesService,
  type FileContentDto,
  type FileNodeDto,
  type WriteFileDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import { FileTreeClipboardService } from './file-tree-clipboard.service';

describe('FileTreeClipboardService', () => {
  let service: FileTreeClipboardService;
  let filesFacade: {
    listDirectory: jest.Mock;
  };
  let filesService: {
    readFile: jest.Mock;
    listDirectory: jest.Mock;
    fileContentToWriteDto: jest.Mock;
    materializeWriteContent: jest.Mock;
    createFileOrDirectory: jest.Mock;
    writeFile: jest.Mock;
    moveFileOrDirectory: jest.Mock;
    deleteFileOrDirectory: jest.Mock;
  };
  let store: { dispatch: jest.Mock };

  const batch = { clientId: 'c1', agentId: 'a1', context: 'app' as const };
  const mockContent: FileContentDto = {
    fileType: 'text',
    contentType: 'text/plain',
    text: 'a',
    bodyRef: 'mock-body-ref-a',
    size: 1,
  };
  const mockWriteDto: WriteFileDto = {
    bytes: new TextEncoder().encode('a').buffer,
    fileType: 'text',
    contentType: 'text/plain',
  };

  beforeEach(() => {
    filesFacade = {
      listDirectory: jest.fn(),
    };
    filesService = {
      readFile: jest.fn().mockReturnValue(of(mockContent)),
      listDirectory: jest.fn().mockReturnValue(of([])),
      fileContentToWriteDto: jest.fn().mockResolvedValue(mockWriteDto),
      materializeWriteContent: jest.fn().mockResolvedValue(mockContent),
      createFileOrDirectory: jest.fn().mockReturnValue(of(undefined)),
      writeFile: jest.fn().mockReturnValue(of(undefined)),
      moveFileOrDirectory: jest.fn().mockReturnValue(of(undefined)),
      deleteFileOrDirectory: jest.fn().mockReturnValue(of(undefined)),
    };
    store = { dispatch: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        FileTreeClipboardService,
        { provide: FilesFacade, useValue: filesFacade },
        { provide: FilesService, useValue: filesService },
        { provide: Store, useValue: store },
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

    service.setClipboard('copy', [{ path: 'src', type: 'directory' }]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'dest', done);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(filesService.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src',
      { type: 'directory' },
      'app',
    );
    expect(filesService.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/a.ts',
      { type: 'file' },
      'app',
    );
    expect(filesService.writeFile).toHaveBeenCalledWith('c1', 'a1', 'dest/src/a.ts', mockWriteDto, 'app');
    expect(filesService.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/lib',
      { type: 'directory' },
      'app',
    );
    expect(filesService.createFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'dest/src/lib/b.ts',
      { type: 'file' },
      'app',
    );
    expect(filesService.writeFile).toHaveBeenCalledWith('c1', 'a1', 'dest/src/lib/b.ts', mockWriteDto, 'app');
    expect(done).toHaveBeenCalledWith({
      mode: 'copy',
      destinations: ['dest/src'],
      moves: [{ source: 'src', destination: 'dest/src', type: 'directory' }],
    });
    expect(store.dispatch).toHaveBeenCalled();
  });

  it('moves queued cut entries via service move', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [
      { path: 'readme.md', type: 'file' },
      { path: 'src', type: 'directory' },
    ]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'lib', done);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(filesService.moveFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'readme.md',
      { destination: 'lib/readme.md' },
      'app',
    );
    expect(filesService.moveFileOrDirectory).toHaveBeenCalledWith('c1', 'a1', 'src', { destination: 'lib/src' }, 'app');
    expect(filesService.moveFileOrDirectory).toHaveBeenCalledTimes(2);
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

    expect(filesService.moveFileOrDirectory).not.toHaveBeenCalled();
    expect(service.lastError()).toContain('Cannot move');
    expect(done).not.toHaveBeenCalled();
  });

  it('allows moving a short-named folder into a prefix-similar folder', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    service.setClipboard('cut', [{ path: 'app', type: 'directory' }]);

    const done = jest.fn();

    service.enqueuePaste(batch, 'apps', done);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(filesService.moveFileOrDirectory).toHaveBeenCalledWith(
      'c1',
      'a1',
      'app',
      { destination: 'apps/app' },
      'app',
    );
    expect(done).toHaveBeenCalled();
    expect(service.lastError()).toBeNull();
  });

  it('surfaces move failures while cutting', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    filesService.moveFileOrDirectory.mockReturnValue(throwError(() => new Error('Move failed')));
    service.setClipboard('cut', [{ path: 'a.ts', type: 'file' }]);
    service.enqueuePaste(batch, 'lib');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Move failed');
  });

  it('surfaces create failures while copying', async () => {
    filesService.listDirectory.mockReturnValue(of([]));
    filesService.createFileOrDirectory.mockReturnValue(throwError(() => new Error('Create failed')));
    service.setClipboard('copy', [{ path: 'a.ts', type: 'file' }]);
    service.enqueuePaste(batch, 'lib');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(service.lastError()).toBe('Create failed');
  });
});
