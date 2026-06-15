import { createReducer, on } from '@ngrx/store';

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
import type { FileContentDto, FileManagerContext, FileNodeDto } from './files.types';

export interface OpenTab {
  filePath: string;
  pinned: boolean;
}

export interface FilesState {
  // File contents keyed by clientId:agentId:filePath
  fileContents: Record<string, FileContentDto>;
  // Directory listings keyed by clientId:agentId:directoryPath
  directoryListings: Record<string, FileNodeDto[]>;
  // Loading states keyed by clientId:agentId:filePath or clientId:agentId:directoryPath
  reading: Record<string, boolean>;
  writing: Record<string, boolean>;
  listing: Record<string, boolean>;
  creating: Record<string, boolean>;
  deleting: Record<string, boolean>;
  moving: Record<string, boolean>;
  // Errors keyed by clientId:agentId:filePath or clientId:agentId:directoryPath
  errors: Record<string, string | null>;
  // Open tabs keyed by clientId:agentId
  openTabs: Record<string, OpenTab[]>;
}

export const initialFilesState: FilesState = {
  fileContents: {},
  directoryListings: {},
  reading: {},
  writing: {},
  listing: {},
  creating: {},
  deleting: {},
  moving: {},
  errors: {},
  openTabs: {},
};

function resolveFileContext(context?: FileManagerContext): FileManagerContext {
  return context ?? 'app';
}

/**
 * Generate a key for file operations (clientId:agentId:context:path)
 */
function getFileKey(clientId: string, agentId: string, path: string, context?: FileManagerContext): string {
  const c = resolveFileContext(context);

  return `${clientId}:${agentId}:${c}:${path}`;
}

/**
 * Generate a key for client/agent + context (tabs and grouped state)
 */
function getClientAgentContextKey(clientId: string, agentId: string, context?: FileManagerContext): string {
  const c = resolveFileContext(context);

  return `${clientId}:${agentId}:${c}`;
}

