import { bootstrapApplication } from '@angular/platform-browser';
import { ENVIRONMENT, loadRuntimeEnvironment } from '@forepath/shared/frontend/util-configuration';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Create worker URLs that resolve to node_modules during build
// Use import.meta.url as base and construct path to node_modules
// From apps/frontend-agent-console/src/main.ts, go up 3 levels to workspace root, then into node_modules
const getWorkerUrl = (relativePath: string): URL => {
  // Get the directory of the current file (apps/frontend-agent-console/src/)
  const currentDir = new URL('.', import.meta.url);
  // Go up to workspace root: ../../
  const workspaceRoot = new URL('../../', currentDir);

  // Go into node_modules/monaco-editor/esm/vs/
  return new URL(`node_modules/monaco-editor/esm/vs/${relativePath}`, workspaceRoot);
};
// Lazy worker cache to avoid creating workers until they're actually needed
const workerCache: Record<string, Worker> = {};

// Configure Monaco Editor workers
// Simple approach: use getWorkerUrl to return absolute URLs
// This works regardless of deployment path (subfolder, root, etc.)
declare const self: Window & {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker;
  };
};

self.MonacoEnvironment = {
  getWorker: function (moduleId: string, label: string): Worker {
    // Lazy-load workers only when needed to avoid blocking initial render
    if (!workerCache[label]) {
      const workerPaths: Record<string, string> = {
        editorWorkerService: 'editor/editor.worker.js',
        typescript: 'language/typescript/ts.worker.js',
        javascript: 'language/typescript/ts.worker.js',
        css: 'language/css/css.worker.js',
        html: 'language/html/html.worker.js',
        json: 'language/json/json.worker.js',
      };
      const workerPath = workerPaths[label] || workerPaths['editorWorkerService'];

      workerCache[label] = new Worker(getWorkerUrl(workerPath), { type: 'module' });
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
