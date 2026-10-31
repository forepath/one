import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  NgZone,
  output,
  signal,
  untracked,
} from '@angular/core';
import type * as Monaco from 'monaco-editor';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

import {
  type FpcBrandPalette,
  fpcIsDarkTheme,
  fpcObserveBrandChanges,
  fpcReadBrandPalette,
  fpcWithAlpha,
} from '../brand-tokens/brand-tokens';
import type { FpcCodeDiagnostic, FpcCodeEditorValidator } from './code-editor.validators';

type MonacoApi = typeof Monaco;
type StandaloneEditor = Monaco.editor.IStandaloneCodeEditor;

export type FpcCodeEditorLanguage =
  | 'yaml'
  | 'json'
  | 'plaintext'
  | 'shell'
  | 'ini'
  | 'dockerfile'
  | 'markdown'
  | 'typescript'
  | 'javascript'
  | (string & Record<never, never>);

export const FPC_MONACO_THEME_LIGHT = 'fpc-light';
export const FPC_MONACO_THEME_DARK = 'fpc-dark';

const MARKER_OWNER = 'fpc-code-editor';

/** Kind of a highlighted line range (e.g. a line diff against another version of the text). */
export type FpcCodeLineHighlightKind = 'added' | 'removed' | 'changed';

/** A whole-line highlight (1-based lines, `endLine` inclusive) with an optional hover message. */
export interface FpcCodeLineHighlight {
  line: number;
  endLine?: number;
  kind: FpcCodeLineHighlightKind;
  message?: string;
}

/** Monaco decorations of line highlights (whole-line background + gutter bar), clamped to the model. */
export function fpcLineDecorations(
  highlights: readonly FpcCodeLineHighlight[],
  lineCount: number,
): Monaco.editor.IModelDeltaDecoration[] {
  return highlights
    .filter((h) => h.line >= 1 && h.line <= lineCount)
    .map((h) => ({
      range: {
        startLineNumber: h.line,
        startColumn: 1,
        endLineNumber: Math.min(Math.max(h.endLine ?? h.line, h.line), lineCount),
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        className: `fpc-code-line fpc-code-line--${h.kind}`,
        linesDecorationsClassName: `fpc-code-gutter fpc-code-gutter--${h.kind}`,
        ...(h.message ? { hoverMessage: { value: h.message } } : {}),
      },
    }));
}
const VALIDATION_DEBOUNCE_MS = 250;

/** The global `monaco` namespace that `ngx-monaco-editor-v2` loads (null until it is loaded). */
function monacoApi(): MonacoApi | null {
  return (globalThis as { monaco?: MonacoApi }).monaco ?? null;
}

/** Monaco theme data for the active brand palette (surface, gutter, cursor, selection, markers). */
export function fpcMonacoTheme(palette: FpcBrandPalette): Monaco.editor.IStandaloneThemeData {
  return {
    base: palette.isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': palette.bodyBg,
      'editor.foreground': palette.bodyColor,
      'editorGutter.background': palette.bodyBg,
      'editorLineNumber.foreground': palette.secondaryColor,
      'editorLineNumber.activeForeground': palette.bodyColor,
      'editorCursor.foreground': palette.primary,
      'editor.lineHighlightBackground': palette.tertiaryBg,
      'editor.lineHighlightBorder': palette.tertiaryBg,
      'editor.selectionBackground': fpcWithAlpha(palette.primary, 0.3),
      'editor.inactiveSelectionBackground': fpcWithAlpha(palette.primary, 0.15),
      'editorWidget.background': palette.tertiaryBg,
      'editorWidget.border': palette.borderColor,
      'editorHoverWidget.background': palette.tertiaryBg,
      'editorHoverWidget.border': palette.borderColor,
      'editorError.foreground': palette.danger,
      'editorWarning.foreground': palette.warning,
      'editorInfo.foreground': palette.info,
      focusBorder: palette.primary,
    },
  };
}

/** (Re)defines the `fpc-light` / `fpc-dark` Monaco themes from the brand and activates the right one. */
export function fpcApplyMonacoTheme(monaco: MonacoApi, palette: FpcBrandPalette = fpcReadBrandPalette()): void {
  const name = palette.isDark ? FPC_MONACO_THEME_DARK : FPC_MONACO_THEME_LIGHT;

  monaco.editor.defineTheme(name, fpcMonacoTheme(palette));
  monaco.editor.setTheme(name);
}

