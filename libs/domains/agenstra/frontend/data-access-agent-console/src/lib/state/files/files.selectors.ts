import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { FilesState } from './files.reducer';
import type { FileManagerContext } from './files.types';

export const selectFilesState = createFeatureSelector<FilesState>('files');

// Base selectors
export const selectFileContents = createSelector(selectFilesState, (state) => state.fileContents);
export const selectDirectoryListings = createSelector(selectFilesState, (state) => state.directoryListings);
export const selectFilesReading = createSelector(selectFilesState, (state) => state.reading);
export const selectFilesWriting = createSelector(selectFilesState, (state) => state.writing);
export const selectFilesListing = createSelector(selectFilesState, (state) => state.listing);
export const selectFilesCreating = createSelector(selectFilesState, (state) => state.creating);
export const selectFilesDeleting = createSelector(selectFilesState, (state) => state.deleting);
export const selectFilesMoving = createSelector(selectFilesState, (state) => state.moving);
export const selectFilesErrors = createSelector(selectFilesState, (state) => state.errors);

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

// File content selectors (factory functions)
export const selectFileContent = (clientId: string, agentId: string, filePath: string, context?: FileManagerContext) =>
  createSelector(selectFileContents, (fileContents) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return fileContents[key] ?? null;
  });

export const selectIsReadingFile = (
  clientId: string,
  agentId: string,
  filePath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectFilesReading, (reading) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return reading[key] ?? false;
  });

export const selectIsWritingFile = (
  clientId: string,
  agentId: string,
  filePath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectFilesWriting, (writing) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return writing[key] ?? false;
  });

// Directory listing selectors (factory functions)
export const selectDirectoryListing = (
  clientId: string,
  agentId: string,
  directoryPath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectDirectoryListings, (directoryListings) => {
    const key = getFileKey(clientId, agentId, directoryPath, context);

    return directoryListings[key] ?? null;
  });

export const selectIsListingDirectory = (
  clientId: string,
  agentId: string,
  directoryPath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectFilesListing, (listing) => {
    const key = getFileKey(clientId, agentId, directoryPath, context);

    return listing[key] ?? false;
  });

// Create/Delete selectors (factory functions)
export const selectIsCreatingFile = (
  clientId: string,
  agentId: string,
  filePath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectFilesCreating, (creating) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return creating[key] ?? false;
  });

export const selectIsDeletingFile = (
  clientId: string,
  agentId: string,
  filePath: string,
  context?: FileManagerContext,
) =>
  createSelector(selectFilesDeleting, (deleting) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return deleting[key] ?? false;
  });

export const selectIsMovingFile = (clientId: string, agentId: string, filePath: string, context?: FileManagerContext) =>
  createSelector(selectFilesMoving, (moving) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return moving[key] ?? false;
  });

// Error selectors (factory functions)
export const selectFileError = (clientId: string, agentId: string, filePath: string, context?: FileManagerContext) =>
  createSelector(selectFilesErrors, (errors) => {
    const key = getFileKey(clientId, agentId, filePath, context);

    return errors[key] ?? null;
  });

// Combined loading selector for a specific file operation
export const selectFileOperationLoading = (
  clientId: string,
  agentId: string,
  filePath: string,
  context?: FileManagerContext,
) =>
  createSelector(
    selectIsReadingFile(clientId, agentId, filePath, context),
    selectIsWritingFile(clientId, agentId, filePath, context),
    selectIsCreatingFile(clientId, agentId, filePath, context),
    selectIsDeletingFile(clientId, agentId, filePath, context),
    selectIsMovingFile(clientId, agentId, filePath, context),
    (reading, writing, creating, deleting, moving) => reading || writing || creating || deleting || moving,
  );

// Combined loading selector for a specific directory operation
export const selectDirectoryOperationLoading = (
  clientId: string,
  agentId: string,
  directoryPath: string,
  context?: FileManagerContext,
) => createSelector(selectIsListingDirectory(clientId, agentId, directoryPath, context), (listing) => listing);

// Open tabs selectors
export const selectOpenTabs = createSelector(selectFilesState, (state) => state.openTabs);

/**
 * Get open tabs for a specific client and agent.
 * @param clientId - The client ID
 * @param agentId - The agent ID
 * @returns Selector that returns array of open tabs
 */
export const selectOpenTabsForClientAgent = (clientId: string, agentId: string, context?: FileManagerContext) =>
  createSelector(selectOpenTabs, (openTabs) => {
    const c = resolveFileContext(context);
    const key = `${clientId}:${agentId}:${c}`;

    return openTabs[key] || [];
  });
