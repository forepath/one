import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  NgZone,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';

import { ThemeService } from '../theme.service';

@Component({
  selector: 'marpdown-presentation-monaco-editor',
  standalone: true,
  imports: [CommonModule, MonacoEditorModule],
  templateUrl: './presentation-monaco-editor.component.html',
  styleUrls: ['./presentation-monaco-editor.component.scss'],
})
export class PresentationMonacoEditorComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly themeService = inject(ThemeService);

  markdown = input<string>('');
  markdownChange = output<string>();

  private readonly editorInstance = signal<editor.IStandaloneCodeEditor | null>(null);
  private contentChangeDisposable: { dispose: () => void } | null = null;
  private isApplyingExternalValue = false;

  readonly editorOptions = computed(() => ({
    theme: this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light',
    language: 'markdown',
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on' as const,
    wordWrap: 'on' as const,
    tabSize: 2,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on' as const,
    tabCompletion: 'on' as const,
    wordBasedSuggestions: true,
  }));

  constructor() {
    effect(() => {
      const isDarkMode = this.themeService.isDarkMode();
      const theme = isDarkMode ? 'vs-dark' : 'vs-light';

      monaco.editor.setTheme(theme);
    });

    effect(() => {
      const externalValue = this.markdown();
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
    monaco.editor.setTheme(this.themeService.isDarkMode() ? 'vs-dark' : 'vs-light');

    const model = editorInstance.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, 'markdown');
    }

    this.isApplyingExternalValue = true;
    editorInstance.setValue(this.markdown());
    this.isApplyingExternalValue = false;

    this.contentChangeDisposable?.dispose();
    this.contentChangeDisposable = editorInstance.onDidChangeModelContent(() => {
      if (this.isApplyingExternalValue) {
        return;
      }

      const currentEditor = this.editorInstance();

      if (!currentEditor) {
        return;
      }

      this.ngZone.run(() => {
        this.markdownChange.emit(currentEditor.getValue());
      });
    });

    requestAnimationFrame(() => {
      editorInstance.layout();
    });
  }

  undo(): void {
    const editorInstance = this.editorInstance();

    if (!editorInstance) {
      return;
    }

    editorInstance.trigger('keyboard', 'undo', null);
  }

  redo(): void {
    const editorInstance = this.editorInstance();

    if (!editorInstance) {
      return;
    }

    editorInstance.trigger('keyboard', 'redo', null);
  }
}
