import type { EventEmitter } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

// The real ngx-monaco-editor loads Monaco through an AMD loader; replace it with a stub that emits a fake editor.
jest.mock('ngx-monaco-editor-v2', () => {
  const { Component, EventEmitter, Input, Output } =
    jest.requireActual<typeof import('@angular/core')>('@angular/core');

  // Mirrors the third-party selector / output names on purpose.
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'ngx-monaco-editor', standalone: true, template: '' })
  class EditorStubComponent {
    @Input() options: unknown;
    // eslint-disable-next-line @angular-eslint/no-output-on-prefix
    @Output() readonly onInit = new EventEmitter<unknown>();
  }

  return { MonacoEditorModule: EditorStubComponent };
});

import { FPC_MONACO_THEME_DARK, FPC_MONACO_THEME_LIGHT, FpcCodeEditorComponent } from './code-editor.component';
import { type FpcCodeDiagnostic, fpcYamlValidator } from './code-editor.validators';

class FakeModel {
  constructor(private readonly editor: FakeEditor) {}

  getLineCount(): number {
    return this.editor.value.split('\n').length;
  }

  getLineMaxColumn(line: number): number {
    return (this.editor.value.split('\n')[line - 1] ?? '').length + 1;
  }
}

class FakeEditor {
  value = '';
  position = { lineNumber: 1, column: 1 };
  options: Record<string, unknown> = {};
  private listener: (() => void) | null = null;
  readonly model = new FakeModel(this);

  getValue = jest.fn(() => this.value);
  setValue = jest.fn((value: string) => {
    this.value = value;
    this.listener?.();
  });
  getPosition = jest.fn(() => this.position);
  setPosition = jest.fn();
  getModel = jest.fn(() => this.model);
  updateOptions = jest.fn((options: Record<string, unknown>) => Object.assign(this.options, options));
  focus = jest.fn();
  revealPositionInCenter = jest.fn();
  onDidChangeModelContent = jest.fn((listener: () => void) => {
    this.listener = listener;

    return { dispose: jest.fn() };
  });

  type(value: string): void {
    this.value = value;
    this.listener?.();
  }
}

const monaco = {
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  editor: {
    defineTheme: jest.fn(),
    setTheme: jest.fn(),
    setModelLanguage: jest.fn(),
    setModelMarkers: jest.fn(),
  },
};

