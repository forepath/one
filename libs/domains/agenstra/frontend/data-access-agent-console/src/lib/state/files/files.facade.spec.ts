import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearDirectoryListing,
  clearFileContent,
  clearOpenTabs,
  closeFileTab,
  createFileOrDirectory,
  deleteFileOrDirectory,
  listDirectory,
  moveFileOrDirectory,
  moveTabToFront,
  openFileTab,
  pinFileTab,
  readFile,
  unpinFileTab,
  writeFile,
} from './files.actions';
import { FilesFacade } from './files.facade';
import type { CreateFileDto, FileContentDto, FileNodeDto, MoveFileDto, WriteFileDto } from './files.types';

describe('FilesFacade', () => {
  let facade: FilesFacade;
  let store: jest.Mocked<Store>;
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const filePath = 'test-file.txt';
  const directoryPath = '.';
  const mockFileContent: FileContentDto = {
    content: Buffer.from('Hello, World!', 'utf-8').toString('base64'),
    encoding: 'utf-8',
  };
  const mockFileNodes: FileNodeDto[] = [
    {
      name: 'file1.txt',
      type: 'file',
      path: 'file1.txt',
      size: 1024,
      modifiedAt: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    store = {
      select: jest.fn(),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        FilesFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(FilesFacade);
  });

  describe('State Observables', () => {
    it('should return file content observable', (done) => {
      store.select.mockReturnValue(of(mockFileContent));

      facade.getFileContent$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toEqual(mockFileContent);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return null when file content not loaded', (done) => {
      store.select.mockReturnValue(of(null));

      facade.getFileContent$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });

    it('should return directory listing observable', (done) => {
      store.select.mockReturnValue(of(mockFileNodes));

      facade.getDirectoryListing$(clientId, agentId, directoryPath).subscribe((result) => {
        expect(result).toEqual(mockFileNodes);
        done();
      });
    });

    it('should use default directory path when not provided', (done) => {
      store.select.mockReturnValue(of(mockFileNodes));

      facade.getDirectoryListing$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual(mockFileNodes);
        done();
      });
    });
  });

  describe('Loading State Observables', () => {
    it('should return reading file loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isReadingFile$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return writing file loading observable', (done) => {
      store.select.mockReturnValue(of(false));

      facade.isWritingFile$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should return listing directory loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isListingDirectory$(clientId, agentId, directoryPath).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return creating file loading observable', (done) => {
      store.select.mockReturnValue(of(false));

      facade.isCreatingFile$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should return deleting file loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isDeletingFile$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return moving file loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isMovingFile$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return combined file operation loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isFileOperationLoading$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return directory operation loading observable', (done) => {
      store.select.mockReturnValue(of(false));

      facade.isDirectoryOperationLoading$(clientId, agentId, directoryPath).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });
  });

  describe('Error Observable', () => {
    it('should return file error observable', (done) => {
      const error = 'Test error';

      store.select.mockReturnValue(of(error));

      facade.getFileError$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });

    it('should return null when no error', (done) => {
      store.select.mockReturnValue(of(null));

      facade.getFileError$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch readFile action', () => {
      facade.readFile(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(readFile({ clientId, agentId, filePath }));
    });

    it('should dispatch readFile with config context when provided', () => {
      facade.readFile(clientId, agentId, filePath, 'config');

      expect(store.dispatch).toHaveBeenCalledWith(readFile({ clientId, agentId, filePath, context: 'config' }));
    });

    it('should dispatch writeFile action', () => {
      const writeDto: WriteFileDto = {
        content: Buffer.from('New content', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };

      facade.writeFile(clientId, agentId, filePath, writeDto);

      expect(store.dispatch).toHaveBeenCalledWith(writeFile({ clientId, agentId, filePath, writeFileDto: writeDto }));
    });

    it('should dispatch listDirectory action', () => {
      facade.listDirectory(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(listDirectory({ clientId, agentId, params: undefined }));
    });

    it('should dispatch listDirectory action with params', () => {
      const params = { path: 'subdirectory' };

      facade.listDirectory(clientId, agentId, params);

      expect(store.dispatch).toHaveBeenCalledWith(listDirectory({ clientId, agentId, params }));
    });

    it('should dispatch createFileOrDirectory action', () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };

      facade.createFileOrDirectory(clientId, agentId, filePath, createDto);

      expect(store.dispatch).toHaveBeenCalledWith(
        createFileOrDirectory({ clientId, agentId, filePath, createFileDto: createDto }),
      );
    });

    it('should dispatch deleteFileOrDirectory action', () => {
      facade.deleteFileOrDirectory(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(deleteFileOrDirectory({ clientId, agentId, filePath }));
    });

    it('should dispatch moveFileOrDirectory action', () => {
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };

      facade.moveFileOrDirectory(clientId, agentId, filePath, moveDto);

      expect(store.dispatch).toHaveBeenCalledWith(
        moveFileOrDirectory({ clientId, agentId, sourcePath: filePath, moveFileDto: moveDto }),
      );
    });

    it('should dispatch clearFileContent action', () => {
      facade.clearFileContent(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(clearFileContent({ clientId, agentId, filePath }));
    });

    it('should dispatch clearDirectoryListing action', () => {
      facade.clearDirectoryListing(clientId, agentId, directoryPath);

      expect(store.dispatch).toHaveBeenCalledWith(clearDirectoryListing({ clientId, agentId, directoryPath }));
    });
  });

  describe('Tab Management Methods', () => {
    it('should return open tabs observable', (done) => {
      const mockTabs = [
        { filePath: 'file1.txt', pinned: false },
        { filePath: 'file2.txt', pinned: true },
      ];

      store.select.mockReturnValue(of(mockTabs));

      facade.getOpenTabs$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual(mockTabs);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return empty array when no tabs exist', (done) => {
      store.select.mockReturnValue(of([]));

      facade.getOpenTabs$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should dispatch openFileTab action', () => {
      facade.openFileTab(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(openFileTab({ clientId, agentId, filePath }));
    });

    it('should dispatch closeFileTab action', () => {
      facade.closeFileTab(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(closeFileTab({ clientId, agentId, filePath }));
    });

    it('should dispatch pinFileTab action', () => {
      facade.pinFileTab(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(pinFileTab({ clientId, agentId, filePath }));
    });

    it('should dispatch unpinFileTab action', () => {
      facade.unpinFileTab(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(unpinFileTab({ clientId, agentId, filePath }));
    });

    it('should dispatch moveTabToFront action', () => {
      facade.moveTabToFront(clientId, agentId, filePath);

      expect(store.dispatch).toHaveBeenCalledWith(moveTabToFront({ clientId, agentId, filePath }));
    });

    it('should dispatch clearOpenTabs action', () => {
      facade.clearOpenTabs(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(clearOpenTabs({ clientId, agentId }));
    });
  });

  describe('Multiple Clients and Agents', () => {
    it('should handle different client/agent/path combinations independently', (done) => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const filePath2 = 'other-file.txt';

      // First call for client-1/agent-1
      store.select.mockReturnValueOnce(of(mockFileContent));
      facade.getFileContent$(clientId, agentId, filePath).subscribe((result) => {
        expect(result).toEqual(mockFileContent);
      });

      // Second call for client-2/agent-2
      const mockFileContent2: FileContentDto = {
        content: Buffer.from('Other content', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };

      store.select.mockReturnValueOnce(of(mockFileContent2));
      facade.getFileContent$(clientId2, agentId2, filePath2).subscribe((result) => {
        expect(result).toEqual(mockFileContent2);
        expect(store.select).toHaveBeenCalledTimes(2);
        done();
      });
    });
  });
});
