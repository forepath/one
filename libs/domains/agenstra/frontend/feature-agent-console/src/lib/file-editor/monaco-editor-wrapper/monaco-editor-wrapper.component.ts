import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  DoCheck,
  effect,
  HostListener,
  inject,
  input,
  NgZone,
  OnDestroy,
  output,
  SecurityContext,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import type { AgentFileType } from '@forepath/agenstra/frontend/data-access-agent-console';
import { AgentFileBodyStore } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
} from '@forepath/shared/frontend/ui-components';

import { ThemeService } from '../../theme.service';

// Type declaration for marked library
interface Marked {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

@Component({
  selector: 'framework-monaco-editor-wrapper',
  imports: [CommonModule, FpcButtonComponent, FpcButtonGroupComponent, FpcEmptyStateComponent, MonacoEditorModule],
  templateUrl: './monaco-editor-wrapper.component.html',
  styleUrls: ['./monaco-editor-wrapper.component.scss'],
  standalone: true,
})
export class MonacoEditorWrapperComponent implements OnDestroy, DoCheck {
  private readonly ngZone = inject(NgZone);
  private readonly themeService = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly bodyStore = inject(AgentFileBodyStore);

  // Cache for marked instance
  private markedInstance: Marked | null = null;
  private markedLoadPromise: Promise<Marked> | null = null;
  private markedLoaded = signal<boolean>(false);

  // Inputs — prefer FileContentDto fields from the API
  filePath = input<string | null>(null);
  fileType = input<AgentFileType | null>(null);
  contentType = input<string | null>(null);
  /** UTF-8 text for text files. */
  text = input<string | null>(null);
  /** Opaque body store key for media/binary preview (bytes live outside NgRx). */
  bodyRef = input<string | null>(null);
  /** Body revision — bumps on overwrite so media preview reloads even when bodyRef is stable. */
  revision = input<number | null>(null);
  /** True when open used HEAD only and skipped the body. */
  bodyOmitted = input<boolean>(false);
  isDirty = input<boolean>(false);
  autosaveEnabled = input<boolean>(false);
  /** 1-based line to reveal when opening from search (nonce forces re-reveal). */
  revealLine = input<{ line: number; nonce: number } | null>(null);

  // Outputs
  contentChange = output<string>();
  saveRequest = output<void>();
  downloadRequest = output<void>();

  // Internal state
  editorInstance = signal<editor.IStandaloneCodeEditor | null>(null);
  isBinary = signal<boolean>(false);
  language = signal<string>('plaintext');
  previewVisible = signal<boolean>(false);
  private currentEditorContent = signal<string>('');
  private contentChangeDisposable: { dispose: () => void } | null = null;
  private lastText: string | null = null;
  private lastBodyRef: string | null = null;
  private lastBodyRevision: number | null = null;
  private isSettingInitialContent = false;
  private lastFilePath: string | null = null;
  private lastFileType: AgentFileType | null = null;
  private mediaObjectUrl = signal<string | null>(null);
  private mediaLoadToken = 0;

  constructor() {
    effect(() => {
      const filePath = this.filePath();
      const previousFilePath = this.lastFilePath;

      if (filePath !== previousFilePath) {
        this.lastText = null;
        this.lastBodyRef = null;
        this.lastBodyRevision = null;
        untracked(() => this.revokeMediaObjectUrl());
      }

      this.filePath();
      this.fileType();
      this.updateBinaryAndLanguage();
    });

    effect(() => {
      if (this.isMarkdown() && !this.markedInstance) {
        this.loadMarked().then(() => {
          this.markedLoaded.set(true);
          this.cdr.detectChanges();
        });
      }
    });

    effect(() => {
      const isDarkMode = this.themeService.isDarkMode();
      const editor = this.editorInstance();

      if (editor) {
        monaco.editor.setTheme(isDarkMode ? 'vs-dark' : 'vs-light');
      }
    });

    effect(() => {
      const request = this.revealLine();
      const editor = this.editorInstance();
      // Re-run when file text arrives so reveal works after async open.
      this.text();

      if (!request || !editor || request.line < 1) {
        return;
      }

      const line = request.line;
      void request.nonce;

      queueMicrotask(() => {
        const model = editor.getModel();
        const maxLine = model?.getLineCount() ?? line;
        const target = Math.min(line, maxLine);

        editor.revealLineInCenter(target);
        editor.setPosition({ lineNumber: target, column: 1 });
        editor.focus();
      });
    });

    // Build blob URLs for image/PDF/video/audio preview from the body store.
    effect(() => {
      const bodyRef = this.bodyRef();
      const contentType = this.contentType();
      const filePath = this.filePath();
      // revision is a dependency so upload/replace reloads media for the same bodyRef key
      this.revision();
      const needsMedia = this.isImage() || this.isPdf() || this.isVideo() || this.isAudio();
      const token = ++this.mediaLoadToken;

      untracked(() => this.revokeMediaObjectUrl());

      if (!needsMedia || !bodyRef) {
        return;
      }

      void this.bodyStore.get(bodyRef).then((stored) => {
        if (token !== this.mediaLoadToken) {
          return;
        }

        if (!stored) {
          untracked(() => this.mediaObjectUrl.set(null));

          return;
        }

        try {
          const rawMime = contentType || this.guessMimeFromPath(filePath) || stored.type || 'application/octet-stream';
          const mime = rawMime.split(';')[0].trim() || 'application/octet-stream';
          const blob = stored.type === mime ? stored : new Blob([stored], { type: mime });
          const url = URL.createObjectURL(blob);

          untracked(() => this.mediaObjectUrl.set(url));
          this.cdr.detectChanges();
        } catch {
          untracked(() => this.mediaObjectUrl.set(null));
        }
      });
    });
  }

