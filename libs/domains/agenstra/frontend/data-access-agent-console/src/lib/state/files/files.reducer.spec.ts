import {
  clearDirectoryListing,
  clearFileContent,
  clearOpenTabs,
  closeFileTab,
  createFileOrDirectory,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  deleteFileOrDirectory,
  deleteFileOrDirectoryFailure,
  deleteFileOrDirectorySuccess,
  listDirectory,
  listDirectoryFailure,
  listDirectorySuccess,
  moveFileOrDirectory,
  moveFileOrDirectoryFailure,
  moveFileOrDirectorySuccess,
  moveTabToFront,
  openFileTab,
  pinFileTab,
  readFile,
  readFileFailure,
  readFileSuccess,
  unpinFileTab,
  writeFile,
  writeFileFailure,
  writeFileSuccess,
} from './files.actions';
import { filesReducer, initialFilesState, type FilesState } from './files.reducer';
import type { FileContentDto, FileNodeDto } from './files.types';

describe('filesReducer', () => {
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
    {
      name: 'dir1',
      type: 'directory',
      path: 'dir1',
    },
  ];

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = filesReducer(undefined, action as any);

      expect(state).toEqual(initialFilesState);
    });
  });

  describe('readFile', () => {
    it('should set reading to true and clear error', () => {
      const state: FilesState = {
        ...initialFilesState,
        errors: { [`${clientId}:${agentId}:app:${filePath}`]: 'Previous error' },
      };
      const newState = filesReducer(state, readFile({ clientId, agentId, filePath }));
      const key = `${clientId}:${agentId}:app:${filePath}`;

      expect(newState.reading[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('readFileSuccess', () => {
    it('should store file content and set reading to false', () => {
      const state: FilesState = {
        ...initialFilesState,
        reading: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, readFileSuccess({ clientId, agentId, filePath, content: mockFileContent }));
      const key = `${clientId}:${agentId}:app:${filePath}`;

      expect(newState.fileContents[key]).toEqual(mockFileContent);
      expect(newState.reading[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('readFileFailure', () => {
    it('should set error and set reading to false', () => {
      const state: FilesState = {
        ...initialFilesState,
        reading: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, readFileFailure({ clientId, agentId, filePath, error: 'Read failed' }));
      const key = `${clientId}:${agentId}:app:${filePath}`;

      expect(newState.errors[key]).toBe('Read failed');
      expect(newState.reading[key]).toBe(false);
    });
  });

  describe('writeFile', () => {
    it('should set writing to true and clear error', () => {
      const state: FilesState = {
        ...initialFilesState,
        errors: { [`${clientId}:${agentId}:app:${filePath}`]: 'Previous error' },
      };
      const newState = filesReducer(
        state,
        writeFile({ clientId, agentId, filePath, writeFileDto: { content: 'base64' } }),
      );
      const key = `${clientId}:${agentId}:app:${filePath}`;

      expect(newState.writing[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('writeFileSuccess', () => {
    it('should invalidate cached content and set writing to false', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        fileContents: { [key]: mockFileContent },
        writing: { [key]: true },
      };
      const newState = filesReducer(state, writeFileSuccess({ clientId, agentId, filePath }));

      expect(newState.fileContents[key]).toBeUndefined();
      expect(newState.writing[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('writeFileFailure', () => {
    it('should set error and set writing to false', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        writing: { [key]: true },
      };
      const newState = filesReducer(state, writeFileFailure({ clientId, agentId, filePath, error: 'Write failed' }));

      expect(newState.errors[key]).toBe('Write failed');
      expect(newState.writing[key]).toBe(false);
    });
  });

  describe('listDirectory', () => {
    it('should set listing to true and clear error', () => {
      const key = `${clientId}:${agentId}:app:${directoryPath}`;
      const state: FilesState = {
        ...initialFilesState,
        errors: { [key]: 'Previous error' },
      };
      const newState = filesReducer(state, listDirectory({ clientId, agentId }));

      expect(newState.listing[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });

    it('should use provided path parameter', () => {
      const customPath = 'subdirectory';
      const key = `${clientId}:${agentId}:app:${customPath}`;
      const newState = filesReducer(
        initialFilesState,
        listDirectory({ clientId, agentId, params: { path: customPath } }),
      );

      expect(newState.listing[key]).toBe(true);
    });
  });

  describe('listDirectorySuccess', () => {
    it('should store directory listing and set listing to false', () => {
      const key = `${clientId}:${agentId}:app:${directoryPath}`;
      const state: FilesState = {
        ...initialFilesState,
        listing: { [key]: true },
      };
      const newState = filesReducer(
        state,
        listDirectorySuccess({ clientId, agentId, directoryPath, files: mockFileNodes }),
      );

      expect(newState.directoryListings[key]).toEqual(mockFileNodes);
      expect(newState.listing[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('listDirectoryFailure', () => {
    it('should set error and set listing to false', () => {
      const key = `${clientId}:${agentId}:app:${directoryPath}`;
      const state: FilesState = {
        ...initialFilesState,
        listing: { [key]: true },
      };
      const newState = filesReducer(
        state,
        listDirectoryFailure({ clientId, agentId, directoryPath, error: 'List failed' }),
      );

      expect(newState.errors[key]).toBe('List failed');
      expect(newState.listing[key]).toBe(false);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should set creating to true and clear error', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        errors: { [key]: 'Previous error' },
      };
      const newState = filesReducer(
        state,
        createFileOrDirectory({ clientId, agentId, filePath, createFileDto: { type: 'file' } }),
      );

      expect(newState.creating[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('createFileOrDirectorySuccess', () => {
    it('should invalidate parent directory listing and set creating to false', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const parentPath = '.';
      const parentKey = `${clientId}:${agentId}:app:${parentPath}`;
      const state: FilesState = {
        ...initialFilesState,
        directoryListings: { [parentKey]: mockFileNodes },
        creating: { [key]: true },
      };
      const newState = filesReducer(
        state,
        createFileOrDirectorySuccess({ clientId, agentId, filePath, fileType: 'file' }),
      );

      expect(newState.directoryListings[parentKey]).toBeUndefined();
      expect(newState.creating[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('createFileOrDirectoryFailure', () => {
    it('should set error and set creating to false', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        creating: { [key]: true },
      };
      const newState = filesReducer(
        state,
        createFileOrDirectoryFailure({ clientId, agentId, filePath, error: 'Create failed' }),
      );

      expect(newState.errors[key]).toBe('Create failed');
      expect(newState.creating[key]).toBe(false);
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should set deleting to true and clear error', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        errors: { [key]: 'Previous error' },
      };
      const newState = filesReducer(state, deleteFileOrDirectory({ clientId, agentId, filePath }));

      expect(newState.deleting[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('deleteFileOrDirectorySuccess', () => {
    it('should remove from cache and invalidate parent directory listing', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const parentPath = '.';
      const parentKey = `${clientId}:${agentId}:app:${parentPath}`;
      const state: FilesState = {
        ...initialFilesState,
        fileContents: { [key]: mockFileContent },
        directoryListings: { [key]: mockFileNodes, [parentKey]: mockFileNodes },
        deleting: { [key]: true },
      };
      const newState = filesReducer(state, deleteFileOrDirectorySuccess({ clientId, agentId, filePath }));

      expect(newState.fileContents[key]).toBeUndefined();
      expect(newState.directoryListings[key]).toBeUndefined();
      expect(newState.directoryListings[parentKey]).toBeUndefined();
      expect(newState.deleting[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('deleteFileOrDirectoryFailure', () => {
    it('should set error and set deleting to false', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        deleting: { [key]: true },
      };
      const newState = filesReducer(
        state,
        deleteFileOrDirectoryFailure({ clientId, agentId, filePath, error: 'Delete failed' }),
      );

      expect(newState.errors[key]).toBe('Delete failed');
      expect(newState.deleting[key]).toBe(false);
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should set moving to true and clear error', () => {
      const sourcePath = 'source-file.txt';
      const key = `${clientId}:${agentId}:app:${sourcePath}`;
      const state: FilesState = {
        ...initialFilesState,
        errors: { [key]: 'Previous error' },
      };
      const newState = filesReducer(
        state,
        moveFileOrDirectory({
          clientId,
          agentId,
          sourcePath,
          moveFileDto: { destination: 'dest-file.txt' },
        }),
      );

      expect(newState.moving[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('moveFileOrDirectorySuccess', () => {
    it('should move file content to destination and invalidate parent directory listings', () => {
      const sourcePath = 'source-file.txt';
      const destinationPath = 'dest-file.txt';
      const sourceKey = `${clientId}:${agentId}:app:${sourcePath}`;
      const destinationKey = `${clientId}:${agentId}:app:${destinationPath}`;
      const sourceParentPath = '.';
      const sourceParentKey = `${clientId}:${agentId}:app:${sourceParentPath}`;
      const state: FilesState = {
        ...initialFilesState,
        fileContents: { [sourceKey]: mockFileContent },
        directoryListings: { [sourceParentKey]: mockFileNodes },
        moving: { [sourceKey]: true },
      };
      const newState = filesReducer(
        state,
        moveFileOrDirectorySuccess({ clientId, agentId, sourcePath, destinationPath }),
      );

      expect(newState.fileContents[sourceKey]).toBeUndefined();
      expect(newState.fileContents[destinationKey]).toEqual(mockFileContent);
      expect(newState.directoryListings[sourceParentKey]).toBeUndefined();
      expect(newState.moving[sourceKey]).toBe(false);
      expect(newState.errors[sourceKey]).toBeNull();
    });

    it('should update open tabs when file is moved', () => {
      const sourcePath = 'source-file.txt';
      const destinationPath = 'dest-file.txt';
      const sourceKey = `${clientId}:${agentId}:app:${sourcePath}`;
      const clientAgentKey = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [clientAgentKey]: [{ filePath: sourcePath, pinned: true }],
        },
        moving: { [sourceKey]: true },
      };
      const newState = filesReducer(
        state,
        moveFileOrDirectorySuccess({ clientId, agentId, sourcePath, destinationPath }),
      );

      expect(newState.openTabs[clientAgentKey]).toEqual([{ filePath: destinationPath, pinned: true }]);
    });

    it('should handle move when file content does not exist in cache', () => {
      const sourcePath = 'source-file.txt';
      const destinationPath = 'dest-file.txt';
      const sourceKey = `${clientId}:${agentId}:app:${sourcePath}`;
      const destinationKey = `${clientId}:${agentId}:app:${destinationPath}`;
      const sourceParentPath = '.';
      const sourceParentKey = `${clientId}:${agentId}:app:${sourceParentPath}`;
      const state: FilesState = {
        ...initialFilesState,
        directoryListings: { [sourceParentKey]: mockFileNodes },
        moving: { [sourceKey]: true },
      };
      const newState = filesReducer(
        state,
        moveFileOrDirectorySuccess({ clientId, agentId, sourcePath, destinationPath }),
      );

      expect(newState.fileContents[sourceKey]).toBeUndefined();
      expect(newState.fileContents[destinationKey]).toBeUndefined();
      expect(newState.directoryListings[sourceParentKey]).toBeUndefined();
      expect(newState.moving[sourceKey]).toBe(false);
    });
  });

  describe('moveFileOrDirectoryFailure', () => {
    it('should set error and set moving to false', () => {
      const sourcePath = 'source-file.txt';
      const key = `${clientId}:${agentId}:app:${sourcePath}`;
      const state: FilesState = {
        ...initialFilesState,
        moving: { [key]: true },
      };
      const newState = filesReducer(
        state,
        moveFileOrDirectoryFailure({ clientId, agentId, sourcePath, error: 'Move failed' }),
      );

      expect(newState.errors[key]).toBe('Move failed');
      expect(newState.moving[key]).toBe(false);
    });
  });

  describe('clearFileContent', () => {
    it('should remove file content from cache', () => {
      const key = `${clientId}:${agentId}:app:${filePath}`;
      const state: FilesState = {
        ...initialFilesState,
        fileContents: { [key]: mockFileContent },
      };
      const newState = filesReducer(state, clearFileContent({ clientId, agentId, filePath }));

      expect(newState.fileContents[key]).toBeUndefined();
    });
  });

  describe('clearDirectoryListing', () => {
    it('should remove directory listing from cache', () => {
      const key = `${clientId}:${agentId}:app:${directoryPath}`;
      const state: FilesState = {
        ...initialFilesState,
        directoryListings: { [key]: mockFileNodes },
      };
      const newState = filesReducer(state, clearDirectoryListing({ clientId, agentId, directoryPath }));

      expect(newState.directoryListings[key]).toBeUndefined();
    });
  });

  describe('multiple clients and agents', () => {
    it('should handle different client/agent/path combinations independently', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const filePath2 = 'other-file.txt';
      const key1 = `${clientId}:${agentId}:app:${filePath}`;
      const key2 = `${clientId2}:${agentId2}:app:${filePath2}`;
      let state = initialFilesState;

      // Read file for first client/agent
      state = filesReducer(state, readFile({ clientId, agentId, filePath }));
      expect(state.reading[key1]).toBe(true);

      // Read file for second client/agent
      state = filesReducer(state, readFile({ clientId: clientId2, agentId: agentId2, filePath: filePath2 }));
      expect(state.reading[key2]).toBe(true);
      expect(state.reading[key1]).toBe(true); // First one still loading

      // Success for first
      state = filesReducer(state, readFileSuccess({ clientId, agentId, filePath, content: mockFileContent }));
      expect(state.reading[key1]).toBe(false);
      expect(state.fileContents[key1]).toEqual(mockFileContent);
      expect(state.reading[key2]).toBe(true); // Second one still loading
    });
  });

  describe('openFileTab', () => {
    it('should add a new tab when opening a file', () => {
      const newState = filesReducer(initialFilesState, openFileTab({ clientId, agentId, filePath }));
      const key = `${clientId}:${agentId}:app`;

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0]).toEqual({ filePath, pinned: false });
    });

    it('should not add duplicate tabs if tab is already pinned', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: true }] },
      };
      const newState = filesReducer(state, openFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].pinned).toBe(true);
      expect(newState).toBe(state);
    });

    it('should replace unpinned tab when opening the same file again', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, openFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][0].pinned).toBe(false);
    });

    it('should remove unpinned tabs when opening a new file', () => {
      const filePath2 = 'other-file.txt';
      const key = `${clientId}:${agentId}:app`;
      let state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };

      state = filesReducer(state, openFileTab({ clientId, agentId, filePath: filePath2 }));

      expect(state.openTabs[key]).toHaveLength(1);
      expect(state.openTabs[key][0].filePath).toBe(filePath2);
      expect(state.openTabs[key][0].pinned).toBe(false);
    });

    it('should keep pinned tabs when opening a new file', () => {
      const filePath2 = 'other-file.txt';
      const filePath3 = 'third-file.txt';
      const key = `${clientId}:${agentId}:app`;
      let state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: true },
            { filePath: filePath2, pinned: false },
          ],
        },
      };

      state = filesReducer(state, openFileTab({ clientId, agentId, filePath: filePath3 }));

      expect(state.openTabs[key]).toHaveLength(2);
      expect(state.openTabs[key][0].filePath).toBe(filePath);
      expect(state.openTabs[key][0].pinned).toBe(true);
      expect(state.openTabs[key][1].filePath).toBe(filePath3);
      expect(state.openTabs[key][1].pinned).toBe(false);
    });
  });

  describe('closeFileTab', () => {
    it('should remove a tab when closing', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, closeFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(0);
    });

    it('should only remove the specified tab', () => {
      const filePath2 = 'other-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
          ],
        },
      };
      const newState = filesReducer(state, closeFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath2);
    });

    it('should not change state when closing a tab that does not exist', () => {
      const key = `${clientId}:${agentId}:app`;
      const nonExistentPath = 'non-existent.txt';
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, closeFileTab({ clientId, agentId, filePath: nonExistentPath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
    });

    it('should handle closing when no tabs exist', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {},
      };
      const newState = filesReducer(state, closeFileTab({ clientId, agentId, filePath }));

      // When no tabs exist, the reducer returns an empty array
      expect(newState.openTabs[key]).toEqual([]);
    });
  });

  describe('pinFileTab', () => {
    it('should pin a tab', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, pinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(true);
    });

    it('should only pin the specified tab', () => {
      const filePath2 = 'other-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
          ],
        },
      };
      const newState = filesReducer(state, pinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(true);
      expect(newState.openTabs[key][1].pinned).toBe(false);
    });

    it('should not change state when pinning a tab that does not exist', () => {
      const key = `${clientId}:${agentId}:app`;
      const nonExistentPath = 'non-existent.txt';
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, pinFileTab({ clientId, agentId, filePath: nonExistentPath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][0].pinned).toBe(false);
    });

    it('should not change state when pinning an already pinned tab', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: true }] },
      };
      const newState = filesReducer(state, pinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(true);
    });
  });

  describe('unpinFileTab', () => {
    it('should unpin a tab', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: true }] },
      };
      const newState = filesReducer(state, unpinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(false);
    });

    it('should only unpin the specified tab', () => {
      const filePath2 = 'other-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: true },
            { filePath: filePath2, pinned: true },
          ],
        },
      };
      const newState = filesReducer(state, unpinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(false);
      expect(newState.openTabs[key][1].pinned).toBe(true);
    });

    it('should not change state when unpinning a tab that does not exist', () => {
      const key = `${clientId}:${agentId}:app`;
      const nonExistentPath = 'non-existent.txt';
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: true }] },
      };
      const newState = filesReducer(state, unpinFileTab({ clientId, agentId, filePath: nonExistentPath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][0].pinned).toBe(true);
    });

    it('should not change state when unpinning an already unpinned tab', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
      };
      const newState = filesReducer(state, unpinFileTab({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(false);
    });
  });

  describe('moveTabToFront', () => {
    it('should move a tab to the front of the tabs list', () => {
      const filePath2 = 'second-file.txt';
      const filePath3 = 'third-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
            { filePath: filePath3, pinned: true },
          ],
        },
      };
      const newState = filesReducer(state, moveTabToFront({ clientId, agentId, filePath: filePath3 }));

      expect(newState.openTabs[key]).toHaveLength(3);
      expect(newState.openTabs[key][0].filePath).toBe(filePath3);
      expect(newState.openTabs[key][0].pinned).toBe(true);
      expect(newState.openTabs[key][1].filePath).toBe(filePath);
      expect(newState.openTabs[key][2].filePath).toBe(filePath2);
    });

    it('should not change state if tab is already at front', () => {
      const filePath2 = 'second-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
          ],
        },
      };
      const newState = filesReducer(state, moveTabToFront({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(2);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][1].filePath).toBe(filePath2);
      expect(newState).toBe(state);
    });

    it('should not change state if tab is not found', () => {
      const filePath2 = 'second-file.txt';
      const nonExistentPath = 'non-existent.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
          ],
        },
      };
      const newState = filesReducer(state, moveTabToFront({ clientId, agentId, filePath: nonExistentPath }));

      expect(newState.openTabs[key]).toHaveLength(2);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][1].filePath).toBe(filePath2);
      expect(newState).toBe(state);
    });

    it('should preserve tab properties when moving to front', () => {
      const filePath2 = 'second-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: true },
          ],
        },
      };
      const newState = filesReducer(state, moveTabToFront({ clientId, agentId, filePath: filePath2 }));

      expect(newState.openTabs[key]).toHaveLength(2);
      expect(newState.openTabs[key][0].filePath).toBe(filePath2);
      expect(newState.openTabs[key][0].pinned).toBe(true);
      expect(newState.openTabs[key][1].filePath).toBe(filePath);
      expect(newState.openTabs[key][1].pinned).toBe(false);
    });

    it('should only affect tabs for the specified client/agent', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const filePath2 = 'second-file.txt';
      const key1 = `${clientId}:${agentId}:app`;
      const key2 = `${clientId2}:${agentId2}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key1]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: false },
          ],
          [key2]: [
            { filePath: 'other-file.txt', pinned: false },
            { filePath: 'another-file.txt', pinned: false },
          ],
        },
      };
      const newState = filesReducer(state, moveTabToFront({ clientId, agentId, filePath: filePath2 }));

      // First client/agent tabs should be reordered
      expect(newState.openTabs[key1]).toHaveLength(2);
      expect(newState.openTabs[key1][0].filePath).toBe(filePath2);
      expect(newState.openTabs[key1][1].filePath).toBe(filePath);

      // Second client/agent tabs should remain unchanged
      expect(newState.openTabs[key2]).toHaveLength(2);
      expect(newState.openTabs[key2][0].filePath).toBe('other-file.txt');
      expect(newState.openTabs[key2][1].filePath).toBe('another-file.txt');
    });
  });

  describe('clearOpenTabs', () => {
    it('should clear all tabs for a client/agent', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: 'other-file.txt', pinned: true },
          ],
        },
      };
      const newState = filesReducer(state, clearOpenTabs({ clientId, agentId }));

      expect(newState.openTabs[key]).toBeUndefined();
    });

    it('should only clear tabs for the specified client/agent', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const key1 = `${clientId}:${agentId}:app`;
      const key2 = `${clientId2}:${agentId2}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key1]: [{ filePath, pinned: false }],
          [key2]: [{ filePath: 'other-file.txt', pinned: false }],
        },
      };
      const newState = filesReducer(state, clearOpenTabs({ clientId, agentId }));

      expect(newState.openTabs[key1]).toBeUndefined();
      expect(newState.openTabs[key2]).toHaveLength(1);
    });
  });

  describe('writeFileSuccess pins tab', () => {
    it('should pin the tab when a file is saved', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: false }] },
        writing: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, writeFileSuccess({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(true);
    });

    it('should keep tab pinned if already pinned when file is saved', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: { [key]: [{ filePath, pinned: true }] },
        writing: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, writeFileSuccess({ clientId, agentId, filePath }));

      expect(newState.openTabs[key][0].pinned).toBe(true);
    });

    it('should create a pinned tab if tab does not exist when file is saved', () => {
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {},
        writing: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, writeFileSuccess({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(1);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][0].pinned).toBe(true);
    });

    it('should preserve other tabs when pinning a saved file', () => {
      const filePath2 = 'other-file.txt';
      const key = `${clientId}:${agentId}:app`;
      const state: FilesState = {
        ...initialFilesState,
        openTabs: {
          [key]: [
            { filePath, pinned: false },
            { filePath: filePath2, pinned: true },
          ],
        },
        writing: { [`${clientId}:${agentId}:app:${filePath}`]: true },
      };
      const newState = filesReducer(state, writeFileSuccess({ clientId, agentId, filePath }));

      expect(newState.openTabs[key]).toHaveLength(2);
      expect(newState.openTabs[key][0].filePath).toBe(filePath);
      expect(newState.openTabs[key][0].pinned).toBe(true);
      expect(newState.openTabs[key][1].filePath).toBe(filePath2);
      expect(newState.openTabs[key][1].pinned).toBe(true);
    });
  });

  describe('multiple clients and agents - tabs', () => {
    it('should handle open tabs independently for different client/agent combinations', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const filePath2 = 'other-file.txt';
      const key1 = `${clientId}:${agentId}:app`;
      const key2 = `${clientId2}:${agentId2}:app`;
      let state = initialFilesState;

      state = filesReducer(state, openFileTab({ clientId, agentId, filePath }));
      state = filesReducer(state, openFileTab({ clientId: clientId2, agentId: agentId2, filePath: filePath2 }));

      expect(state.openTabs[key1]).toHaveLength(1);
      expect(state.openTabs[key1][0].filePath).toBe(filePath);
      expect(state.openTabs[key2]).toHaveLength(1);
      expect(state.openTabs[key2][0].filePath).toBe(filePath2);
    });
  });

  describe('file manager context', () => {
    it('should keep app and config file content caches independent', () => {
      const appKey = `${clientId}:${agentId}:app:${filePath}`;
      const configContent: FileContentDto = {
        content: Buffer.from('config', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      let state = filesReducer(
        initialFilesState,
        readFileSuccess({ clientId, agentId, filePath, content: mockFileContent, context: 'app' }),
      );

      state = filesReducer(
        state,
        readFileSuccess({ clientId, agentId, filePath, content: configContent, context: 'config' }),
      );

      expect(state.fileContents[appKey]).toEqual(mockFileContent);
      expect(state.fileContents[`${clientId}:${agentId}:config:${filePath}`]).toEqual(configContent);
    });
  });
});
