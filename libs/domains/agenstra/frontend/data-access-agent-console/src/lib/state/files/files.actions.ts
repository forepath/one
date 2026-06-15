import { createAction, props } from '@ngrx/store';

import type {
  CreateFileDto,
  FileContentDto,
  FileManagerContext,
  FileNodeDto,
  ListDirectoryParams,
  MoveFileDto,
  WriteFileDto,
} from './files.types';

// Read File Actions
export const readFile = createAction(
  '[Files] Read File',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const readFileSuccess = createAction(
  '[Files] Read File Success',
  props<{
    clientId: string;
    agentId: string;
    filePath: string;
    content: FileContentDto;
    context?: FileManagerContext;
  }>(),
);

export const readFileFailure = createAction(
  '[Files] Read File Failure',
  props<{ clientId: string; agentId: string; filePath: string; error: string; context?: FileManagerContext }>(),
);

// Write File Actions
export const writeFile = createAction(
  '[Files] Write File',
  props<{
    clientId: string;
    agentId: string;
    filePath: string;
    writeFileDto: WriteFileDto;
    context?: FileManagerContext;
  }>(),
);

export const writeFileSuccess = createAction(
  '[Files] Write File Success',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const writeFileFailure = createAction(
  '[Files] Write File Failure',
  props<{ clientId: string; agentId: string; filePath: string; error: string; context?: FileManagerContext }>(),
);

// List Directory Actions
export const listDirectory = createAction(
  '[Files] List Directory',
  props<{ clientId: string; agentId: string; params?: ListDirectoryParams }>(),
);

export const listDirectorySuccess = createAction(
  '[Files] List Directory Success',
  props<{
    clientId: string;
    agentId: string;
    directoryPath: string;
    files: FileNodeDto[];
    context?: FileManagerContext;
  }>(),
);

export const listDirectoryFailure = createAction(
  '[Files] List Directory Failure',
  props<{
    clientId: string;
    agentId: string;
    directoryPath: string;
    error: string;
    context?: FileManagerContext;
  }>(),
);

// Create File/Directory Actions
export const createFileOrDirectory = createAction(
  '[Files] Create File Or Directory',
  props<{
    clientId: string;
    agentId: string;
    filePath: string;
    createFileDto: CreateFileDto;
    context?: FileManagerContext;
  }>(),
);

export const createFileOrDirectorySuccess = createAction(
  '[Files] Create File Or Directory Success',
  props<{
    clientId: string;
    agentId: string;
    filePath: string;
    fileType: 'file' | 'directory';
    context?: FileManagerContext;
  }>(),
);

export const createFileOrDirectoryFailure = createAction(
  '[Files] Create File Or Directory Failure',
  props<{ clientId: string; agentId: string; filePath: string; error: string; context?: FileManagerContext }>(),
);

// Delete File/Directory Actions
export const deleteFileOrDirectory = createAction(
  '[Files] Delete File Or Directory',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const deleteFileOrDirectorySuccess = createAction(
  '[Files] Delete File Or Directory Success',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const deleteFileOrDirectoryFailure = createAction(
  '[Files] Delete File Or Directory Failure',
  props<{ clientId: string; agentId: string; filePath: string; error: string; context?: FileManagerContext }>(),
);

// Move File/Directory Actions
export const moveFileOrDirectory = createAction(
  '[Files] Move File Or Directory',
  props<{
    clientId: string;
    agentId: string;
    sourcePath: string;
    moveFileDto: MoveFileDto;
    context?: FileManagerContext;
  }>(),
);

export const moveFileOrDirectorySuccess = createAction(
  '[Files] Move File Or Directory Success',
  props<{
    clientId: string;
    agentId: string;
    sourcePath: string;
    destinationPath: string;
    context?: FileManagerContext;
  }>(),
);

export const moveFileOrDirectoryFailure = createAction(
  '[Files] Move File Or Directory Failure',
  props<{ clientId: string; agentId: string; sourcePath: string; error: string; context?: FileManagerContext }>(),
);

// Clear file content from cache
export const clearFileContent = createAction(
  '[Files] Clear File Content',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

// Clear directory listing from cache
export const clearDirectoryListing = createAction(
  '[Files] Clear Directory Listing',
  props<{ clientId: string; agentId: string; directoryPath: string; context?: FileManagerContext }>(),
);

// Open Tabs Management Actions
export const openFileTab = createAction(
  '[Files] Open File Tab',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const closeFileTab = createAction(
  '[Files] Close File Tab',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const pinFileTab = createAction(
  '[Files] Pin File Tab',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const unpinFileTab = createAction(
  '[Files] Unpin File Tab',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const moveTabToFront = createAction(
  '[Files] Move Tab To Front',
  props<{ clientId: string; agentId: string; filePath: string; context?: FileManagerContext }>(),
);

export const clearOpenTabs = createAction(
  '[Files] Clear Open Tabs',
  props<{ clientId: string; agentId: string; context?: FileManagerContext }>(),
);
