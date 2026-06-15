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
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

import { ThemeService } from '../../theme.service';

// Type declaration for marked library
interface Marked {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

/**
 * Decode base64 string to UTF-8 string.
 * atob() decodes to Latin-1, so we need to properly convert to UTF-8.
 */
function base64ToUtf8(base64: string): string {
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));

  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Encode UTF-8 string to base64.
 * btoa() only accepts Latin-1; use TextEncoder for proper UTF-8 support.
 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

@Component({
  selector: 'framework-monaco-editor-wrapper',
  imports: [CommonModule, MonacoEditorModule],
  templateUrl: './monaco-editor-wrapper.component.html',
  styleUrls: ['./monaco-editor-wrapper.component.scss'],
  standalone: true,
})
export class MonacoEditorWrapperComponent implements OnDestroy, DoCheck {
  private readonly ngZone = inject(NgZone);
  private readonly themeService = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr = inject(ChangeDetectorRef);

  // Cache for marked instance
  private markedInstance: Marked | null = null;
  private markedLoadPromise: Promise<Marked> | null = null;
  private markedLoaded = signal<boolean>(false);

  // Inputs
  filePath = input<string | null>(null);
  content = input<string | null>(null);
  encoding = input<'utf-8' | 'base64'>('utf-8');
  isDirty = input<boolean>(false);
  autosaveEnabled = input<boolean>(false);

  // Outputs - using output() for modern Angular API
  contentChange = output<string>();
  saveRequest = output<void>();

  // Internal state
  editorInstance = signal<editor.IStandaloneCodeEditor | null>(null);
  isBinary = signal<boolean>(false);
  language = signal<string>('plaintext');
  previewVisible = signal<boolean>(false);
  private currentEditorContent = signal<string>(''); // Track live editor content for preview
  private contentChangeDisposable: { dispose: () => void } | null = null;
  private lastContent: string | null = null;
  private isSettingInitialContent = false;
  private lastFilePath: string | null = null;
  private lastEncoding: 'utf-8' | 'base64' = 'utf-8';

  constructor() {
    // Watch for filePath and encoding changes to update binary status
    effect(() => {
      // Read signals to establish dependency tracking - effect will re-run when these change
      // The values are read again inside updateBinaryAndLanguage(), but we need to read them
      // here for the effect to track changes to these signals
      const filePath = this.filePath();
      const previousFilePath = this.lastFilePath;

      // Reset lastContent when file path changes to ensure content updates are detected
      // This is critical when switching from images (binary) to text files
      if (filePath !== previousFilePath) {
        this.lastContent = null;
      }

      this.filePath();
      this.encoding();

      // Update binary status whenever filePath or encoding changes
      this.updateBinaryAndLanguage();
    });

    // Preload marked library if markdown file is detected
    effect(() => {
      if (this.isMarkdown() && !this.markedInstance) {
        this.loadMarked().then(() => {
          this.markedLoaded.set(true);
          this.cdr.detectChanges();
        });
      }
    });

    // Watch for theme changes and update Monaco editor theme
    effect(() => {
      const isDarkMode = this.themeService.isDarkMode();
      const editor = this.editorInstance();

      if (editor) {
        const theme = isDarkMode ? 'vs-dark' : 'vs-light';

        monaco.editor.setTheme(theme);
      }
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
    // IntelliSense / Autocomplete options
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on' as const,
    tabCompletion: 'on' as const,
    wordBasedSuggestions: true,
    suggestSelection: 'first' as const,
    snippetSuggestions: 'top' as const,
  }));