export const filesReducer = createReducer(
  initialFilesState,
  // Read File
  on(readFile, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      reading: { ...state.reading, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(readFileSuccess, (state, { clientId, agentId, filePath, content, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      fileContents: { ...state.fileContents, [key]: content },
      reading: { ...state.reading, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(readFileFailure, (state, { clientId, agentId, filePath, error, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      reading: { ...state.reading, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Write File
  on(writeFile, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      writing: { ...state.writing, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(writeFileSuccess, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);
    const clientAgentKey = getClientAgentContextKey(clientId, agentId, context);
    // Invalidate cached content after write
    const { [key]: _, ...fileContents } = state.fileContents;
    // Pin the tab when file is saved (create tab if it doesn't exist)
    const currentTabs = state.openTabs[clientAgentKey] || [];
    const existingTabIndex = currentTabs.findIndex((tab) => tab.filePath === filePath);
    let updatedTabs: OpenTab[];

    if (existingTabIndex >= 0) {
      // Update existing tab to pinned
      updatedTabs = currentTabs.map((tab) => (tab.filePath === filePath ? { ...tab, pinned: true } : tab));
    } else {
      // Create new pinned tab
      updatedTabs = [...currentTabs, { filePath, pinned: true }];
    }

    return {
      ...state,
      fileContents,
      writing: { ...state.writing, [key]: false },
      errors: { ...state.errors, [key]: null },
      openTabs: {
        ...state.openTabs,
        [clientAgentKey]: updatedTabs,
      },
    };
  }),
  on(writeFileFailure, (state, { clientId, agentId, filePath, error, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      writing: { ...state.writing, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // List Directory
  on(listDirectory, (state, { clientId, agentId, params }) => {
    const directoryPath = params?.path || '.';
    const key = getFileKey(clientId, agentId, directoryPath, params?.context);

    return {
      ...state,
      listing: { ...state.listing, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(listDirectorySuccess, (state, { clientId, agentId, directoryPath, files, context }) => {
    const key = getFileKey(clientId, agentId, directoryPath, context);

    return {
      ...state,
      directoryListings: { ...state.directoryListings, [key]: files },
      listing: { ...state.listing, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(listDirectoryFailure, (state, { clientId, agentId, directoryPath, error, context }) => {
    const key = getFileKey(clientId, agentId, directoryPath, context);

    return {
      ...state,
      listing: { ...state.listing, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Create File/Directory
  on(createFileOrDirectory, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      creating: { ...state.creating, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createFileOrDirectorySuccess, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);
    // Invalidate parent directory listing
    const parentPath = filePath.split('/').slice(0, -1).join('/') || '.';
    const parentKey = getFileKey(clientId, agentId, parentPath, context);
    const { [parentKey]: _, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      directoryListings,
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createFileOrDirectoryFailure, (state, { clientId, agentId, filePath, error, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Delete File/Directory
  on(deleteFileOrDirectory, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteFileOrDirectorySuccess, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);
    // Remove from cache
    const { [key]: _, ...fileContents } = state.fileContents;
    const { [key]: __, ...directoryListings } = state.directoryListings;
    // Invalidate parent directory listing
    const parentPath = filePath.split('/').slice(0, -1).join('/') || '.';
    const parentKey = getFileKey(clientId, agentId, parentPath, context);
    const { [parentKey]: ___, ...remainingListings } = directoryListings;

    return {
      ...state,
      fileContents,
      directoryListings: remainingListings,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteFileOrDirectoryFailure, (state, { clientId, agentId, filePath, error, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Move File/Directory
  on(moveFileOrDirectory, (state, { clientId, agentId, sourcePath, context }) => {
    const key = getFileKey(clientId, agentId, sourcePath, context);

    return {
      ...state,
      moving: { ...state.moving, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(moveFileOrDirectorySuccess, (state, { clientId, agentId, sourcePath, destinationPath, context }) => {
    const sourceKey = getFileKey(clientId, agentId, sourcePath, context);
    const destinationKey = getFileKey(clientId, agentId, destinationPath, context);
    // Remove source file content from cache
    const { [sourceKey]: removedSourceContent, ...fileContents } = state.fileContents;
    // Move file content to destination if it exists
    const updatedFileContents = removedSourceContent
      ? { ...fileContents, [destinationKey]: removedSourceContent }
      : fileContents;
    // Remove source and destination directory listings (invalidate cache)
    const sourceParentPath = sourcePath.split('/').slice(0, -1).join('/') || '.';
    const sourceParentKey = getFileKey(clientId, agentId, sourceParentPath, context);
    const destinationParentPath = destinationPath.split('/').slice(0, -1).join('/') || '.';
    const destinationParentKey = getFileKey(clientId, agentId, destinationParentPath, context);
    const { [sourceParentKey]: _, [destinationParentKey]: __, ...directoryListings } = state.directoryListings;
    // Update open tabs if the moved file is in a tab
    const clientAgentKey = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[clientAgentKey] || [];
    const updatedTabs = currentTabs.map((tab) =>
      tab.filePath === sourcePath ? { ...tab, filePath: destinationPath } : tab,
    );

    return {
      ...state,
      fileContents: updatedFileContents,
      directoryListings,
      moving: { ...state.moving, [sourceKey]: false },
      errors: { ...state.errors, [sourceKey]: null },
      openTabs: {
        ...state.openTabs,
        [clientAgentKey]: updatedTabs,
      },
    };
  }),
  on(moveFileOrDirectoryFailure, (state, { clientId, agentId, sourcePath, error, context }) => {
    const key = getFileKey(clientId, agentId, sourcePath, context);

    return {
      ...state,
      moving: { ...state.moving, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Clear File Content
  on(clearFileContent, (state, { clientId, agentId, filePath, context }) => {
    const key = getFileKey(clientId, agentId, filePath, context);
    const { [key]: _, ...fileContents } = state.fileContents;

    return {
      ...state,
      fileContents,
    };
  }),
  // Clear Directory Listing
  on(clearDirectoryListing, (state, { clientId, agentId, directoryPath, context }) => {
    const key = getFileKey(clientId, agentId, directoryPath, context);
    const { [key]: _, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      directoryListings,
    };
  }),
  // Open File Tab
  on(openFileTab, (state, { clientId, agentId, filePath, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[key] || [];
    // Keep only pinned tabs, remove all unpinned tabs
    const pinnedTabs = currentTabs.filter((tab) => tab.pinned);
    // Check if the tab being opened already exists (and is pinned)
    const existingTab = pinnedTabs.find((tab) => tab.filePath === filePath);

    if (existingTab) {
      // Tab already exists and is pinned, no change needed
      return state;
    }

    // Add new tab (unpinned by default) - unpinned tabs will be removed when another file is opened
    return {
      ...state,
      openTabs: {
        ...state.openTabs,
        [key]: [...pinnedTabs, { filePath, pinned: false }],
      },
    };
  }),
  // Close File Tab
  on(closeFileTab, (state, { clientId, agentId, filePath, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[key] || [];
    const updatedTabs = currentTabs.filter((tab) => tab.filePath !== filePath);

    return {
      ...state,
      openTabs: {
        ...state.openTabs,
        [key]: updatedTabs,
      },
    };
  }),
  // Pin File Tab
  on(pinFileTab, (state, { clientId, agentId, filePath, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[key] || [];
    const updatedTabs = currentTabs.map((tab) => (tab.filePath === filePath ? { ...tab, pinned: true } : tab));

    return {
      ...state,
      openTabs: {
        ...state.openTabs,
        [key]: updatedTabs,
      },
    };
  }),
  // Unpin File Tab
  on(unpinFileTab, (state, { clientId, agentId, filePath, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[key] || [];
    const updatedTabs = currentTabs.map((tab) => (tab.filePath === filePath ? { ...tab, pinned: false } : tab));

    return {
      ...state,
      openTabs: {
        ...state.openTabs,
        [key]: updatedTabs,
      },
    };
  }),
  // Move Tab To Front
  on(moveTabToFront, (state, { clientId, agentId, filePath, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const currentTabs = state.openTabs[key] || [];
    const tabIndex = currentTabs.findIndex((tab) => tab.filePath === filePath);

    if (tabIndex === -1 || tabIndex === 0) {
      // Tab not found or already at front
      return state;
    }

    const tab = currentTabs[tabIndex];
    const updatedTabs = [tab, ...currentTabs.filter((_, index) => index !== tabIndex)];

    return {
      ...state,
      openTabs: {
        ...state.openTabs,
        [key]: updatedTabs,
      },
    };
  }),
  // Clear Open Tabs
  on(clearOpenTabs, (state, { clientId, agentId, context }) => {
    const key = getClientAgentContextKey(clientId, agentId, context);
    const { [key]: _, ...openTabs } = state.openTabs;

    return {
      ...state,
      openTabs,
    };
  }),
);
