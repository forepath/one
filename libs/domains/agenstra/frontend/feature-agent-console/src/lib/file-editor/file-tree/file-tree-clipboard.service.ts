import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FilesFacade,
  FilesService,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  deleteFileOrDirectoryFailure,
  deleteFileOrDirectorySuccess,
  moveFileOrDirectoryFailure,
  moveFileOrDirectorySuccess,
  writeFileFailure,
  writeFileSuccess,
  type FileManagerContext,
  type FileNodeDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions, ofType } from '@ngrx/effects';
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  filter,
  finalize,
  firstValueFrom,
  from,
  map,
  of,
  take,
} from 'rxjs';

import {
  type FileTreeClipboardEntry,
  type FileTreeClipboardState,
  resolveCutDestinationPath,
  wouldMoveDirectoryIntoSelf,
} from './file-tree-clipboard.util';
import { getParentPath, getPathBasename, joinFileTreePath, suggestCopyBasename } from './file-tree-selection.util';

export interface FileTreeBatchContext {
  clientId: string;
  agentId: string;
  context: FileManagerContext;
}

export interface FileTreePasteMove {
  source: string;
  destination: string;
  type: 'file' | 'directory';
}

export interface FileTreePasteResult {
  mode: 'copy' | 'cut';
  destinations: string[];
  moves: FileTreePasteMove[];
}

/** Resolves copy/upload collisions: replace existing file or keep both with a numbered name. */
export type FileTreeNameCollisionChoice = 'replace' | 'keepBoth';

export type FileTreeResolveNameCollision = (
  baseName: string,
  existingType: 'file' | 'directory',
) => Promise<FileTreeNameCollisionChoice>;

@Injectable()
export class FileTreeClipboardService {
  private readonly filesFacade = inject(FilesFacade);
  private readonly filesService = inject(FilesService);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly clipboard = signal<FileTreeClipboardState | null>(null);
  readonly busy = signal(false);
  readonly lastError = signal<string | null>(null);

  private readonly queue$ = new Subject<() => Observable<unknown>>();
  private resolveNameCollision: FileTreeResolveNameCollision | null = null;

