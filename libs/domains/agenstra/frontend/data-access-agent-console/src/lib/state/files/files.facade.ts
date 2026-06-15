import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

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
import type { OpenTab } from './files.reducer';
import {
  selectDirectoryListing,
  selectDirectoryOperationLoading,
  selectFileContent,
  selectFileError,
  selectFileOperationLoading,
  selectIsCreatingFile,
  selectIsDeletingFile,
  selectIsListingDirectory,
  selectIsMovingFile,
  selectIsReadingFile,
  selectIsWritingFile,
  selectOpenTabsForClientAgent,
} from './files.selectors';
import type {
  CreateFileDto,
  FileContentDto,
  FileManagerContext,
  FileNodeDto,
  ListDirectoryParams,
  MoveFileDto,
  WriteFileDto,
} from './files.types';

function withOptionalFileContext<T extends object>(
  payload: T,
  context?: FileManagerContext,
): T | (T & { context: FileManagerContext }) {
  return context === undefined ? payload : { ...payload, context };
}

/**
 * Facade for file system state management.
 * Provides a clean API for components to interact with file system state
 * without directly accessing the NgRx store.
 * All operations are scoped to a specific client and agent.
 */
@Injectable({
  providedIn: 'root',
})
export class FilesFacade {
  private readonly store = inject(Store);

  /**
   * Get file content for a specific client, agent, and file path.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path relative to /app
   * @returns Observable of file content or null if not loaded
   */
  getFileContent$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<FileContentDto | null> {
    return this.store.select(selectFileContent(clientId, agentId, filePath, context));
  }

  /**
   * Get directory listing for a specific client, agent, and directory path.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param directoryPath - The directory path relative to /app (defaults to '.')
   * @returns Observable of file nodes array or null if not loaded
   */
  getDirectoryListing$(
    clientId: string,
    agentId: string,
    directoryPath = '.',
    context?: FileManagerContext,
  ): Observable<FileNodeDto[] | null> {
    return this.store.select(selectDirectoryListing(clientId, agentId, directoryPath, context));
  }

  /**
   * Get loading state for reading a file.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of loading state
   */
  isReadingFile$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsReadingFile(clientId, agentId, filePath, context));
  }

  /**
   * Get loading state for writing a file.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of loading state
   */
  isWritingFile$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsWritingFile(clientId, agentId, filePath, context));
  }

  /**
   * Get loading state for listing a directory.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param directoryPath - The directory path
   * @returns Observable of loading state
   */
  isListingDirectory$(
    clientId: string,
    agentId: string,
    directoryPath = '.',
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsListingDirectory(clientId, agentId, directoryPath, context));
  }

  /**
   * Get loading state for creating a file/directory.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of loading state
   */
  isCreatingFile$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsCreatingFile(clientId, agentId, filePath, context));
  }

  /**
   * Get loading state for deleting a file/directory.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of loading state
   */
  isDeletingFile$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsDeletingFile(clientId, agentId, filePath, context));
  }

  /**
   * Get loading state for moving a file/directory.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of loading state
   */
  isMovingFile$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectIsMovingFile(clientId, agentId, filePath, context));
  }

  /**
   * Get combined loading state for any file operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of combined loading state
   */
  isFileOperationLoading$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectFileOperationLoading(clientId, agentId, filePath, context));
  }

  /**
   * Get combined loading state for directory operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param directoryPath - The directory path
   * @returns Observable of loading state
   */
  isDirectoryOperationLoading$(
    clientId: string,
    agentId: string,
    directoryPath = '.',
    context?: FileManagerContext,
  ): Observable<boolean> {
    return this.store.select(selectDirectoryOperationLoading(clientId, agentId, directoryPath, context));
  }

  /**
   * Get error state for a file operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   * @returns Observable of error message or null
   */
  getFileError$(
    clientId: string,
    agentId: string,
    filePath: string,
    context?: FileManagerContext,
  ): Observable<string | null> {
    return this.store.select(selectFileError(clientId, agentId, filePath, context));
  }

  /**
   * Read file content from agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path relative to /app
   */
  readFile(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(readFile(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Write file content to agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path relative to /app
   * @param writeFileDto - The file content to write (base64-encoded)
   */
  writeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    writeFileDto: WriteFileDto,
    context?: FileManagerContext,
  ): void {
    this.store.dispatch(writeFile(withOptionalFileContext({ clientId, agentId, filePath, writeFileDto }, context)));
  }

  /**
   * List directory contents in agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param params - Optional directory path
   */
  listDirectory(clientId: string, agentId: string, params?: ListDirectoryParams): void {
    this.store.dispatch(listDirectory({ clientId, agentId, params }));
  }

  /**
   * Create a file or directory in agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path relative to /app
   * @param createFileDto - The file/directory creation data
   */
  createFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    createFileDto: CreateFileDto,
    context?: FileManagerContext,
  ): void {
    this.store.dispatch(
      createFileOrDirectory(withOptionalFileContext({ clientId, agentId, filePath, createFileDto }, context)),
    );
  }

  /**
   * Delete a file or directory from agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path relative to /app
   */
  deleteFileOrDirectory(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(deleteFileOrDirectory(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Move a file or directory in agent container.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param sourcePath - The source file path relative to /app
   * @param moveFileDto - The move operation data (destination path)
   */
  moveFileOrDirectory(
    clientId: string,
    agentId: string,
    sourcePath: string,
    moveFileDto: MoveFileDto,
    context?: FileManagerContext,
  ): void {
    this.store.dispatch(
      moveFileOrDirectory(withOptionalFileContext({ clientId, agentId, sourcePath, moveFileDto }, context)),
    );
  }

  /**
   * Clear cached file content.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  clearFileContent(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(clearFileContent(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Clear cached directory listing.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param directoryPath - The directory path
   */
  clearDirectoryListing(clientId: string, agentId: string, directoryPath: string, context?: FileManagerContext): void {
    this.store.dispatch(clearDirectoryListing(withOptionalFileContext({ clientId, agentId, directoryPath }, context)));
  }

  /**
   * Get open tabs for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of open tabs array
   */
  getOpenTabs$(clientId: string, agentId: string, context?: FileManagerContext): Observable<OpenTab[]> {
    return this.store.select(selectOpenTabsForClientAgent(clientId, agentId, context));
  }

  /**
   * Open a file tab.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  openFileTab(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(openFileTab(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Close a file tab.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  closeFileTab(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(closeFileTab(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Pin a file tab (make it stay open).
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  pinFileTab(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(pinFileTab(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Unpin a file tab.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  unpinFileTab(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(unpinFileTab(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Move a tab to the front of the tabs list.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param filePath - The file path
   */
  moveTabToFront(clientId: string, agentId: string, filePath: string, context?: FileManagerContext): void {
    this.store.dispatch(moveTabToFront(withOptionalFileContext({ clientId, agentId, filePath }, context)));
  }

  /**
   * Clear all open tabs for a client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  clearOpenTabs(clientId: string, agentId: string, context?: FileManagerContext): void {
    this.store.dispatch(clearOpenTabs(withOptionalFileContext({ clientId, agentId }, context)));
  }
}
