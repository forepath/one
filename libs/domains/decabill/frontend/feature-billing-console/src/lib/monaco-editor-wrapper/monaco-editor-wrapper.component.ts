import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, NgZone, OnDestroy, output, signal } from '@angular/core';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

import { applyDecabillMonacoEditorTheme } from './monaco-decabill-theme';
import { ThemeService } from '../theme.service';

@Component({
  selector: 'framework-monaco-editor-wrapper',
  standalone: true,
  imports: [CommonModule, MonacoEditorModule],
  templateUrl: './monaco-editor-wrapper.component.html',
  styleUrls: ['./monaco-editor-wrapper.component.scss'],
})
export class MonacoEditorWrapperComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly themeService = inject(ThemeService);

  value = input<string>('');
  language = input<string>('plaintext');
  readOnly = input<boolean>(false);
  editorHeight = input<string>('20rem');

  valueChange = output<string>();

  private readonly editorInstance = signal<editor.IStandaloneCodeEditor | null>(null);
  private contentChangeDisposable: { dispose: () => void } | null = null;
  private isApplyingExternalValue = false;

  readonly editorOptions = computed(() => ({
    theme: this.themeService.isDarkMode() ? 'decabill-vs-dark' : 'decabill-vs',
    language: this.language(),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on' as const,
    wordWrap: 'on' as const,
    readOnly: this.readOnly(),
    quickSuggestions: false,
    tabSize: 2,
  }));

  constructor() {
    effect(() => {
      applyDecabillMonacoEditorTheme(this.themeService.isDarkMode());
    });

    effect(() => {
      const externalValue = this.value();
      const editorInstance = this.editorInstance();

      if (!editorInstance || this.isApplyingExternalValue) {
        return;
      }

      const currentValue = editorInstance.getValue();

      if (currentValue === externalValue) {
        return;
      }

      this.isApplyingExternalValue = true;
      const position = editorInstance.getPosition();

      editorInstance.setValue(externalValue);

      if (position) {
        editorInstance.setPosition(position);
      }

      this.isApplyingExternalValue = false;
    });

    effect(() => {
      const language = this.language();
      const editorInstance = this.editorInstance();
      const model = editorInstance?.getModel();

      if (model) {
        monaco.editor.setModelLanguage(model, language);
      }
    });
  }

  ngOnDestroy(): void {
    this.contentChangeDisposable?.dispose();

    const editorInstance = this.editorInstance();

    if (editorInstance) {
      try {
        editorInstance.dispose();
      } catch {
        // Ignore disposal errors during teardown.
      }
    }
  }

  onEditorInit(event: editor.IStandaloneCodeEditor | unknown): void {
    const editorInstance = event as editor.IStandaloneCodeEditor;

    if (!editorInstance || typeof editorInstance.getValue !== 'function') {
      return;
    }

    this.editorInstance.set(editorInstance);
    applyDecabillMonacoEditorTheme(this.themeService.isDarkMode());

    const model = editorInstance.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, this.language());
    }

    this.isApplyingExternalValue = true;
    editorInstance.setValue(this.value());
    this.isApplyingExternalValue = false;

    this.contentChangeDisposable?.dispose();
    this.contentChangeDisposable = editorInstance.onDidChangeModelContent(() => {
      if (this.isApplyingExternalValue || this.readOnly()) {
        return;
      }

      const currentEditor = this.editorInstance();

      if (!currentEditor) {
        return;
      }

      this.ngZone.run(() => {
        this.valueChange.emit(currentEditor.getValue());
      });
    });

    requestAnimationFrame(() => {
      editorInstance.layout();
    });
  }

  undo(): void {
    const editorInstance = this.editorInstance();

    if (!editorInstance || this.readOnly()) {
      return;
    }

    editorInstance.trigger('keyboard', 'undo', null);
  }

  redo(): void {
    const editorInstance = this.editorInstance();

    if (!editorInstance || this.readOnly()) {
      return;
    }

    editorInstance.trigger('keyboard', 'redo', null);
  }
}