  ngOnDestroy(): void {
    if (this.contentChangeDisposable) {
      this.contentChangeDisposable.dispose();
    }

    const editor = this.editorInstance();

    if (editor) {
      try {
        editor.dispose();
      } catch (error) {
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

  onEditorInit(event: editor.IStandaloneCodeEditor | unknown): void {
    const editorInstance = event as editor.IStandaloneCodeEditor;

    if (!editorInstance || typeof editorInstance.getValue !== 'function') {
      return;
    }

    this.editorInstance.set(editorInstance);

    // Update language before setting content to ensure syntax highlighting is enabled
    this.updateBinaryAndLanguage();

    // Always ensure the model has the correct language set for syntax highlighting
    const model = editorInstance.getModel();

    if (model) {
      const currentLanguage = this.language();

      // Set the model language to enable syntax highlighting
      monaco.editor.setModelLanguage(model, currentLanguage);
    }

    // Set initial theme based on current dark mode state
    const theme = this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light';

    monaco.editor.setTheme(theme);

    // Dispose old listener if exists
    if (this.contentChangeDisposable) {
      this.contentChangeDisposable.dispose();
      this.contentChangeDisposable = null;
    }

    // Listen to user changes - this is the Monaco editor API, not ngx-monaco-editor
    this.contentChangeDisposable = editorInstance.onDidChangeModelContent(() => {
      // Skip if we're setting initial content (don't mark as dirty on load)
      if (this.isSettingInitialContent) {
        return;
      }

      if (this.isBinary()) {
        return;
      }

      const currentEditor = this.editorInstance();

      if (!currentEditor) {
        return;
      }

      try {
        const value = currentEditor.getValue();
        const base64 = utf8ToBase64(value);

        // Update current editor content for live preview
        this.currentEditorContent.set(value);

        // Ensure emit happens in Angular zone
        this.ngZone.run(() => {
          this.contentChange.emit(base64);
        });
      } catch (error) {
        // Log encoding errors instead of silently ignoring (helps debug dirty state issues)
        console.warn('Monaco contentChange: encoding error', error);
      }
    });

    // Set initial content
    // Reset lastContent to null before updating to ensure content is always set on init
    // This is important when switching from images to text files
    this.lastContent = null;
    this.updateContent();
  }

  // Simple method to update content when input changes
  private updateContent(): void {
    const content = this.content();
    const editor = this.editorInstance();
    // Store current preview visibility state before updating
    const wasPreviewVisible = this.previewVisible();

    // For binary files (including images), only handle preview state preservation
    if (this.isBinary()) {
      // Skip if same content
      if (this.lastContent === content) {
        // If content is the same but preview was open and is previewable, keep it open
        if (wasPreviewVisible && this.isPreviewable()) {
          this.previewVisible.set(true);
        }

        return;
      }

      // For binary files, just track content changes for preview state
      this.lastContent = content;

      // If preview was visible and the file is still previewable, keep it open
      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }

      return;
    }

    // For text files, handle editor content updates
    if (!editor || !content) {
      this.lastContent = content;

      return;
    }

    // Skip if same content (but only if lastContent is not null - null means we need to update)
    // This ensures content is always set when switching from images to text files
    if (this.lastContent !== null && this.lastContent === content) {
      // If content is the same but preview was open and is previewable, keep it open
      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }

      return;
    }

    try {
      const decoded = base64ToUtf8(content);
      const current = editor.getValue();

      // Only update if different
      if (current !== decoded) {
        // Set flag to prevent marking as dirty during content updates
        this.isSettingInitialContent = true;
        const position = editor.getPosition();
        const model = editor.getModel();

        if (!model) {
          this.isSettingInitialContent = false;

          return;
        }

        // Check if this is an initial load (lastContent === null) or a remote update
        const isInitialLoad = this.lastContent === null;

        if (isInitialLoad) {
          // Initial load: use setValue() which clears both undo and redo stacks (expected behavior)
          editor.setValue(decoded);
        } else {
          // Remote update: use executeEdits() to preserve undo stack and only clear redo stack
          const fullRange = model.getFullModelRange();
          const editOperation: editor.IIdentifiedSingleEditOperation = {
            range: fullRange,
            text: decoded,
            forceMoveMarkers: false,
          };

          // Execute edit with 'remote-update' source to preserve undo history
          editor.executeEdits('remote-update', [editOperation]);
        }

        // Update current editor content
        this.currentEditorContent.set(decoded);

        if (position) {
          editor.setPosition(position);
        }

        // Clear flag after a brief delay to allow change event to process
        setTimeout(() => {
          this.isSettingInitialContent = false;
        }, 0);
      }

      this.lastContent = content;

      // If preview was visible and the file is still previewable, keep it open
      if (wasPreviewVisible && this.isPreviewable()) {
        this.previewVisible.set(true);
      }
    } catch (error) {
      this.isSettingInitialContent = false;
    }
  }

  // Watch for content input changes
  ngDoCheck(): void {
    const content = this.content();

    // Update content for both text files (with editor) and binary files (images)
    if (content !== this.lastContent) {
      if (this.isBinary()) {
        // For binary files, update content to handle preview state
        this.updateContent();
      } else if (this.editorInstance()) {
        // For text files, update editor content
        this.updateContent();
      }
    }

    // Also check for filePath and encoding changes (fallback for effect)
    const filePath = this.filePath();
    const encoding = this.encoding();

    if (filePath !== this.lastFilePath || encoding !== this.lastEncoding) {
      this.lastFilePath = filePath;
      this.lastEncoding = encoding;
      this.updateBinaryAndLanguage();
    }
  }

  private updateBinaryAndLanguage(): void {
    const filePath = this.filePath();

    if (!filePath) {
      this.isBinary.set(false);
      this.language.set('plaintext');

      return;
    }

    const binaryExtensions = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp',
      '.svg',
      '.ico',
      '.webp',
      '.pdf',
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
    const lowerPath = filePath.toLowerCase();
    const isBinaryFile = binaryExtensions.some((ext) => lowerPath.endsWith(ext)) || this.encoding() === 'base64';

    this.isBinary.set(isBinaryFile);

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
    // Always update the language signal first
    const previousLanguage = this.language();

    this.language.set(newLanguage);

    // Update the model language if editor is already initialized
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

    // Emit save request - parent will get content from editorContent signal
    this.saveRequest.emit();
  }

  // Method to get current content (can be called by parent via ViewChild if needed)
  getCurrentContent(): string | null {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return null;
    }

    try {
      const value = editor.getValue();

      return btoa(value);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if the current file is previewable (markdown only - images are handled separately)
   */
  readonly isPreviewable = computed(() => {
    return this.isMarkdown();
  });

  /**
   * Check if the current file is markdown
   */
  readonly isMarkdown = computed(() => {
    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();

    return lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown');
  });

  /**
   * Check if the current file is an image
   */
  readonly isImage = computed(() => {
    const filePath = this.filePath();

    if (!filePath) {
      return false;
    }

    const lowerPath = filePath.toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.ico', '.webp'];

    return imageExtensions.some((ext) => lowerPath.endsWith(ext));
  });

  /**
   * Get image preview data URL
   * Uses base64 content directly from server without decoding/re-encoding
   */
  readonly imagePreviewUrl = computed<string | null>(() => {
    if (!this.isImage()) {
      return null;
    }

    const content = this.content();

    if (!content) {
      return null;
    }

    // Determine MIME type from file extension
    const filePath = this.filePath();

    if (!filePath) {
      return null;
    }

    const lowerPath = filePath.toLowerCase();
    let mimeType = 'image/png'; // default

    if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
      mimeType = 'image/jpeg';
    } else if (lowerPath.endsWith('.gif')) {
      mimeType = 'image/gif';
    } else if (lowerPath.endsWith('.bmp')) {
      mimeType = 'image/bmp';
    } else if (lowerPath.endsWith('.svg')) {
      mimeType = 'image/svg+xml';
    } else if (lowerPath.endsWith('.ico')) {
      mimeType = 'image/x-icon';
    } else if (lowerPath.endsWith('.webp')) {
      mimeType = 'image/webp';
    } else if (lowerPath.endsWith('.png')) {
      mimeType = 'image/png';
    }

    // Build data URL directly with base64 content from server
    return `data:${mimeType};base64,${content}`;
  });

  /**
   * Get markdown preview HTML
   * Uses live editor content for real-time preview, falls back to input content if editor not available
   */
  readonly markdownPreviewHtml = computed<SafeHtml | null>(() => {
    if (!this.isMarkdown()) {
      return null;
    }

    // Read markedLoaded to trigger recomputation when marked loads
    this.markedLoaded();

    // Use current editor content for live preview, or fall back to input content
    const editorContent = this.currentEditorContent();
    const inputContent = this.content();
    // Prefer editor content if available (for live preview), otherwise use input content
    let markdownText: string | null = null;

    if (editorContent) {
      // Editor content is already decoded (plain text)
      markdownText = editorContent;
    } else if (inputContent) {
      // Input content is base64 encoded, need to decode
      try {
        markdownText = base64ToUtf8(inputContent);
      } catch (error) {
        return null;
      }
    } else {
      return null;
    }

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
      } else {
        // Return escaped text as fallback while marked is loading
        const escaped = markdownText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return this.sanitizer.bypassSecurityTrustHtml(escaped);
      }
    } catch (error) {
      return null;
    }
  });

  /**
   * Toggle preview visibility
   */
  togglePreview(): void {
    this.previewVisible.set(!this.previewVisible());
  }

  /**
   * Close preview
   */
  closePreview(): void {
    this.previewVisible.set(false);
  }

  /**
   * Load marked library asynchronously
   */
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

  /**
   * Trigger undo action in Monaco editor
   */
  undo(): void {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return;
    }

    editor.trigger('keyboard', 'undo', null);
  }

  /**
   * Trigger redo action in Monaco editor
   */
  redo(): void {
    const editor = this.editorInstance();

    if (!editor || this.isBinary()) {
      return;
    }

    editor.trigger('keyboard', 'redo', null);
  }
}
