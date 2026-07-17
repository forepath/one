#!/usr/bin/env node
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

import { workspaceRoot } from '@nx/devkit';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseArgs(argv: string[]): { port: number; dir: string } {
  let port = 4211;
  let dir = path.join(workspaceRoot, 'graph');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      port = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
    } else if (arg === '--dir' && argv[i + 1]) {
      dir = path.resolve(workspaceRoot, argv[++i]);
    } else if (arg.startsWith('--dir=')) {
      dir = path.resolve(workspaceRoot, arg.slice('--dir='.length));
    }
  }

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return { port, dir };
}

function safeJoin(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] || '/');
  const relative = decoded === '/' ? 'graph.html' : decoded.replace(/^\/+/, '');
  const absolute = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  if (!absolute.startsWith(rootResolved + path.sep) && absolute !== rootResolved) {
    return null;
  }
  return absolute;
}

function main(): void {
  const { port, dir } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(path.join(dir, 'graph.html'))) {
    console.error(`[forepath/graph] Missing ${path.join(dir, 'graph.html')}. Run: nx run graph:generate-kg`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const filePath = safeJoin(dir, req.url || '/');
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[forepath/graph] Serving ${dir}`);
    console.log(`[forepath/graph] Open http://127.0.0.1:${port}/`);
  });
}

main();
