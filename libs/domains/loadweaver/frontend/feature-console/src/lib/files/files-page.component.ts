import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  apiErrorMessageAsync,
  ConsoleFilesFacade,
  ConsoleLiveFacade,
  isLiveFileTarget,
  joinLivePath,
  LIVE_FILE_MAX,
  LIVE_UPLOAD_WHOLE_MAX,
  liveBaseName,
  liveFileLanguage,
  liveFileType,
  LiveFilesService,
  livePathCrumbs,
  newUploadId,
  normalizeLivePath,
  parentLivePath,
  uploadChunks,
  type LiveFileEntry,
  type LiveFileTarget,
  type LiveReplicaTarget,
  type LiveVolumeTarget,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { filterBySearch, NO_MATCHES_HINT, NO_MATCHES_TITLE } from '../list-search';
import { dlBulkSummary } from '../section/data-list';
import { fileIcon, formatMode, saveFile } from '../live/live-format';
import { formatBytes } from '../overview/console-format';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** Text previews read at most this much (a ranged read for larger files). */
export const FILES_TEXT_PREVIEW_MAX = 512 * 1024;
/** Images are previewed up to this size. */
export const FILES_IMAGE_PREVIEW_MAX = 20 * 1024 * 1024;

/**
 * Raster images previewed inline, as `data:` URLs of exactly these (passive) types. Active formats (SVG can carry
 * scripts) are never turned into URLs in the console's origin: SVG is previewed as text.
 */
export const RASTER_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** How a file is previewed: raster images inline, SVG and text in the read-only editor, the rest not at all. */
export function filePreviewKind(path: string): 'text' | 'image' | 'binary' {
  const name = liveBaseName(path);
  const ext = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';

  if (Object.prototype.hasOwnProperty.call(RASTER_IMAGE_TYPES, ext)) return 'image';

  if (ext === 'svg') return 'text';

  const type = liveFileType(path);

  return type === 'text' ? 'text' : 'binary';
}

/** A `data:` URL of the blob re-typed as the given raster image type (never a `blob:` URL in the console's origin). */
export function rasterDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([blob], { type }));
  });
}

export interface FilePreview {
  path: string;
  kind: 'text' | 'image' | 'binary' | 'none';
  loading: boolean;
  text: string;
  imageUrl: string | null;
  /** Only the beginning of the file is shown. */
  partial: boolean;
  size: number;
  error: string | null;
}