describe('FpcCodeEditorComponent', () => {
  let fixture: ComponentFixture<FpcCodeEditorComponent>;
  let component: FpcCodeEditorComponent;
  let editor: FakeEditor;

  function initEditor(): void {
    const stub = fixture.debugElement.children[0].componentInstance as { onInit: EventEmitter<unknown> };

    stub.onInit.emit(editor);
    fixture.detectChanges();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (globalThis as { monaco?: unknown }).monaco = monaco;
    document.documentElement.removeAttribute('data-bs-theme');
    editor = new FakeEditor();
    fixture = TestBed.createComponent(FpcCodeEditorComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as { monaco?: unknown }).monaco;
  });

  it('passes initial options to ngx-monaco-editor and applies the brand theme on init', () => {
    fixture.componentRef.setInput('language', 'yaml');
    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('value', 'a: 1');
    fixture.detectChanges();

    const stub = fixture.debugElement.children[0].componentInstance as { options: unknown };

    expect(stub.options).toEqual(
      expect.objectContaining({ language: 'yaml', readOnly: true, theme: FPC_MONACO_THEME_LIGHT }),
    );

    initEditor();

    expect(editor.value).toBe('a: 1');
    expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
      FPC_MONACO_THEME_LIGHT,
      expect.objectContaining({ base: 'vs' }),
    );
    expect(monaco.editor.setTheme).toHaveBeenCalledWith(FPC_MONACO_THEME_LIGHT);
    expect(monaco.editor.setModelLanguage).toHaveBeenCalledWith(editor.model, 'yaml');
    expect((fixture.nativeElement as HTMLElement).style.height).toBe('20rem');
  });

  it('switches to the dark theme when data-bs-theme changes', async () => {
    fixture.detectChanges();
    initEditor();
    monaco.editor.setTheme.mockClear();

    document.documentElement.setAttribute('data-bs-theme', 'dark');
    await Promise.resolve();

    expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
      FPC_MONACO_THEME_DARK,
      expect.objectContaining({ base: 'vs-dark' }),
    );
    expect(monaco.editor.setTheme).toHaveBeenCalledWith(FPC_MONACO_THEME_DARK);
    document.documentElement.removeAttribute('data-bs-theme');
  });

  it('emits valueChange for user edits but not for external value updates', () => {
    const spy = jest.fn();

    component.valueChange.subscribe(spy);
    fixture.detectChanges();
    initEditor();

    fixture.componentRef.setInput('value', 'external');
    fixture.detectChanges();
    expect(editor.value).toBe('external');
    expect(editor.setPosition).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();

    editor.type('typed');
    expect(spy).toHaveBeenCalledWith('typed');

    // Echoing the same value back must not reset the editor.
    editor.setValue.mockClear();
    fixture.componentRef.setInput('value', 'typed');
    fixture.detectChanges();
    expect(editor.setValue).not.toHaveBeenCalled();
  });

  it('applies readOnly / fontSize changes to the live editor', () => {
    fixture.detectChanges();
    initEditor();

    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('fontSize', 15);
    fixture.detectChanges();

    expect(editor.updateOptions).toHaveBeenLastCalledWith({ readOnly: true, fontSize: 15 });
  });

  it('validates on init and debounced after edits, sets markers and emits diagnostics', () => {
    const diagnostics: FpcCodeDiagnostic[][] = [];

    component.diagnosticsChange.subscribe((value) => diagnostics.push(value));
    fixture.componentRef.setInput('language', 'yaml');
    fixture.componentRef.setInput('value', 'replicas: 2\n');
    fixture.componentRef.setInput(
      'validate',
      fpcYamlValidator((doc) =>
        typeof (doc as { replicas?: unknown })?.replicas === 'number'
          ? []
          : [{ path: ['replicas'], message: 'must be a number' }],
      ),
    );
    fixture.detectChanges();
    initEditor();

    expect(monaco.editor.setModelMarkers).toHaveBeenLastCalledWith(editor.model, 'fpc-code-editor', []);

    editor.type('replicas: two\n');
    expect(diagnostics).toEqual([]);

    jest.advanceTimersByTime(300);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual([
      expect.objectContaining({ line: 1, column: 11, severity: 'error', message: 'replicas: must be a number' }),
    ]);
    expect(monaco.editor.setModelMarkers).toHaveBeenLastCalledWith(editor.model, 'fpc-code-editor', [
      expect.objectContaining({
        severity: 8,
        startLineNumber: 1,
        startColumn: 11,
        message: 'replicas: must be a number',
      }),
    ]);

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('fpc-code-editor--invalid');
  });

  it('validates value input changes even before Monaco is loaded', () => {
    const spy = jest.fn();

    component.diagnosticsChange.subscribe(spy);
    fixture.componentRef.setInput('validate', fpcYamlValidator());
    fixture.componentRef.setInput('value', 'a: [1, 2');
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith([expect.objectContaining({ severity: 'error' })]);
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
  });

  it('reports a throwing validator as a diagnostic', () => {
    const spy = jest.fn();

    component.diagnosticsChange.subscribe(spy);
    fixture.componentRef.setInput('validate', () => {
      throw new Error('boom');
    });
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith([expect.objectContaining({ message: 'Validation failed: boom' })]);
  });

  it('clears markers on destroy', () => {
    fixture.detectChanges();
    initEditor();
    monaco.editor.setModelMarkers.mockClear();

    fixture.destroy();

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(editor.model, 'fpc-code-editor', []);
  });
});
