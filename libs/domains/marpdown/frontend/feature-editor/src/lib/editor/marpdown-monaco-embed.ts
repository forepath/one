import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';

const MIN_HEIGHT_PX = 40;

export function resolveMonacoTheme(): 'vs' | 'vs-dark' {
  if (typeof document === 'undefined') {
    return 'vs';
  }

  return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'vs-dark' : 'vs';
}

export interface AutoHeightMonacoEmbed {
  container: HTMLElement;
  editor: editor.IStandaloneCodeEditor;
  dispose: () => void;
}

export function createAutoHeightMonacoEmbed(initialValue: string, language: string): AutoHeightMonacoEmbed {
  const container = document.createElement('div');
  container.className = 'marpdown-monaco-embed';

  const editorInstance = monaco.editor.create(container, {
    value: initialValue,
    language,
    theme: resolveMonacoTheme(),
    automaticLayout: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 8,
    lineNumbersMinChars: 0,
    renderLineHighlight: 'line',
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'auto',
      handleMouseWheel: false,
    },
    wordWrap: 'on',
    tabSize: 2,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    padding: { top: 8, bottom: 8 },
    contextmenu: false,
  });

  const layoutEditor = (): void => {
    const width = container.clientWidth || container.getBoundingClientRect().width || 320;
    const height = Math.max(MIN_HEIGHT_PX, editorInstance.getContentHeight());

    container.style.height = `${height}px`;
    editorInstance.layout({ width, height });
  };

  const themeObserver = new MutationObserver(() => {
    monaco.editor.setTheme(resolveMonacoTheme());
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
  });

  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          layoutEditor();
        })
      : null;

  resizeObserver?.observe(container);

  const contentSizeDisposable = editorInstance.onDidContentSizeChange(() => {
    layoutEditor();
  });

  requestAnimationFrame(() => {
    layoutEditor();
  });

  return {
    container,
    editor: editorInstance,
    dispose: () => {
      contentSizeDisposable.dispose();
      themeObserver.disconnect();
      resizeObserver?.disconnect();
      editorInstance.dispose();
    },
  };
}
