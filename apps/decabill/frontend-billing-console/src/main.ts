import { bootstrapApplication } from '@angular/platform-browser';
import { ENVIRONMENT, loadRuntimeEnvironment } from '@forepath/shared/frontend/util-configuration';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

const workerPaths: Record<string, string> = {
  editorWorkerService: 'editor/editor.worker.js',
  typescript: 'language/typescript/ts.worker.js',
  javascript: 'language/typescript/ts.worker.js',
  css: 'language/css/css.worker.js',
  html: 'language/html/html.worker.js',
  json: 'language/json/json.worker.js',
};

function getMonacoWorkerUrl(relativePath: string): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(`assets/monaco/esm/vs/${relativePath}`, document.baseURI).href;
  }

  const currentDir = new URL('.', import.meta.url);
  const workspaceRoot = new URL('../../', currentDir);

  return new URL(`node_modules/monaco-editor/esm/vs/${relativePath}`, workspaceRoot).href;
}

const workerCache: Record<string, Worker> = {};

declare const self: Window & {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker;
  };
};

self.MonacoEnvironment = {
  getWorker: function (_moduleId: string, label: string): Worker {
    if (!workerCache[label]) {
      const workerPath = workerPaths[label] || workerPaths['editorWorkerService'];

      workerCache[label] = new Worker(getMonacoWorkerUrl(workerPath), { type: 'module' });
    }

    return workerCache[label];
  },
};

loadRuntimeEnvironment().then((environment) => {
  bootstrapApplication(AppComponent, {
    ...appConfig,
    providers: [
      ...appConfig.providers,
      {
        provide: ENVIRONMENT,
        useValue: environment,
      },
    ],
  }).catch((err) => console.error(err));
});