function markerSeverity(monaco: MonacoApi, severity: FpcCodeDiagnostic['severity']): Monaco.MarkerSeverity {
  const fallback = { error: 8, warning: 4, info: 2 } as const;
  const enumValue =
    monaco.MarkerSeverity?.[severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Info'];

  return (enumValue ?? fallback[severity]) as Monaco.MarkerSeverity;
}

function sameDiagnostics(a: readonly FpcCodeDiagnostic[], b: readonly FpcCodeDiagnostic[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Monaco code editor (via `ngx-monaco-editor-v2`) for YAML / JSON manifests and config files.
 *
 * The consumer must register the loader once, e.g. `provideMonacoEditor()` in the route or app
 * providers, and serve Monaco's AMD build under `assets/monaco/min/vs` (or pass a `baseUrl`).
 * `validate` diagnostics are shown as editor markers and emitted through `(diagnosticsChange)`;
 * `fpcYamlValidator()` / `fpcJsonValidator()` cover syntax plus path-based structural checks.
 * The theme is derived from the brand variables and follows `data-bs-theme` / `data-fpc-brand`.
 */
@Component({
  selector: 'fpc-code-editor',
  standalone: true,
  imports: [MonacoEditorModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-code-editor',
    '[class.fpc-code-editor--readonly]': 'readOnly()',
    '[class.fpc-code-editor--invalid]': 'hasErrors()',
    '[style.height]': 'height()',
  },
  template: `<ngx-monaco-editor
    class="fpc-code-editor__editor"
    [options]="initialOptions()"
    (onInit)="onEditorInit($event)"
  />`,
  styleUrl: './code-editor.component.scss',
})
export class FpcCodeEditorComponent {
  private readonly ngZone = inject(NgZone);

  readonly value = input('');
  readonly language = input<FpcCodeEditorLanguage>('plaintext');
  readonly readOnly = input(false);
  /** CSS height of the editor (e.g. `20rem`, `100%`). */
  readonly height = input('20rem');
  readonly fontSize = input(13);
  /** Optional validator; its diagnostics become editor markers. */
  readonly validate = input<FpcCodeEditorValidator | null>(null);
  /** Whole-line highlights (e.g. a line diff), drawn as editor decorations. */
  readonly lineHighlights = input<readonly FpcCodeLineHighlight[]>([]);

  readonly valueChange = output<string>();
  readonly diagnosticsChange = output<FpcCodeDiagnostic[]>();

  /**
   * Options passed to Monaco once (first render, after inputs are bound). The computed has no
   * tracked dependencies, so it never changes: ngx-monaco-editor would re-create the editor on new
   * options. Later input changes are applied to the live editor instead.
   */
  protected readonly initialOptions = computed<Monaco.editor.IStandaloneEditorConstructionOptions>(() =>
    untracked(() => ({
      theme: fpcIsDarkTheme() ? FPC_MONACO_THEME_DARK : FPC_MONACO_THEME_LIGHT,
      language: this.language(),
      readOnly: this.readOnly(),
      fontSize: this.fontSize(),
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      wordWrap: 'on',
      tabSize: 2,
      insertSpaces: true,
      quickSuggestions: false,
      fixedOverflowWidgets: true,
      renderLineHighlight: 'line',
    })),
  );

  protected readonly hasErrors = signal(false);

  private editor: StandaloneEditor | null = null;
  private text = '';
  private applyingExternalValue = false;
  private diagnostics: FpcCodeDiagnostic[] = [];
  private validationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  private stopBrandObserver: (() => void) | null = null;
  private decorationIds: string[] = [];

  constructor() {
    // External value → editor (keeps the cursor) and validation.
    effect(() => {
      const value = this.value();

      untracked(() => {
        if (value === this.text) {
          return;
        }

        this.text = value;
        this.writeToEditor(value);
        this.runValidation();
        this.applyDecorations();
      });
    });

    effect(() => {
      const language = this.language();

      untracked(() => {
        const model = this.editor?.getModel();
        const monaco = monacoApi();

        if (model && monaco) {
          monaco.editor.setModelLanguage(model, language);
        }

        this.runValidation();
      });
    });

    effect(() => {
      const readOnly = this.readOnly();
      const fontSize = this.fontSize();

      untracked(() => this.editor?.updateOptions({ readOnly, fontSize }));
    });

    effect(() => {
      this.validate();
      untracked(() => this.runValidation());
    });

    effect(() => {
      this.lineHighlights();
      untracked(() => this.applyDecorations());
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /** The live Monaco editor (null until loaded). */
  get instance(): StandaloneEditor | null {
    return this.editor;
  }

  /** Current diagnostics of the last validation run. */
  get currentDiagnostics(): readonly FpcCodeDiagnostic[] {
    return this.diagnostics;
  }

  focus(): void {
    this.editor?.focus();
  }

  /** Moves the cursor to a position (e.g. when a diagnostic is clicked in a problems list). */
  revealPosition(line: number, column = 1): void {
    if (!this.editor) {
      return;
    }

    this.editor.setPosition({ lineNumber: line, column });
    this.editor.revealPositionInCenter({ lineNumber: line, column });
    this.editor.focus();
  }

  protected onEditorInit(event: unknown): void {
    const editor = event as StandaloneEditor;

    if (!editor || typeof editor.getValue !== 'function') {
      return;
    }

    this.editor = editor;

    const monaco = monacoApi();

    if (monaco) {
      fpcApplyMonacoTheme(monaco);

      const model = editor.getModel();

      if (model) {
        monaco.editor.setModelLanguage(model, this.language());
      }
    }

    this.stopBrandObserver?.();
    this.stopBrandObserver = fpcObserveBrandChanges(() => {
      const api = monacoApi();

      if (api) {
        fpcApplyMonacoTheme(api);
      }
    });

    this.writeToEditor(this.text);

    this.disposables.push(
      editor.onDidChangeModelContent(() => {
        if (this.applyingExternalValue) {
          return;
        }

        const value = editor.getValue();

        this.text = value;
        this.ngZone.run(() => this.valueChange.emit(value));
        this.scheduleValidation();
      }),
    );

    this.runValidation();
    this.applyDecorations();
  }

  private applyDecorations(): void {
    const editor = this.editor;
    const model = editor?.getModel();

    if (!editor || !model || typeof editor.deltaDecorations !== 'function') {
      return;
    }

    this.decorationIds = editor.deltaDecorations(
      this.decorationIds,
      fpcLineDecorations(this.lineHighlights(), model.getLineCount()),
    );
  }

  private writeToEditor(value: string): void {
    const editor = this.editor;

    if (!editor || editor.getValue() === value) {
      return;
    }

    const position = editor.getPosition();

    this.applyingExternalValue = true;

    try {
      editor.setValue(value);

      if (position) {
        editor.setPosition(position);
      }
    } finally {
      this.applyingExternalValue = false;
    }
  }

  private scheduleValidation(): void {
    if (this.validationTimer) {
      clearTimeout(this.validationTimer);
    }

    this.ngZone.runOutsideAngular(() => {
      this.validationTimer = setTimeout(() => {
        this.validationTimer = null;
        this.runValidation();
      }, VALIDATION_DEBOUNCE_MS);
    });
  }

  private runValidation(): void {
    const validate = this.validate();
    let diagnostics: FpcCodeDiagnostic[] = [];

    if (validate) {
      try {
        diagnostics = [...validate(this.text, this.language())];
      } catch (error) {
        diagnostics = [
          {
            line: 1,
            column: 1,
            message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error',
          },
        ];
      }
    }

    this.applyMarkers(diagnostics);

    if (sameDiagnostics(diagnostics, this.diagnostics)) {
      return;
    }

    this.diagnostics = diagnostics;
    this.ngZone.run(() => {
      this.hasErrors.set(diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
      this.diagnosticsChange.emit(diagnostics);
    });
  }

  private applyMarkers(diagnostics: readonly FpcCodeDiagnostic[]): void {
    const monaco = monacoApi();
    const model = this.editor?.getModel();

    if (!monaco || !model) {
      return;
    }

    const lineCount = model.getLineCount();
    const markers = diagnostics.map((diagnostic) => {
      const line = Math.min(Math.max(diagnostic.line, 1), lineCount);
      const endLine = Math.min(Math.max(diagnostic.endLine ?? line, line), lineCount);

      return {
        severity: markerSeverity(monaco, diagnostic.severity),
        message: diagnostic.message,
        startLineNumber: line,
        startColumn: Math.max(diagnostic.column, 1),
        endLineNumber: endLine,
        endColumn: diagnostic.endColumn ?? model.getLineMaxColumn(endLine),
      };
    });

    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }

  private teardown(): void {
    if (this.validationTimer) {
      clearTimeout(this.validationTimer);
    }

    this.stopBrandObserver?.();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    const model = this.editor?.getModel();
    const monaco = monacoApi();

    if (model && monaco) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    }

    // ngx-monaco-editor disposes the editor itself.
    this.editor = null;
  }
}