  readonly editorOptions = computed(() => ({
    theme: this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light',
    language: this.language(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on' as const,
    wordWrap: 'on' as const,
    readOnly: this.isBinary(),
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on' as const,
    tabCompletion: 'on' as const,
    wordBasedSuggestions: true,
    suggestSelection: 'first' as const,
    snippetSuggestions: 'top' as const,
  }));

  readonly mediaPreviewUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.mediaObjectUrl();

    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  readonly mediaPreviewHref = computed<string | null>(() => this.mediaObjectUrl());

  ngOnDestroy(): void {
    this.revokeMediaObjectUrl();

    if (this.contentChangeDisposable) {
      this.contentChangeDisposable.dispose();
    }

    const editor = this.editorInstance();

    if (editor) {
      try {
        editor.dispose();
      } catch {
        // Ignore
      }
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      this.onSave();
    }
  }

  onDownload(): void {
    this.downloadRequest.emit();
  }

  onEditorInit(event: editor.IStandaloneCodeEditor | unknown): void {
    const editorInstance = event as editor.IStandaloneCodeEditor;

    if (!editorInstance || typeof editorInstance.getValue !== 'function') {
      return;
    }

    this.editorInstance.set(editorInstance);
    this.updateBinaryAndLanguage();

    const model = editorInstance.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, this.language());
    }

    monaco.editor.setTheme(this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light');

    if (this.contentChangeDisposable) {
      this.contentChangeDisposable.dispose();
      this.contentChangeDisposable = null;
    }

    this.contentChangeDisposable = editorInstance.onDidChangeModelContent(() => {
      if (this.isSettingInitialContent || this.isBinary()) {
        return;
      }

      const currentEditor = this.editorInstance();

      if (!currentEditor) {
        return;
      }

      try {
        const value = currentEditor.getValue();

        this.currentEditorContent.set(value);
        this.ngZone.run(() => {
          this.contentChange.emit(value);
        });
      } catch (error) {
        console.warn('Monaco contentChange: encode error', error);
      }
    });

    this.lastText = null;
    this.updateContent();
  }

  private updateContent(): void {
    const text = this.text();
    const editor = this.editorInstance();
    const wasPreviewVisible = this.previewVisible();

    if (this.isBinary()) {
      const bodyRef = this.bodyRef();
      const revision = this.revision();

      if (this.lastBodyRef === bodyRef && this.lastBodyRevision === revision) {
        if (wasPreviewVisible && this.isPreviewable()) {
          this.previewVisible.set(true);
        }

        return;
      }

      this.lastBodyRef = bodyRef;
      this.lastBodyRevision = revision;

      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }

      return;
    }

    if (!editor) {
      this.lastText = text;

      return;
    }

    const decoded = text ?? '';

    if (this.lastText !== null && this.lastText === decoded) {
      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }

      return;
    }

