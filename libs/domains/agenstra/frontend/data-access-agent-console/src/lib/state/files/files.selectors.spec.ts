import type { FilesState, OpenTab } from './files.reducer';
import {
  selectDirectoryListing,
  selectDirectoryOperationLoading,
  selectFileContent,
  selectFileError,
  selectFileOperationLoading,
  selectFilesState,
  selectIsCreatingFile,
  selectIsDeletingFile,
  selectIsListingDirectory,
  selectIsMovingFile,
  selectIsReadingFile,
  selectIsWritingFile,
  selectOpenTabs,
  selectOpenTabsForClientAgent,
} from './files.selectors';
import type { FileContentDto, FileNodeDto } from './files.types';

describe('Files Selectors', () => {
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const filePath = 'test-file.txt';
  const directoryPath = '.';
  const fileKey = `${clientId}:${agentId}:app:${filePath}`;
  const directoryKey = `${clientId}:${agentId}:app:${directoryPath}`;
  const clientAgentKey = `${clientId}:${agentId}:app`;
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
  const mockOpenTabs: OpenTab[] = [
    { filePath: 'file1.txt', pinned: false },
    { filePath: 'file2.txt', pinned: true },
  ];
  const mockFilesState: FilesState = {
    fileContents: { [fileKey]: mockFileContent },
    directoryListings: { [directoryKey]: mockFileNodes },
    reading: { [fileKey]: true },
    writing: { [fileKey]: false },
    listing: { [directoryKey]: false },
    creating: { [fileKey]: false },
    deleting: { [fileKey]: false },
    moving: { [fileKey]: false },
    errors: { [fileKey]: null },
    openTabs: { [clientAgentKey]: mockOpenTabs },
  };

  describe('selectFilesState', () => {
    it('should select the files state', () => {
      const result = selectFilesState.projector(mockFilesState);

      expect(result).toEqual(mockFilesState);
    });
  });

  describe('selectFileContent', () => {
    it('should return file content when it exists', () => {
      const selector = selectFileContent(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.fileContents);

      expect(result).toEqual(mockFileContent);
    });

    it('should return null when file content does not exist', () => {
      const selector = selectFileContent(clientId, agentId, 'non-existent.txt');
      const result = selector.projector(mockFilesState.fileContents);

      expect(result).toBeNull();
    });

    it('should resolve config context keys separately from app', () => {
      const configKey = `${clientId}:${agentId}:config:${filePath}`;
      const configContent: FileContentDto = {
        content: Buffer.from('x', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      const fileContents = { ...mockFilesState.fileContents, [configKey]: configContent };
      const selector = selectFileContent(clientId, agentId, filePath, 'config');
      const result = selector.projector(fileContents);

      expect(result).toEqual(configContent);
    });
  });

  describe('selectIsReadingFile', () => {
    it('should return true when file is being read', () => {
      const selector = selectIsReadingFile(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.reading);

      expect(result).toBe(true);
    });

    it('should return false when file is not being read', () => {
      const selector = selectIsReadingFile(clientId, agentId, 'other-file.txt');
      const result = selector.projector(mockFilesState.reading);

      expect(result).toBe(false);
    });
  });

  describe('selectIsWritingFile', () => {
    it('should return true when file is being written', () => {
      const writingState = { [fileKey]: true };
      const selector = selectIsWritingFile(clientId, agentId, filePath);
      const result = selector.projector(writingState);

      expect(result).toBe(true);
    });

    it('should return false when file is not being written', () => {
      const selector = selectIsWritingFile(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.writing);

      expect(result).toBe(false);
    });
  });

  describe('selectDirectoryListing', () => {
    it('should return directory listing when it exists', () => {
      const selector = selectDirectoryListing(clientId, agentId, directoryPath);
      const result = selector.projector(mockFilesState.directoryListings);

      expect(result).toEqual(mockFileNodes);
    });

    it('should return null when directory listing does not exist', () => {
      const selector = selectDirectoryListing(clientId, agentId, 'non-existent');
      const result = selector.projector(mockFilesState.directoryListings);

      expect(result).toBeNull();
    });
  });

  describe('selectIsListingDirectory', () => {
    it('should return true when directory is being listed', () => {
      const listingState = { [directoryKey]: true };
      const selector = selectIsListingDirectory(clientId, agentId, directoryPath);
      const result = selector.projector(listingState);

      expect(result).toBe(true);
    });

    it('should return false when directory is not being listed', () => {
      const selector = selectIsListingDirectory(clientId, agentId, directoryPath);
      const result = selector.projector(mockFilesState.listing);

      expect(result).toBe(false);
    });
  });

  describe('selectIsCreatingFile', () => {
    it('should return true when file is being created', () => {
      const creatingState = { [fileKey]: true };
      const selector = selectIsCreatingFile(clientId, agentId, filePath);
      const result = selector.projector(creatingState);

      expect(result).toBe(true);
    });

    it('should return false when file is not being created', () => {
      const selector = selectIsCreatingFile(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.creating);

      expect(result).toBe(false);
    });
  });

  describe('selectIsDeletingFile', () => {
    it('should return true when file is being deleted', () => {
      const deletingState = { [fileKey]: true };
      const selector = selectIsDeletingFile(clientId, agentId, filePath);
      const result = selector.projector(deletingState);

      expect(result).toBe(true);
    });

    it('should return false when file is not being deleted', () => {
      const selector = selectIsDeletingFile(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.deleting);

      expect(result).toBe(false);
    });
  });

  describe('selectIsMovingFile', () => {
    it('should return true when file is being moved', () => {
      const movingState = { [fileKey]: true };
      const selector = selectIsMovingFile(clientId, agentId, filePath);
      const result = selector.projector(movingState);

      expect(result).toBe(true);
    });

    it('should return false when file is not being moved', () => {
      const selector = selectIsMovingFile(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.moving);

      expect(result).toBe(false);
    });
  });

  describe('selectFileError', () => {
    it('should return error when it exists', () => {
      const errorState = { [fileKey]: 'Test error' };
      const selector = selectFileError(clientId, agentId, filePath);
      const result = selector.projector(errorState);

      expect(result).toBe('Test error');
    });

    it('should return null when no error exists', () => {
      const selector = selectFileError(clientId, agentId, filePath);
      const result = selector.projector(mockFilesState.errors);

      expect(result).toBeNull();
    });
  });

  describe('selectFileOperationLoading', () => {
    it('should return true when any file operation is loading', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(true, false, false, false, false);

      expect(result).toBe(true);
    });

    it('should return true when writing', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(false, true, false, false, false);

      expect(result).toBe(true);
    });

    it('should return true when creating', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(false, false, true, false, false);

      expect(result).toBe(true);
    });

    it('should return true when deleting', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(false, false, false, true, false);

      expect(result).toBe(true);
    });

    it('should return true when moving', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(false, false, false, false, true);

      expect(result).toBe(true);
    });

    it('should return false when no file operation is loading', () => {
      const selector = selectFileOperationLoading(clientId, agentId, filePath);
      const result = selector.projector(false, false, false, false, false);

      expect(result).toBe(false);
    });
  });

  describe('selectDirectoryOperationLoading', () => {
    it('should return true when directory is being listed', () => {
      const selector = selectDirectoryOperationLoading(clientId, agentId, directoryPath);
      const result = selector.projector(true);

      expect(result).toBe(true);
    });

    it('should return false when directory is not being listed', () => {
      const selector = selectDirectoryOperationLoading(clientId, agentId, directoryPath);
      const result = selector.projector(false);

      expect(result).toBe(false);
    });
  });

  describe('selectOpenTabs', () => {
    it('should return open tabs state', () => {
      const result = selectOpenTabs.projector(mockFilesState);

      expect(result).toEqual(mockFilesState.openTabs);
    });

    it('should return empty object when no tabs exist', () => {
      const emptyState: FilesState = {
        ...mockFilesState,
        openTabs: {},
      };
      const result = selectOpenTabs.projector(emptyState);

      expect(result).toEqual({});
    });
  });

  describe('selectOpenTabsForClientAgent', () => {
    it('should return open tabs for specific client/agent', () => {
      const selector = selectOpenTabsForClientAgent(clientId, agentId);
      const result = selector.projector(mockFilesState.openTabs);

      expect(result).toEqual(mockOpenTabs);
    });

    it('should return empty array when no tabs exist for client/agent', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const selector = selectOpenTabsForClientAgent(clientId2, agentId2);
      const result = selector.projector(mockFilesState.openTabs);

      expect(result).toEqual([]);
    });

    it('should return empty array when openTabs is empty', () => {
      const selector = selectOpenTabsForClientAgent(clientId, agentId);
      const result = selector.projector({});

      expect(result).toEqual([]);
    });

    it('should handle multiple client/agent combinations independently', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const clientAgentKey2 = `${clientId2}:${agentId2}:app`;
      const mockOpenTabs2: OpenTab[] = [{ filePath: 'file3.txt', pinned: false }];
      const multiState = {
        ...mockFilesState.openTabs,
        [clientAgentKey2]: mockOpenTabs2,
      };
      const selector1 = selectOpenTabsForClientAgent(clientId, agentId);
      const selector2 = selectOpenTabsForClientAgent(clientId2, agentId2);
      const result1 = selector1.projector(multiState);
      const result2 = selector2.projector(multiState);

      expect(result1).toEqual(mockOpenTabs);
      expect(result2).toEqual(mockOpenTabs2);
    });
  });
});