export interface FileUpload {
  name: string;
  sent: number;
  total: number;
  status: 'uploading' | 'done' | 'failed';
  error: string | null;
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * The file browser (3.19): a replica's container filesystem (`replica:<id>`, writes lost on restart) or a volume
 * (`volume:<id>`); list, preview text read-only (ranged for large files) and images, download, upload (chunked over
 * 10 MB), create, delete, rename / move, copy. `?target=…&path=…` deep links.
 *
 * Embedded in an object tab (3.38) the scope fixes the target: `{ target: 'volume:<p>/<v>' }` (volume Files tab: opened
 * right away, no picker) or `{ project, deployment }` (deployment Files tab: the picker offers only that deployment's
 * replicas and volumes, client-side, and the first replica opens once the targets are loaded). The page header is
 * hidden and the URL is never written.
 */
@Component({
  selector: 'loadweaver-files-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  templateUrl: './files-page.component.html',
  styles: `
    .lw-files__uploads {
      max-height: 12rem;
      overflow-y: auto;
    }
    .lw-files__path {
      flex: 0 1 16rem;
      min-width: 10rem;
    }
  `,
  standalone: true,
})
export class LoadweaverFilesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFilesFacade);
  private readonly live = inject(ConsoleLiveFacade);
  private readonly service = inject(LiveFilesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly scope = injectSectionScope();
  private readonly scopeTarget = this.scope?.params()['target'] ?? null;
  private readonly scopeProject = this.scope?.params()['project'] ?? null;
  private readonly scopeDeployment = this.scope?.params()['deployment'] ?? null;

  readonly target = toSignal(this.facade.target$, { initialValue: null });
  readonly path = toSignal(this.facade.path$, { initialValue: '/' });
  readonly entries = toSignal(this.facade.entries$, { initialValue: [] as LiveFileEntry[] });
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly visibleEntries = computed(() => filterBySearch(this.entries(), this.search(), (e) => [e.name]));
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly busy = toSignal(this.facade.busy$, { initialValue: false });
  readonly operationError = toSignal(this.facade.operationError$, { initialValue: null });
  readonly warning = toSignal(this.facade.warning$, { initialValue: null });
  readonly replicas = toSignal(this.live.replicas$, { initialValue: [] as LiveReplicaTarget[] });
  readonly volumes = toSignal(this.live.volumes$, { initialValue: [] as LiveVolumeTarget[] });
  readonly projects = toSignal(this.live.projects$, { initialValue: [] as string[] });
  readonly targetsError = toSignal(this.live.targetsError$, { initialValue: null });

  readonly preview = signal<FilePreview | null>(null);
  /** Workbench (3.37): the browser lane and the preview lane; one at a time on phones. */
  readonly lane = signal<'browser' | 'preview'>('browser');
  readonly activeLane = computed(() => (this.preview() ? this.lane() : 'browser'));
  readonly uploads = signal<FileUpload[]>([]);
  readonly downloading = signal<string | null>(null);
  readonly downloadError = signal<string | null>(null);
  readonly pathInput = signal('/');

  readonly createOpen = signal(false);
  readonly createType = signal<'file' | 'directory'>('directory');
  readonly createName = signal('');
  readonly moveOpen = signal(false);
  readonly moveMode = signal<'move' | 'copy'>('move');
  readonly moveSource = signal('');
  readonly moveDestination = signal('');
  readonly moveOverwrite = signal(false);
  readonly deleteOpen = signal(false);
  readonly deleteEntry = signal<LiveFileEntry | null>(null);

  readonly crumbs = computed(() => livePathCrumbs(this.path()));
  readonly isReplica = computed(() => this.target()?.startsWith('replica:') ?? false);
  /** Embedded in a deployment: only its replicas and volumes (the targets API has no deployment filter). */
  private readonly inScope = (t: { project: string; deployment: string }) =>
    !this.scopeDeployment || (t.project === this.scopeProject && t.deployment === this.scopeDeployment);
  readonly targetOptions = computed(() =>
    this.projects()
      .map((project) => ({
        project,
        replicas: this.replicas().filter((r) => r.project === project && this.inScope(r)),
        volumes: this.volumes().filter((v) => v.project === project && this.inScope(v)),
      }))
      .filter((group) => !this.scopeDeployment || group.replicas.length + group.volumes.length > 0),
  );
  /** A volume scope fixes the target: no picker. */
  readonly showPicker = computed(() => !this.scopeTarget?.startsWith('volume:'));
  /** The previewed entry's row (when it is in this directory). */
  readonly activeEntry = computed(() => {
    const preview = this.preview()?.path;
    const dir = this.path() === '/' ? '' : this.path();

    return preview?.startsWith(`${dir}/`) && !preview.slice(dir.length + 1).includes('/')
      ? preview.slice(dir.length + 1)
      : null;
  });
  readonly entryId = (entry: LiveFileEntry) => entry.name;
  readonly uploading = computed(() => this.uploads().some((u) => u.status === 'uploading'));
  readonly createValid = computed(
    () => /^[^/\0]{1,255}$/.test(this.createName().trim()) && this.createName().trim() !== '..',
  );

  readonly formatBytes = formatBytes;
  readonly formatMode = formatMode;
  readonly fileIcon = fileIcon;
  readonly language = liveFileLanguage;

  readonly title = $localize`:@@lwConsoleFiles-title:Files`;
  readonly targetLabel = $localize`:@@lwConsoleFiles-target:Replica or volume`;
  readonly pathLabel = $localize`:@@lwConsoleFiles-path:Path`;
  readonly searchLabel = $localize`:@@lwConsoleFiles-search:Search this folder`;
  readonly loadingPreviewLabel = $localize`:@@lwConsoleFiles-loadingPreview:Loading preview`;
  readonly noMatchesTitle = NO_MATCHES_TITLE;
  readonly noMatchesHint = NO_MATCHES_HINT;
  readonly uploadLabel = $localize`:@@lwConsoleFiles-upload:Upload`;
  readonly newLabel = $localize`:@@lwConsoleFiles-new:New`;
  readonly refreshLabel = $localize`:@@lwConsoleFiles-refresh:Refresh`;
  readonly upLabel = $localize`:@@lwConsoleFiles-up:Parent directory`;
  readonly downloadLabel = $localize`:@@lwConsoleFiles-download:Download`;
  readonly renameLabel = $localize`:@@lwConsoleFiles-rename:Rename / move`;
  readonly copyLabel = $localize`:@@lwConsoleFiles-copy:Copy`;
  readonly deleteLabel = $localize`:@@lwConsoleFiles-delete:Delete`;
  readonly createTitle = $localize`:@@lwConsoleFiles-createTitle:Create`;
  readonly cancelLabel = $localize`:@@lwConsoleFiles-cancel:Cancel`;
  readonly deleteTitle = $localize`:@@lwConsoleFiles-deleteTitle:Delete this entry?`;
  readonly newDirectoryLabel = $localize`:@@lwConsoleFiles-newDirectoryAction:New folder`;
  readonly newFileLabel = $localize`:@@lwConsoleFiles-newFileAction:New file`;
  readonly closePreviewLabel = $localize`:@@lwConsoleFiles-closePreview:Close preview`;
  readonly uploadsTitle = $localize`:@@lwConsoleFiles-uploads:Uploads`;
  readonly browserTitle = $localize`:@@lwConsoleFiles-browserTitle:Files`;
  readonly clearUploadsLabel = $localize`:@@lwConsoleFiles-clearUploads:Clear`;
  readonly typeLabel = $localize`:@@lwConsoleFiles-type:Type`;
  readonly tableLabels = {
    refresh: this.refreshLabel,
    empty: NO_MATCHES_TITLE,
    rowActions: $localize`:@@lwConsoleFiles-colActions:Actions`,
  };
  readonly columns: FpcTableColumn<LiveFileEntry>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleFiles-colName:Name`,
      value: (e) => e.name,
      required: true,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleFiles-colSize:Size`,
      value: (e) => (e.type === 'directory' ? -1 : e.size),
      align: 'end',
      width: '7rem',
    },
    {
      id: 'modified',
      label: $localize`:@@lwConsoleFiles-colModified:Modified`,
      value: (e) => e.modifiedAt,
      width: '11rem',
    },
    {
      id: 'mode',
      label: $localize`:@@lwConsoleFiles-colMode:Mode`,
      value: (e) => formatMode(e.mode),
      mono: true,
      width: '7rem',
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@lwConsoleFiles-bulkDeleteMessage:${this.selected().length}:count: selected entries (directories with everything in them) will be deleted.`,
  );
  /** ⋮ (3.38 D8): download (files), rename / move, copy, delete; open is the row click. */
  readonly rowMenu = (entry: LiveFileEntry): FpcMenuItem[] => [
    ...(entry.type === 'file'
      ? [{ id: 'download', label: this.downloadLabel, icon: 'download', disabled: this.downloading() !== null }]
      : []),
    { id: 'move', label: this.renameLabel, icon: 'pencil' },
    { id: 'copy', label: this.copyLabel, icon: 'copy' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
  ];

  onRowAction(entry: LiveFileEntry, action: string): void {
    if (action === 'download') this.download(entry);
    else if (action === 'move' || action === 'copy') this.openMove(entry, action);
    else if (action === 'delete') this.askDelete(entry);
  }

  /** Bulk Delete: one call per entry (same endpoint + authorization as the single delete), per-entry result. */
  async deleteSelected(): Promise<void> {
    const target = this.target();
    const ids = new Set(this.selected());
    const entries = this.visibleEntries().filter((e) => ids.has(this.entryId(e)));

    if (!target || entries.length === 0) return;

    const paths = entries.map((e) => joinLivePath(this.path(), e.name));
    const result = await fpcRunBulk(paths, (path) => firstValueFrom(this.service.remove(target, path)));

    if (paths.includes(this.preview()?.path ?? '')) this.closePreview();

    this.bulkResult.set(dlBulkSummary(result, (path) => path));
    this.selected.set([]);
    this.facade.refresh();
  }

  constructor() {
    // Embedded in a deployment: open its first replica (else volume) once the targets arrive, unless one is open.
    if (this.scopeDeployment) {
      effect(() => {
        const options = this.targetOptions();
        const current = this.target();

        untracked(() => {
          if (current && this.isScopedTarget(current)) return;

          const first = options[0];
          const next = first?.replicas[0]
            ? `replica:${first.replicas[0].id}`
            : first?.volumes[0]
              ? `volume:${first.volumes[0].id}`
              : null;

          if (isLiveFileTarget(next)) this.open(next, '/');
        });
      });
    }

    // A volume object names its volume `volume:<project>/<name>`; file targets are `<project>/<deployment>/<name>`:
    // resolve it against the live volumes (client-side) once they arrive.
    const short = this.scopeTarget?.startsWith('volume:') ? this.scopeTarget.slice('volume:'.length).split('/') : null;

    if (short?.length === 2) {
      effect(() => {
        const [project, name] = short;
        const volume = this.volumes().find((v) => v.project === project && v.name === name);
        const next = volume ? `volume:${volume.id}` : null;

        untracked(() => {
          if (isLiveFileTarget(next) && this.target() !== next) this.open(next, '/');
        });
      });
    }
  }

  ngOnInit(): void {
    this.live.loadTargets();

    const params = sectionQuery(this.route, this.scope);
    const target = params.get('target') ?? (params.get('replica') ? `replica:${params.get('replica')}` : null);

    if (isLiveFileTarget(target)) this.open(target, normalizeLivePath(params.get('path')));
    else if (this.target() && (!this.scope || this.isScopedTarget(this.target() ?? '')))
      this.pathInput.set(this.path());
  }

  /** The target belongs to the embedding deployment. */
  private isScopedTarget(target: string): boolean {
    const id = target.slice(target.indexOf(':') + 1);

    return id.startsWith(`${this.scopeProject}/${this.scopeDeployment}/`);
  }

  moveTitle(): string {
    return this.moveMode() === 'copy'
      ? $localize`:@@lwConsoleFiles-copyTitle:Copy to`
      : $localize`:@@lwConsoleFiles-moveTitle:Rename / move to`;
  }

  deleteMessage(): string {
    const entry = this.deleteEntry();

    if (!entry) return '';

    const path = joinLivePath(this.path(), entry.name);

    return entry.type === 'directory'
      ? $localize`:@@lwConsoleFiles-deleteDirectory:${path}:path: and everything in it will be deleted.`
      : $localize`:@@lwConsoleFiles-deleteFile:${path}:path: will be deleted.`;
  }

  onTargetChange(target: string): void {
    if (isLiveFileTarget(target)) this.open(target, '/');
  }

  open(target: LiveFileTarget, path: string): void {
    this.closePreview();
    this.pathInput.set(path);
    this.search.set('');
    this.facade.open(target, path);

    if (this.scope) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: { target, path: path === '/' ? null : path, replica: null },
    });
  }

  go(path: string): void {
    const target = this.target();

    if (target) this.open(target, normalizeLivePath(path));
  }

  up(): void {
    this.go(parentLivePath(this.path()));
  }

  refresh(): void {
    this.facade.refresh();
  }

  activate(entry: LiveFileEntry): void {
    const path = joinLivePath(this.path(), entry.name);

    if (entry.type === 'directory' || entry.type === 'symlink') {
      // Links to directories open like directories; links to files fail the listing and are previewed instead.
      if (entry.type === 'symlink') {
        void this.openLink(path, entry);

        return;
      }

      this.go(path);
    } else void this.showPreview(entry);
  }

  private async openLink(path: string, entry: LiveFileEntry): Promise<void> {
    const target = this.target();

    if (!target) return;

    try {
      await firstValueFrom(this.service.list(target, path));
      this.go(path);
    } catch {
      void this.showPreview(entry);
    }
  }

  async showPreview(entry: LiveFileEntry): Promise<void> {
    const target = this.target();

    if (!target) return;

    const path = joinLivePath(this.path(), entry.name);
    const type = filePreviewKind(path);

    const base: FilePreview = {
      path,
      kind: 'none',
      loading: true,
      text: '',
      imageUrl: null,
      partial: false,
      size: entry.size,
      error: null,
    };

    this.lane.set('preview');

    if (type === 'binary') {
      this.preview.set({ ...base, kind: 'binary', loading: false });

      return;
    }

    if (type === 'image' && entry.size > FILES_IMAGE_PREVIEW_MAX) {
      this.preview.set({ ...base, kind: 'none', loading: false });

      return;
    }

    this.preview.set({ ...base, kind: type });

    try {
      const content = await firstValueFrom(
        this.service.read(
          target,
          path,
          type === 'text' && entry.size > FILES_TEXT_PREVIEW_MAX
            ? { start: 0, end: FILES_TEXT_PREVIEW_MAX - 1 }
            : undefined,
        ),
      );

      if (this.preview()?.path !== path) return;

      if (type === 'image') {
        const ext = path.split('.').at(-1)?.toLowerCase() ?? '';
        const imageUrl = await rasterDataUrl(content.data, RASTER_IMAGE_TYPES[ext]);

        if (this.preview()?.path !== path) return;

        this.preview.set({ ...base, loading: false, kind: 'image', size: content.size, imageUrl });
      } else {
        const text = await blobText(content.data);

        // A NUL byte: not text after all.
        this.preview.set(
          text.includes('\u0000')
            ? { ...base, loading: false, kind: 'binary', size: content.size }
            : { ...base, loading: false, kind: 'text', text, partial: content.partial, size: content.size },
        );
      }
    } catch (error) {
      if (this.preview()?.path === path) {
        const message = await apiErrorMessageAsync(error, 'Failed to read the file');

        if (this.preview()?.path === path) this.preview.set({ ...base, loading: false, error: message });
      }
    }
  }

  closePreview(): void {
    this.preview.set(null);
  }

  async download(
    entry: LiveFileEntry | null,
    path = entry ? joinLivePath(this.path(), entry.name) : '',
  ): Promise<void> {
    const target = this.target();

    if (!target || !path) return;

    if (entry && entry.size > LIVE_FILE_MAX) {
      this.downloadError.set(
        $localize`:@@lwConsoleFiles-downloadTooLarge:Files over 100 MB can't be downloaded in the browser.`,
      );

      return;
    }

    this.downloading.set(path);
    this.downloadError.set(null);

    try {
      saveFile(this.document, await firstValueFrom(this.service.download(target, path)), liveBaseName(path));
    } catch (error) {
      this.downloadError.set(await apiErrorMessageAsync(error, 'Download failed'));
    } finally {
      this.downloading.set(null);
    }
  }

  onFilesSelected(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);

    input.value = '';
    void this.upload(files);
  }

  /** Uploads one after the other: whole up to 10 MB, in `Content-Range` chunks above (at most 100 MB). */
  async upload(files: File[]): Promise<void> {
    const target = this.target();

    if (!target || files.length === 0) return;

    const directory = this.path();

    this.uploads.set(files.map((f) => ({ name: f.name, sent: 0, total: f.size, status: 'uploading', error: null })));

    for (const [index, file] of files.entries()) {
      const path = joinLivePath(directory, file.name);
      const update = (changes: Partial<FileUpload>) =>
        this.uploads.update((list) => list.map((u, i) => (i === index ? { ...u, ...changes } : u)));

      if (file.size > LIVE_FILE_MAX) {
        update({ status: 'failed', error: $localize`:@@lwConsoleFiles-uploadTooLarge:larger than 100 MB` });
        continue;
      }

      try {
        if (file.size <= LIVE_UPLOAD_WHOLE_MAX) {
          const result = await firstValueFrom(this.service.write(target, path, file));

          this.facade.setWarning(result.warning);
        } else {
          const uploadId = newUploadId();

          for (const chunk of uploadChunks(file.size)) {
            const result = await firstValueFrom(
              this.service.write(target, path, file.slice(chunk.start, chunk.end + 1), {
                contentRange: chunk.header,
                uploadId,
              }),
            );

            this.facade.setWarning(result.warning);
            update({ sent: chunk.end + 1 });
          }
        }

        update({ sent: file.size, status: 'done' });
      } catch (error) {
        update({ status: 'failed', error: apiErrorMessage(error, 'Upload failed') });
      }
    }

    this.facade.refresh();
  }

  clearUploads(): void {
    this.uploads.set([]);
  }

  openCreate(type: 'file' | 'directory'): void {
    this.createType.set(type);
    this.createName.set('');
    this.createOpen.set(true);
  }

  submitCreate(): void {
    const target = this.target();

    if (!target || !this.createValid()) return;

    this.facade.run(target, {
      kind: 'create',
      path: joinLivePath(this.path(), this.createName().trim()),
      type: this.createType(),
    });
    this.createOpen.set(false);
  }

  openMove(entry: LiveFileEntry, mode: 'move' | 'copy'): void {
    const path = joinLivePath(this.path(), entry.name);

    this.moveMode.set(mode);
    this.moveSource.set(path);
    this.moveDestination.set(mode === 'copy' ? `${path}.copy` : path);
    this.moveOverwrite.set(false);
    this.moveOpen.set(true);
  }

  submitMove(): void {
    const target = this.target();
    const destination = normalizeLivePath(this.moveDestination());

    if (!target || destination === '/' || destination === this.moveSource()) return;

    this.facade.run(target, {
      kind: this.moveMode(),
      path: this.moveSource(),
      destination,
      overwrite: this.moveOverwrite(),
    });

    if (this.preview()?.path === this.moveSource() && this.moveMode() === 'move') this.closePreview();

    this.moveOpen.set(false);
  }

  askDelete(entry: LiveFileEntry): void {
    this.deleteEntry.set(entry);
    this.deleteOpen.set(true);
  }

  confirmDelete(): void {
    const target = this.target();
    const entry = this.deleteEntry();

    if (!target || !entry) return;

    const path = joinLivePath(this.path(), entry.name);

    this.facade.run(target, { kind: 'delete', path });

    if (this.preview()?.path === path) this.closePreview();

    this.deleteOpen.set(false);
    this.deleteEntry.set(null);
  }

  dismissMessages(): void {
    this.facade.dismissMessages();
  }
}
