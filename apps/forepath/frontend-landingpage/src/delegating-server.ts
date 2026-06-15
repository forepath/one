import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AVAILABLE_LOCALES = ['en', 'de'];
const DEFAULT_LOCALE = 'en';

const localeServers = new Map<string, any>();

async function loadLocaleServers() {
  for (const locale of AVAILABLE_LOCALES) {
    try {
      const serverPath = join(__dirname, locale, 'server.mjs');

      if (existsSync(serverPath)) {
        const serverModule = await import(serverPath);
        localeServers.set(locale, serverModule.default);
        console.log(`Loaded server for locale: ${locale}`);
      } else {
        console.warn(`Server file not found for locale: ${locale} at ${serverPath}`);
      }
    } catch (error: any) {
      console.warn(`Failed to load server for locale ${locale}:`, error.message);
    }
  }
}

function getLocaleFromRequest(req: IncomingMessage): string {
  const acceptLanguage = req.headers['accept-language'];

  if (acceptLanguage) {
    for (const locale of AVAILABLE_LOCALES) {
      if (acceptLanguage.includes(locale)) {
        return locale;
      }
    }
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  return DEFAULT_LOCALE;
}

function serveStaticFile(req: IncomingMessage, res: ServerResponse, locale: string): boolean {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/') && pathname.includes('.')) {
    const localeBrowserPath = join(__dirname, 'browser', locale, pathname);

    if (existsSync(localeBrowserPath)) {
      const stat = statSync(localeBrowserPath);
      if (stat.isFile()) {
        const ext = extname(pathname).toLowerCase();
        const contentType = getContentType(ext);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=31536000', // 1 year cache for static assets
        });

        const stream = createReadStream(localeBrowserPath);
        stream.pipe(res);
        return true;
      }
    }
  }

  return false;
}

function getContentType(ext: string): string {
  const types: { [key: string]: string } = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
  };

  return types[ext] || 'application/octet-stream';
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const locale = getLocaleFromRequest(req);
    const localeServer = localeServers.get(locale);

    if (!localeServer) {
      console.error(`No server found for locale: ${locale}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error: Locale server not found');
      return;
    }

    if (serveStaticFile(req, res, locale)) {
      return;
    }

    const originalCwd = process.cwd();
    const localeDir = join(__dirname, locale);

    try {
      process.chdir(localeDir);
      await localeServer(req, res);
    } finally {
      // Restore original working directory
      process.chdir(originalCwd);
    }
  } catch (error: any) {
    console.error('Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

const port = process.env['PORT'] || 4000;

loadLocaleServers()
  .then(() => {
    server.listen(port, () => {
      console.log(`Delegating server running on http://localhost:${port}`);
      console.log(`Available locales: ${AVAILABLE_LOCALES.join(', ')}`);
      console.log(`Default locale: ${DEFAULT_LOCALE}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  });

export default server;