  constructor() {
    this.queue$
      .pipe(
        concatMap((run) => {
          this.busy.set(true);
          this.lastError.set(null);

          return run().pipe(
            catchError((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);

              this.lastError.set(message);

              return of(null);
            }),
            finalize(() => this.busy.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /** Optional prompt used for copy-paste file name collisions (replace vs keep both). */
  setNameCollisionResolver(resolver: FileTreeResolveNameCollision | null): void {
    this.resolveNameCollision = resolver;
  }

  setClipboard(mode: 'copy' | 'cut', entries: FileTreeClipboardEntry[]): void {
    if (entries.length === 0) {
      this.clipboard.set(null);

      return;
    }

    this.clipboard.set({ mode, entries: [...entries] });
  }

  clearClipboard(): void {
    this.clipboard.set(null);
  }

  enqueueDelete(batch: FileTreeBatchContext, paths: string[], onDone?: (deleted: string[]) => void): void {
    this.enqueue(() =>
      from(this.runDelete(batch, paths)).pipe(
        map((deleted) => {
          onDone?.(deleted);

          return deleted;
        }),
      ),
    );
  }

  enqueuePaste(
    batch: FileTreeBatchContext,
    targetDirectory: string,
    onDone?: (result: FileTreePasteResult) => void,
  ): void {
    const state = this.clipboard();

    if (!state || state.entries.length === 0) {
      return;
    }

    this.enqueue(() =>
      from(this.runPaste(batch, targetDirectory, state)).pipe(
        map((result) => {
          if (state.mode === 'cut') {
            this.clearClipboard();
          }

          onDone?.(result);

          return result;
        }),
      ),
    );
  }

  private enqueue(run: () => Observable<unknown>): void {
    this.queue$.next(run);
  }

  private async runDelete(batch: FileTreeBatchContext, paths: string[]): Promise<string[]> {
    const deleted: string[] = [];

    for (const path of paths) {
      await this.awaitFacadeDelete(batch, path);
      deleted.push(path);
      this.refreshParent(batch, path);
    }

    return deleted;
  }

  private async runPaste(
    batch: FileTreeBatchContext,
    targetDirectory: string,
    state: FileTreeClipboardState,
  ): Promise<FileTreePasteResult> {
    const destinations: string[] = [];
    const moves: FileTreePasteMove[] = [];
    const siblings = await this.listDirectoryEntries(batch, targetDirectory);

    for (const entry of state.entries) {
      if (state.mode === 'cut') {
        if (entry.type === 'directory' && wouldMoveDirectoryIntoSelf(entry.path, targetDirectory)) {
          throw new Error(`Cannot move "${entry.path}" into itself`);
        }

        const destination = resolveCutDestinationPath(entry, targetDirectory, siblings.keys());

        if (destination === entry.path) {
          continue;
        }

        await this.awaitFacadeMove(batch, entry.path, destination);
        destinations.push(destination);
        moves.push({ source: entry.path, destination, type: entry.type });
        siblings.set(getPathBasename(destination), entry.type);
        this.refreshParent(batch, entry.path);
        this.refreshListing(batch, targetDirectory);

        if (entry.type === 'directory') {
          this.refreshListing(batch, destination);
        }
      } else {
        const pastePlan = await this.resolveCopyPastePlan(entry, targetDirectory, siblings);

        if (pastePlan.mode === 'replace') {
          await this.replaceFileAtDestination(batch, entry, pastePlan.destination);
        } else {
          await this.copyEntryRecursive(batch, entry, pastePlan.destination);
        }

        destinations.push(pastePlan.destination);
        moves.push({ source: entry.path, destination: pastePlan.destination, type: entry.type });
        siblings.set(getPathBasename(pastePlan.destination), entry.type);
        this.refreshListing(batch, targetDirectory);

        if (entry.type === 'directory') {
          this.refreshListing(batch, pastePlan.destination);
        }
      }
    }

    return { mode: state.mode, destinations, moves };
  }

  private async resolveCopyPastePlan(
    entry: FileTreeClipboardEntry,
    targetDirectory: string,
    siblings: Map<string, 'file' | 'directory'>,
  ): Promise<{ mode: 'create' | 'replace'; destination: string }> {
    const baseName = getPathBasename(entry.path);
    const existingType = this.findSiblingType(siblings, baseName);

    if (!existingType) {
      return { mode: 'create', destination: joinFileTreePath(targetDirectory, baseName) };
    }

    if (existingType === 'directory' || entry.type === 'directory') {
      const uniqueName = suggestCopyBasename(baseName, siblings.keys());

      return { mode: 'create', destination: joinFileTreePath(targetDirectory, uniqueName) };
    }

    const choice = this.resolveNameCollision ? await this.resolveNameCollision(baseName, existingType) : 'keepBoth';

    if (choice === 'replace') {
      return { mode: 'replace', destination: joinFileTreePath(targetDirectory, baseName) };
    }

    const uniqueName = suggestCopyBasename(baseName, siblings.keys());

    return { mode: 'create', destination: joinFileTreePath(targetDirectory, uniqueName) };
  }

  private findSiblingType(siblings: Map<string, 'file' | 'directory'>, baseName: string): 'file' | 'directory' | null {
    const lower = baseName.toLowerCase();

    for (const [name, type] of siblings) {
      if (name.toLowerCase() === lower) {
        return type;
      }
    }

    return null;
  }

  private async replaceFileAtDestination(
    batch: FileTreeBatchContext,
    entry: FileTreeClipboardEntry,
    destination: string,
  ): Promise<void> {
    const content = await firstValueFrom(
      this.filesService.readFile(batch.clientId, batch.agentId, entry.path, batch.context),
    );

    await this.awaitFacadeWrite(batch, destination, { content: content.content });
  }

  private async copyEntryRecursive(
    batch: FileTreeBatchContext,
    entry: FileTreeClipboardEntry,
    destination: string,
  ): Promise<void> {
    if (entry.type === 'file') {
      const content = await firstValueFrom(
        this.filesService.readFile(batch.clientId, batch.agentId, entry.path, batch.context),
      );

      await this.awaitFacadeCreate(batch, destination, {
        type: 'file',
        content: content.content,
      });

      return;
    }

    await this.awaitFacadeCreate(batch, destination, { type: 'directory' });

    const children = await firstValueFrom(
      this.filesService.listDirectory(batch.clientId, batch.agentId, {
        path: entry.path,
        ...(batch.context === 'config' ? { context: 'config' as const } : {}),
      }),
    );

    for (const child of children) {
      const childDest = joinFileTreePath(destination, child.name);

      await this.copyEntryRecursive(batch, { path: child.path, type: child.type }, childDest);
    }
  }

  private async listDirectoryEntries(
    batch: FileTreeBatchContext,
    directoryPath: string,
  ): Promise<Map<string, 'file' | 'directory'>> {
    try {
      const nodes = await firstValueFrom(
        this.filesService.listDirectory(batch.clientId, batch.agentId, {
          path: directoryPath === '.' ? undefined : directoryPath,
          ...(batch.context === 'config' ? { context: 'config' as const } : {}),
        }),
      );

      return new Map(nodes.map((node: FileNodeDto) => [node.name, node.type]));
    } catch {
      return new Map();
    }
  }

  private awaitFacadeDelete(batch: FileTreeBatchContext, filePath: string): Promise<void> {
    this.filesFacade.deleteFileOrDirectory(batch.clientId, batch.agentId, filePath, batch.context);

    return firstValueFrom(
      this.actions$.pipe(
        ofType(deleteFileOrDirectorySuccess, deleteFileOrDirectoryFailure),
        filter(
          (action) =>
            action.clientId === batch.clientId && action.agentId === batch.agentId && action.filePath === filePath,
        ),
        take(1),
        map((action) => {
          if (action.type === deleteFileOrDirectoryFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );
  }

  private awaitFacadeCreate(
    batch: FileTreeBatchContext,
    filePath: string,
    dto: { type: 'file' | 'directory'; content?: string },
  ): Promise<void> {
    this.filesFacade.createFileOrDirectory(batch.clientId, batch.agentId, filePath, dto, batch.context);

    return firstValueFrom(
      this.actions$.pipe(
        ofType(createFileOrDirectorySuccess, createFileOrDirectoryFailure),
        filter(
          (action) =>
            action.clientId === batch.clientId && action.agentId === batch.agentId && action.filePath === filePath,
        ),
        take(1),
        map((action) => {
          if (action.type === createFileOrDirectoryFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );
  }

  private awaitFacadeWrite(batch: FileTreeBatchContext, filePath: string, dto: { content: string }): Promise<void> {
    this.filesFacade.writeFile(batch.clientId, batch.agentId, filePath, dto, batch.context);

    return firstValueFrom(
      this.actions$.pipe(
        ofType(writeFileSuccess, writeFileFailure),
        filter(
          (action) =>
            action.clientId === batch.clientId && action.agentId === batch.agentId && action.filePath === filePath,
        ),
        take(1),
        map((action) => {
          if (action.type === writeFileFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );
  }

  private awaitFacadeMove(batch: FileTreeBatchContext, sourcePath: string, destination: string): Promise<void> {
    this.filesFacade.moveFileOrDirectory(batch.clientId, batch.agentId, sourcePath, { destination }, batch.context);

    return firstValueFrom(
      this.actions$.pipe(
        ofType(moveFileOrDirectorySuccess, moveFileOrDirectoryFailure),
        filter(
          (action) =>
            action.clientId === batch.clientId && action.agentId === batch.agentId && action.sourcePath === sourcePath,
        ),
        take(1),
        map((action) => {
          if (action.type === moveFileOrDirectoryFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );
  }

  private refreshParent(batch: FileTreeBatchContext, path: string): void {
    const parent = getParentPath(path);

    this.refreshListing(batch, parent);
  }

  private refreshListing(batch: FileTreeBatchContext, path: string): void {
    this.filesFacade.listDirectory(
      batch.clientId,
      batch.agentId,
      batch.context === 'config' ? { path, context: 'config' } : { path },
    );
  }
}