    try {
      const current = editor.getValue();

      if (current !== decoded) {
        this.isSettingInitialContent = true;
        const position = editor.getPosition();
        const model = editor.getModel();

        if (!model) {
          this.isSettingInitialContent = false;

          return;
        }

        const isInitialLoad = this.lastText === null;

        if (isInitialLoad) {
          editor.setValue(decoded);
        } else {
          const fullRange = model.getFullModelRange();
          const editOperation: editor.IIdentifiedSingleEditOperation = {
            range: fullRange,
            text: decoded,
            forceMoveMarkers: false,
          };

          editor.executeEdits('remote-update', [editOperation]);
        }

        this.currentEditorContent.set(decoded);

        if (position) {
          editor.setPosition(position);
        }

        setTimeout(() => {
          this.isSettingInitialContent = false;
        }, 0);
      }

      this.lastText = decoded;

      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }
    } catch {
      this.isSettingInitialContent = false;
    }
  }

  ngDoCheck(): void {
    const text = this.text();
    const bodyRef = this.bodyRef();

    if (this.isBinary()) {
      const revision = this.revision();

      if (bodyRef !== this.lastBodyRef || revision !== this.lastBodyRevision) {
        this.updateContent();
      }
    } else if (this.editorInstance() && text !== this.lastText) {
      this.updateContent();
    }

    const filePath = this.filePath();
    const fileType = this.fileType();

    if (filePath !== this.lastFilePath || fileType !== this.lastFileType) {
      this.lastFilePath = filePath;
      this.lastFileType = fileType;
      this.updateBinaryAndLanguage();
    }
  }

  private resolveFileType(): AgentFileType | null {
    const explicit = this.fileType();

    if (explicit) {
      return explicit;
    }

    const filePath = this.filePath();

    if (!filePath) {
      return null;
    }

    const lowerPath = filePath.toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.ico', '.webp'].some((ext) => lowerPath.endsWith(ext))) {
      return 'image';
    }

    if (lowerPath.endsWith('.pdf')) {
      return 'pdf';
    }

    if (['.mp4', '.webm', '.ogv', '.mov', '.m4v'].some((ext) => lowerPath.endsWith(ext))) {
      return 'video';
    }

    if (['.mp3', '.wav', '.flac', '.m4a', '.aac', '.oga', '.ogg', '.opus'].some((ext) => lowerPath.endsWith(ext))) {
      return 'audio';
    }

    const binaryExtensions = [
      '.zip',
      '.tar',
      '.gz',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.bin',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.otf',
    ];

    if (binaryExtensions.some((ext) => lowerPath.endsWith(ext))) {
      return 'binary';
    }

    return 'text';
  }

  private updateBinaryAndLanguage(): void {
    const filePath = this.filePath();
    const resolvedType = this.resolveFileType();

    if (!filePath) {
      this.isBinary.set(false);
      this.language.set('plaintext');

      return;
    }

    this.isBinary.set(resolvedType !== null && resolvedType !== 'text');

    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      cts: 'typescript',
      mts: 'typescript',
      cjs: 'javascript',
      mjs: 'javascript',
      js: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      py: 'python',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      kts: 'kotlin',
      vue: 'vue',
      jsx: 'javascript',
      tsx: 'typescript',
      dockerfile: 'dockerfile',
      toml: 'ini',
      ini: 'ini',
      cfg: 'ini',
      conf: 'ini',
      config: 'ini',
      properties: 'ini',
      props: 'ini',
      prop: 'ini',
      propfile: 'ini',
    };
    const newLanguage = langMap[ext || ''] || 'plaintext';
    const previousLanguage = this.language();

    this.language.set(newLanguage);

    if (previousLanguage !== newLanguage) {
      const editor = this.editorInstance();

      if (editor) {
        const model = editor.getModel();

        if (model) {
          monaco.editor.setModelLanguage(model, newLanguage);
        }
      }
    }
  }

  onSave(): void {
    if (this.isBinary()) {
      return;
    }

    this.saveRequest.emit();
  }

  getCurrentContent(): string | null {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return null;
    }

    try {
      return editor.getValue();
    } catch {
      return null;
    }
  }

  readonly isPreviewable = computed(() => this.isMarkdown());

  readonly isMarkdown = computed(() => {
    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();

    return lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown');
  });

  readonly isImage = computed(() => {
    const type = this.resolveFileType();

    if (type === 'image') {
      return true;
    }

    if (type) {
      return false;
    }

    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();

    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.ico', '.webp'].some((ext) => lowerPath.endsWith(ext));
  });

  readonly isPdf = computed(() => {
    const type = this.resolveFileType();

    if (type === 'pdf') {
      return true;
    }

    if (type) {
      return false;
    }

    const filePath = this.filePath();

    return !!filePath && filePath.toLowerCase().endsWith('.pdf');
  });

  readonly isVideo = computed(() => {
    const type = this.resolveFileType();

    if (type === 'video') {
      return true;
    }

    if (type) {
      return false;
    }

    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();

    return ['.mp4', '.webm', '.ogv', '.mov', '.m4v'].some((ext) => lowerPath.endsWith(ext));
  });

  readonly isAudio = computed(() => {
    const type = this.resolveFileType();

    if (type === 'audio') {
      return true;
    }

    if (type) {
      return false;
    }

    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();

    return ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.oga', '.ogg', '.opus'].some((ext) => lowerPath.endsWith(ext));
  });

  readonly markdownPreviewHtml = computed<SafeHtml | null>(() => {
    if (!this.isMarkdown()) {
      return null;
    }

    this.markedLoaded();

    const editorContent = this.currentEditorContent();
    const inputText = this.text();
    const markdownText = editorContent || inputText;

    if (!markdownText) {
      return null;
    }

    try {
      if (this.markedInstance) {
        try {
          const html = this.markedInstance.parse(markdownText, {
            breaks: true,
            gfm: true,
          });
          const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, html);

          return this.sanitizer.bypassSecurityTrustHtml(sanitized || '');
        } catch (error) {
          console.warn('Error parsing markdown:', error);
          const escaped = markdownText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

          return this.sanitizer.bypassSecurityTrustHtml(escaped);
        }
      }

      const escaped = markdownText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return this.sanitizer.bypassSecurityTrustHtml(escaped);
    } catch {
      return null;
    }
  });

  togglePreview(): void {
    this.previewVisible.set(!this.previewVisible());
  }

  closePreview(): void {
    this.previewVisible.set(false);
  }

  private async loadMarked(): Promise<Marked> {
    if (this.markedInstance) {
      return this.markedInstance;
    }

    if (this.markedLoadPromise) {
      return this.markedLoadPromise;
    }

    this.markedLoadPromise = (async () => {
      try {
        const markedModule = await import('marked');
        const marked = markedModule.marked;

        this.markedInstance = marked;
        this.markedLoaded.set(true);

        return marked;
      } catch (error) {
        this.markedLoadPromise = null;
        throw error;
      }
    })();

    return this.markedLoadPromise;
  }

  undo(): void {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return;
    }

    editor.trigger('keyboard', 'undo', null);
  }

  redo(): void {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return;
    }

    editor.trigger('keyboard', 'redo', null);
  }

  private revokeMediaObjectUrl(): void {
    const url = this.mediaObjectUrl();

    if (url) {
      URL.revokeObjectURL(url);
      this.mediaObjectUrl.set(null);
    }
  }

  private guessMimeFromPath(filePath: string | null): string | null {
    if (!filePath) {
      return null;
    }

    const lowerPath = filePath.toLowerCase();

    if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
      return 'image/jpeg';
    }

    if (lowerPath.endsWith('.gif')) {
      return 'image/gif';
    }

    if (lowerPath.endsWith('.bmp')) {
      return 'image/bmp';
    }

    if (lowerPath.endsWith('.svg')) {
      return 'image/svg+xml';
    }

    if (lowerPath.endsWith('.ico')) {
      return 'image/x-icon';
    }

    if (lowerPath.endsWith('.webp')) {
      return 'image/webp';
    }

    if (lowerPath.endsWith('.png')) {
      return 'image/png';
    }

    if (lowerPath.endsWith('.pdf')) {
      return 'application/pdf';
    }

    if (lowerPath.endsWith('.mp4')) {
      return 'video/mp4';
    }

    if (lowerPath.endsWith('.webm')) {
      return 'video/webm';
    }

    if (lowerPath.endsWith('.ogv')) {
      return 'video/ogg';
    }

    if (lowerPath.endsWith('.mp3')) {
      return 'audio/mpeg';
    }

    if (lowerPath.endsWith('.wav')) {
      return 'audio/wav';
    }

    if (lowerPath.endsWith('.flac')) {
      return 'audio/flac';
    }

    if (lowerPath.endsWith('.m4a')) {
      return 'audio/mp4';
    }

    if (lowerPath.endsWith('.aac')) {
      return 'audio/aac';
    }

    if (lowerPath.endsWith('.oga') || lowerPath.endsWith('.ogg')) {
      return 'audio/ogg';
    }

    if (lowerPath.endsWith('.opus')) {
      return 'audio/opus';
    }

    return null;
  }
}
