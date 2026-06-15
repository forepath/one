import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  AfterViewInit,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VcsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';

import { ThemeService } from '../../theme.service';

/**
 * Decode base64 string to UTF-8 string.
 * atob() decodes to Latin-1, so we need to properly convert to UTF-8.
 */
function base64ToUtf8(base64: string): string {
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));

  return new TextDecoder('utf-8').decode(bytes);
}

@Component({
  selector: 'framework-git-diff-viewer',
  imports: [CommonModule],
  templateUrl: './git-diff-viewer.component.html',
  styleUrls: ['./git-diff-viewer.component.scss'],
  standalone: true,
})
export class GitDiffViewerComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly vcsFacade = inject(VcsFacade);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('diffEditorContainer', { static: false })
  private diffEditorContainer!: ElementRef<HTMLDivElement>;

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  filePath = input<string | null>(null);
  visible = input<boolean>(false);

  // Outputs
  closed = output<void>();

  // Internal state
  private diffEditor: editor.IStandaloneDiffEditor | null = null;
  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  private currentDiff: {
    path: string;
    originalContent: string;
    modifiedContent: string;
    encoding: 'utf-8' | 'base64';
    isBinary: boolean;
    originalSize?: number;
    modifiedSize?: number;
  } | null = null;
  private originalDecorations: string[] = [];
  private modifiedDecorations: string[] = [];

  // Observables
  readonly diff$ = this.vcsFacade.diff$;
  readonly loadingDiff$ = this.vcsFacade.loadingDiff$;

  constructor() {
    // Watch for filePath changes to load diff
    effect(() => {
      const filePath = this.filePath();
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (filePath && clientId && agentId && this.visible()) {
        this.loadDiff();
      }
    });

    // Watch for diff changes to update editor
    this.diff$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((diff) => {
      if (diff) {
        // Store the diff for later use
        this.currentDiff = diff;

        // Update editor if it exists, otherwise it will be applied when editor is created
        if (this.diffEditor) {
          this.updateDiffEditor(diff);
        }
      } else {
        // Clear diff when it's cleared
        this.currentDiff = null;
      }
    });

    // Watch for loading state
    this.loadingDiff$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((loading) => {
      this.loading.set(loading);
    });

    // Note: Editor creation is handled in ngAfterViewChecked to ensure container is available

    // Watch theme changes
    effect(() => {
      const theme = this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light';

      if (this.diffEditor) {
        monaco.editor.setTheme(theme);
      }
    });
  }

  ngAfterViewInit(): void {
    // Initial check - but container might not be rendered yet if loading
    this.tryCreateEditor();
  }

  ngAfterViewChecked(): void {
    // Check after every view check to catch when container becomes available
    this.tryCreateEditor();
  }

  private tryCreateEditor(): void {
    // Only create if all conditions are met
    if (
      this.visible() &&
      !this.loading() &&
      !this.error() &&
      this.diffEditorContainer?.nativeElement &&
      !this.diffEditor
    ) {
      // Use setTimeout to ensure DOM is fully rendered and dimensions are calculated
      setTimeout(() => {
        if (
          this.visible() &&
          !this.loading() &&
          !this.error() &&
          this.diffEditorContainer?.nativeElement &&
          !this.diffEditor
        ) {
          this.createDiffEditor();
        }
      }, 0);
    }
  }

  ngOnDestroy(): void {
    if (this.diffEditor) {
      // Clear decorations
      const originalEditor = this.diffEditor.getOriginalEditor();
      const modifiedEditor = this.diffEditor.getModifiedEditor();

      this.originalDecorations = originalEditor.deltaDecorations(this.originalDecorations, []);
      this.modifiedDecorations = modifiedEditor.deltaDecorations(this.modifiedDecorations, []);

      // Dispose editor (this will handle model cleanup)
      this.diffEditor.dispose();
      this.diffEditor = null;
    }
  }

  private createDiffEditor(): void {
    if (!this.diffEditorContainer?.nativeElement || this.diffEditor) {
      return;
    }

    const container = this.diffEditorContainer.nativeElement;

    // Ensure container has dimensions
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      // Retry after a short delay if container doesn't have dimensions yet
      setTimeout(() => this.createDiffEditor(), 100);

      return;
    }

    const theme = this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light';

    this.diffEditor = monaco.editor.createDiffEditor(container, {
      theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 14,
      lineNumbers: 'on',
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      originalEditable: false,
    });

    // Set initial empty content or apply current diff if available
    if (this.currentDiff) {
      // Apply the stored diff immediately
      this.updateDiffEditor(this.currentDiff);
    } else {
      // Set empty content if no diff available yet
      this.diffEditor.setModel({
        original: monaco.editor.createModel('', 'plaintext'),
        modified: monaco.editor.createModel('', 'plaintext'),
      });
    }
  }

  private loadDiff(): void {
    const filePath = this.filePath();
    const clientId = this.clientId();
    const agentId = this.agentId();

    if (!filePath || !clientId || !agentId) {
      return;
    }

    this.error.set(null);
    this.vcsFacade.loadDiff(clientId, agentId, filePath);
  }

  private updateDiffEditor(diff: {
    path: string;
    originalContent: string;
    modifiedContent: string;
    encoding: 'utf-8' | 'base64';
    isBinary: boolean;
    originalSize?: number;
    modifiedSize?: number;
  }): void {
    if (!this.diffEditor) {
      return;
    }

    if (diff.isBinary) {
      // For binary files, show size information
      const originalSize = diff.originalSize ?? 0;
      const modifiedSize = diff.modifiedSize ?? 0;
      const sizeDiff = modifiedSize - originalSize;
      const sizeDiffText = sizeDiff > 0 ? `+${sizeDiff}` : sizeDiff < 0 ? `${sizeDiff}` : '0';
      const originalText = `Binary file\nOriginal size: ${originalSize} bytes`;
      const modifiedText = `Binary file\nModified size: ${modifiedSize} bytes\nSize difference: ${sizeDiffText} bytes`;
      // Create models for binary file info
      const originalUri = monaco.Uri.parse(`file:///${diff.path}.original.binary`);
      const modifiedUri = monaco.Uri.parse(`file:///${diff.path}.modified.binary`);
      // Dispose existing models if they exist
      const existingOriginal = monaco.editor.getModel(originalUri);
      const existingModified = monaco.editor.getModel(modifiedUri);

      if (existingOriginal) {
        existingOriginal.dispose();
      }

      if (existingModified) {
        existingModified.dispose();
      }

      // Create and set models
      const originalModel = monaco.editor.createModel(originalText, 'plaintext', originalUri);
      const modifiedModel = monaco.editor.createModel(modifiedText, 'plaintext', modifiedUri);

      this.diffEditor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      this.diffEditor.layout();

      return;
    }

    // For text files, decode base64 content
    // Note: The API always returns base64-encoded content, regardless of the encoding field.
    // The encoding field indicates file type: 'utf-8' = text file, 'base64' = binary file
    let originalText = '';
    let modifiedText = '';

    try {
      // Always decode base64 for text files (encoding === 'utf-8' means it's a text file)
      // The content is always base64-encoded in the API response
      originalText = diff.originalContent ? base64ToUtf8(diff.originalContent) : '';
      modifiedText = diff.modifiedContent ? base64ToUtf8(diff.modifiedContent) : '';
    } catch (error) {
      console.error('Failed to decode file content:', error);
      this.error.set('Failed to decode file content');

      return;
    }

    // Detect language from file path
    const language = this.detectLanguage(diff.path);
    // Create models with URIs - Monaco diff editor automatically computes diffs
    const originalUri = monaco.Uri.parse(`file:///${diff.path}.original`);
    const modifiedUri = monaco.Uri.parse(`file:///${diff.path}.modified`);
    // Dispose existing models if they exist
    const existingOriginal = monaco.editor.getModel(originalUri);
    const existingModified = monaco.editor.getModel(modifiedUri);

    if (existingOriginal) {
      existingOriginal.dispose();
    }

    if (existingModified) {
      existingModified.dispose();
    }

    // Create new models
    const originalModel = monaco.editor.createModel(originalText, language, originalUri);
    const modifiedModel = monaco.editor.createModel(modifiedText, language, modifiedUri);

    // Set models - Monaco automatically computes and displays the diff
    this.diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    // Layout update to ensure proper rendering
    this.diffEditor.layout();

    // Add custom decorations to highlight differences
    // This ensures visual indicators even if Monaco's built-in styles don't apply
    setTimeout(() => {
      this.addCustomDiffDecorations(originalText, modifiedText);
    }, 100);
  }

  private addCustomDiffDecorations(originalText: string, modifiedText: string): void {
    if (!this.diffEditor) {
      return;
    }

    const originalEditor = this.diffEditor.getOriginalEditor();
    const modifiedEditor = this.diffEditor.getModifiedEditor();
    const originalModel = originalEditor.getModel();
    const modifiedModel = modifiedEditor.getModel();

    if (!originalModel || !modifiedModel) {
      return;
    }

    // Clear existing decorations
    this.originalDecorations = originalEditor.deltaDecorations(this.originalDecorations, []);
    this.modifiedDecorations = modifiedEditor.deltaDecorations(this.modifiedDecorations, []);

    const originalLines = originalText.split('\n');
    const modifiedLines = modifiedText.split('\n');
    const originalDecorations: editor.IModelDeltaDecoration[] = [];
    const modifiedDecorations: editor.IModelDeltaDecoration[] = [];
    // Simple diff: find lines that exist in one but not the other
    const originalSet = new Set(originalLines);
    const modifiedSet = new Set(modifiedLines);

    // Mark deleted lines in original (red)
    originalLines.forEach((line, index) => {
      if (!modifiedSet.has(line) && line.trim() !== '') {
        originalDecorations.push({
          range: new monaco.Range(index + 1, 1, index + 1, line.length + 1),
          options: {
            isWholeLine: true,
            className: 'monaco-diff-deleted-line',
            minimap: {
              color: { id: 'diff.deleted' },
              position: monaco.editor.MinimapPosition.Inline,
            },
          },
        });
      }
    });

    // Mark added lines in modified (green)
    modifiedLines.forEach((line, index) => {
      if (!originalSet.has(line) && line.trim() !== '') {
        modifiedDecorations.push({
          range: new monaco.Range(index + 1, 1, index + 1, line.length + 1),
          options: {
            isWholeLine: true,
            className: 'monaco-diff-added-line',
            minimap: {
              color: { id: 'diff.added' },
              position: monaco.editor.MinimapPosition.Inline,
            },
          },
        });
      }
    });

    // Apply decorations
    this.originalDecorations = originalEditor.deltaDecorations(this.originalDecorations, originalDecorations);
    this.modifiedDecorations = modifiedEditor.deltaDecorations(this.modifiedDecorations, modifiedDecorations);
  }

  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      py: 'python',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      php: 'php',
      go: 'go',
      rs: 'rust',
      vue: 'vue',
      sh: 'shell',
      bash: 'shell',
      sql: 'sql',
    };

    return languageMap[ext || ''] || 'plaintext';
  }

  onClose(): void {
    this.vcsFacade.clearDiff();
    this.currentDiff = null;
    this.closed.emit();
  }
}
