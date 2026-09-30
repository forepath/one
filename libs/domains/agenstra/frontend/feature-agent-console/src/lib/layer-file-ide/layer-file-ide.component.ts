import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  OpencodeLayerFilesService,
  type OpencodeLayerFileDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcEmptyStateComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Observable, Subject, of } from 'rxjs';
import { catchError, debounceTime, take } from 'rxjs/operators';

import { MonacoEditorWrapperComponent } from '../file-editor/monaco-editor-wrapper/monaco-editor-wrapper.component';
import { LayerFileTreeComponent } from './layer-file-tree.component';

/**
 * Layer VFS IDE: expandable tree + Monaco for global/workspace paths (no agentId / NgRx).
 */
@Component({
  selector: 'framework-layer-file-ide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcEmptyStateComponent,
    FpcSpinnerComponent,
    MonacoEditorWrapperComponent,
    LayerFileTreeComponent,
  ],
  template: `
    <div class="layer-file-ide d-flex flex-column gap-2">
      <div class="small text-muted text-truncate">
        <span i18n="@@featureAgentConfig-layerFilePathLabel">Path</span>:
        <code>{{ displayPath() }}</code>
      </div>

      @if (error(); as err) {
        <fpc-alert variant="danger">{{ err }}</fpc-alert>
      }

      <div class="layer-file-ide__body d-flex border rounded overflow-hidden">
        <aside class="layer-file-ide__tree border-end">
          @if (bootstrapping()) {
            <div class="d-flex justify-content-center py-3">
              <fpc-spinner />
            </div>
          } @else {
            <framework-layer-file-tree
              class="h-100"
              [scope]="scope()"
              [clientId]="clientId()"
              [treeRoot]="treeRoot()"
              [openPath]="selectedPath()"
              [initialExpandPaths]="initialExpandPaths()"
              (fileSelect)="onFileSelect($event)"
              (treeError)="onTreeError($event)"
              (openPathRemoved)="onOpenPathRemoved($event)"
            />
          }
        </aside>
        <section class="layer-file-ide__editor flex-grow-1 min-w-0 d-flex flex-column">
          @if (editorLoading()) {
            <div class="d-flex justify-content-center py-4">
              <fpc-spinner />
            </div>
          } @else if (selectedPath(); as path) {
            <framework-monaco-editor-wrapper
              class="flex-grow-1 min-h-0"
              [filePath]="path"
              fileType="text"
              [text]="content()"
              [isDirty]="dirty()"
              [autosaveEnabled]="autosaveEnabled()"
              [showSaveActions]="true"
              [showDownload]="false"
              [saving]="saving()"
              autosaveCheckId="layerFileAutosaveCheckbox"
              (contentChange)="onContentChange($event)"
              (saveRequest)="save()"
              (autosaveEnabledChange)="onAutosaveEnabledChange($event)"
            />
          } @else {
            <fpc-empty-state
              icon="file-earmark"
              message="Select a file or create one in this folder"
              i18n-message="@@featureAgentConfig-layerFilePickFile"
            />
          }
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .layer-file-ide__body {
        min-height: 28rem;
        height: min(70vh, 36rem);
      }

      .layer-file-ide__tree {
        width: 16rem;
        flex: 0 0 16rem;
        min-width: 0;
        overflow: hidden;
        background: var(--bs-body-bg);
      }

      .layer-file-ide__editor {
        min-width: 0;
        min-height: 0;
        height: 100%;
      }

      :host ::ng-deep framework-layer-file-tree {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      :host ::ng-deep framework-monaco-editor-wrapper {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }
    `,
  ],
})
export class LayerFileIdeComponent implements OnInit {
  private readonly layerFiles = inject(OpencodeLayerFilesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly autosaveTrigger$ = new Subject<void>();

  readonly scope = input.required<'global' | 'workspace'>();
  readonly clientId = input<string | null>(null);
  readonly path = input.required<string>();

  readonly saved = output<{ emittedPath: string }>();
  readonly cancelled = output<void>();

  readonly treeRoot = signal('.');
  readonly initialExpandPaths = signal<string[]>([]);
  readonly selectedPath = signal<string | null>(null);
  readonly content = signal('');
  readonly dirty = signal(false);
  readonly autosaveEnabled = signal(false);
  readonly bootstrapping = signal(true);
  readonly editorLoading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly displayPath = computed(() => this.selectedPath() ?? (this.path().trim() || '.'));

  constructor() {
    this.autosaveTrigger$.pipe(debounceTime(1500), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.autosaveEnabled() && this.dirty()) {
        this.save();
      }
    });

    let previousAutosaveEnabled = false;

    effect(() => {
      const enabled = this.autosaveEnabled();
      const isDirty = this.dirty();

      if (enabled && !previousAutosaveEnabled && isDirty) {
        setTimeout(() => {
          if (this.autosaveEnabled() && this.dirty()) {
            this.save();
          }
        }, 0);
      }

      previousAutosaveEnabled = enabled;
    });
  }

  ngOnInit(): void {
    this.bootstrap();
  }

  onFileSelect(path: string): void {
    this.editorLoading.set(true);
    this.selectedPath.set(path);
    this.error.set(null);
    this.getFile(path)
      .pipe(
        catchError((): Observable<OpencodeLayerFileDto | null> => of(null)),
        take(1),
      )
      .subscribe((dto: OpencodeLayerFileDto | null) => {
        this.content.set(dto?.content ?? '');
        this.dirty.set(false);
        this.editorLoading.set(false);
      });
  }

  onTreeError(message: string | null): void {
    this.error.set(message);
  }

  onOpenPathRemoved(path: string): void {
    if (this.selectedPath() === path || (this.selectedPath()?.startsWith(`${path}/`) ?? false)) {
      this.selectedPath.set(null);
      this.content.set('');
      this.dirty.set(false);
    }
  }

  onContentChange(value: string): void {
    this.content.set(value);
    this.dirty.set(true);

    if (this.autosaveEnabled()) {
      this.autosaveTrigger$.next();
    }
  }

  onAutosaveEnabledChange(enabled: boolean): void {
    this.autosaveEnabled.set(enabled);
  }

  save(): void {
    const path = this.selectedPath();

    if (!path || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    this.putFile(path, this.content())
      .pipe(take(1))
      .subscribe({
        next: (dto) => {
          this.dirty.set(false);
          this.saving.set(false);
          this.saved.emit({ emittedPath: dto.emittedPath });
        },
        error: (err: { message?: string }) => {
          this.error.set(err.message ?? $localize`:@@featureAgentConfig-layerFileSaveFailed:Failed to save file`);
          this.saving.set(false);
        },
      });
  }

  private bootstrap(): void {
    const raw = this.path().trim() || '.';
    this.bootstrapping.set(true);
    this.error.set(null);

    if (!raw || raw === '.' || raw === './') {
      this.treeRoot.set('.');
      this.initialExpandPaths.set([]);
      this.selectedPath.set(null);
      this.bootstrapping.set(false);

      return;
    }

    this.ensurePath(raw)
      .pipe(
        catchError((): Observable<OpencodeLayerFileDto | null> => of(null)),
        take(1),
      )
      .subscribe((dto: OpencodeLayerFileDto | null) => {
        if (dto?.entryKind === 'file') {
          // Tree starts at the file's parent so siblings are visible, not VFS top-level.
          this.treeRoot.set(this.parentDirectory(dto.path) ?? '.');
          this.initialExpandPaths.set([]);
          this.selectedPath.set(dto.path);
          this.content.set(dto.content);
          this.dirty.set(false);
        } else if (dto?.entryKind === 'directory') {
          // Tree starts at the opened directory contents (e.g. /opt/skills/test → children of test).
          this.treeRoot.set(dto.path);
          this.initialExpandPaths.set([]);
          this.selectedPath.set(null);
        } else {
          // Ensure failed — still open tree at the requested path and try to select if it looks like a file.
          const looksLikeFile = /\.[A-Za-z0-9]+$/.test(raw.split('/').pop() ?? '');

          if (looksLikeFile) {
            this.treeRoot.set(this.parentDirectory(raw) ?? '.');
            this.initialExpandPaths.set([]);
            this.onFileSelect(raw);
          } else {
            this.treeRoot.set(raw);
            this.initialExpandPaths.set([]);
            this.selectedPath.set(null);
          }
        }

        this.bootstrapping.set(false);
      });
  }

  /** Parent directory of a path, or `null` for top-level entries. */
  private parentDirectory(path: string): string | null {
    const absolute = path.startsWith('/');
    const parts = path.split('/').filter((part) => part.length > 0);

    if (parts.length <= 1) {
      return absolute ? '/' : null;
    }

    const parent = parts.slice(0, -1).join('/');

    return absolute ? `/${parent}` : parent;
  }

  private ensurePath(path: string): Observable<OpencodeLayerFileDto | null> {
    if (this.scope() === 'global') {
      return this.layerFiles.ensureGlobal(path);
    }

    const clientId = this.clientId();

    return clientId ? this.layerFiles.ensureWorkspace(clientId, path) : of(null);
  }

  private getFile(path: string): Observable<OpencodeLayerFileDto | null> {
    if (this.scope() === 'global') {
      return this.layerFiles.getGlobal(path);
    }

    const clientId = this.clientId();

    return clientId ? this.layerFiles.getWorkspace(clientId, path) : of(null);
  }

  private putFile(path: string, content: string): Observable<OpencodeLayerFileDto> {
    if (this.scope() === 'global') {
      return this.layerFiles.putGlobal(path, content);
    }

    const clientId = this.clientId();

    if (!clientId) {
      throw new Error('clientId is required');
    }

    return this.layerFiles.putWorkspace(clientId, path, content);
  }
}
