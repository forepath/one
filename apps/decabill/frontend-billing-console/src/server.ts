import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  createSecurityHeadersMiddleware,
  registerRuntimeConfigEndpoint,
} from '@forepath/shared/frontend/util-express-server';
import express from 'express';

const app = express();
const port = parseInt(process.env['PORT'] || '4200', 10);

app.use(createSecurityHeadersMiddleware());
registerRuntimeConfigEndpoint(app);

function getBaseDistPath(): string {
  // Method 1: Use require.main.filename (CommonJS - most reliable)
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const mainModule = typeof require !== 'undefined' ? require.main : null;

  if (mainModule?.filename) {
    return resolve(dirname(mainModule.filename), 'browser');
  }

  // Method 2: Use process.argv[1] (path to the script being executed)
  if (process.argv[1]) {
    try {
      return resolve(dirname(process.argv[1]), 'browser');
    } catch (error) {
      console.warn('Failed to resolve path from process.argv[1]:', error);
    }
  }

  // Method 3: Use import.meta.url (ES modules)
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - import.meta is available in ES modules but not in CommonJS
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - import.meta.url is available in ES modules
      const filePath = fileURLToPath(import.meta.url);

      return resolve(dirname(filePath), 'browser');
    }
  } catch {
    // import.meta not available (CommonJS)
  }

  // If all else fails, throw an error with helpful message
  throw new Error(
    'Unable to determine base dist path. ' +
      'The server script location could not be determined. ' +
      'Please ensure the server is run from the correct directory or set SERVER_BASE_PATH environment variable.',
  );
}

const baseDistPath = getBaseDistPath();
// Default locale - read from environment variable, fallback to 'en'
const DEFAULT_LOCALE = process.env['DEFAULT_LOCALE'] || 'en';

/**
 * Dynamically reads available locales from the build output directory
 * Returns an array of locale codes found in the browser directory
 */
function getAvailableLocales(): string[] {
  if (!existsSync(baseDistPath)) {
    console.warn(`Build directory not found: ${baseDistPath}`);

    return [DEFAULT_LOCALE];
  }

  try {
    const entries = readdirSync(baseDistPath);
    const locales = entries.filter((entry) => {
      const entryPath = join(baseDistPath, entry);

      // Only include directories (not files) as potential locales
      return statSync(entryPath).isDirectory();
    });

    if (locales.length === 0) {
      console.warn(`No locale directories found in ${baseDistPath}, using default locale`);

      return [DEFAULT_LOCALE];
    }

    console.log(`Found ${locales.length} locale(s): ${locales.join(', ')}`);

    return locales;
  } catch (error) {
    console.error(`Error reading locales from ${baseDistPath}:`, error);

    return [DEFAULT_LOCALE];
  }
}

// Available locales - dynamically read from build output
const AVAILABLE_LOCALES = getAvailableLocales();

/**
 * Determines the locale from the request
 * Checks URL path first (e.g., /en/..., /de/...), then Accept-Language header, then defaults to DEFAULT_LOCALE
 */
function getLocaleFromRequest(req: express.Request): string {
  // Check URL path for locale prefix (e.g., /en/..., /de/...)
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  // Check Accept-Language header
  const acceptLanguage = req.headers['accept-language'];

  if (acceptLanguage) {
    for (const locale of AVAILABLE_LOCALES) {
      if (acceptLanguage.includes(locale)) {
        return locale;
      }
    }
  }

  // Default to configured default locale
  return DEFAULT_LOCALE;
}

function getLocaleFromPath(req: express.Request): string | undefined {
  // Check URL path for locale prefix (e.g., /en/..., /de/...)
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  // Default to undefined
  return undefined;
}

/**
 * Gets the locale path, falling back to default if locale doesn't exist
 */
function getLocalePath(locale: string): string {
  const localePath = join(baseDistPath, locale);

  if (existsSync(localePath)) {
    return localePath;
  }

  console.warn(`Locale directory not found: ${localePath}, falling back to ${DEFAULT_LOCALE}`);

  return join(baseDistPath, DEFAULT_LOCALE);
}

// Middleware to handle Monaco Editor CSS imports as JavaScript modules
// Monaco Editor imports CSS files as modules (e.g., import './editor.css')
// Browsers don't support CSS imports, so we return a JS module that loads the CSS as a stylesheet
// This MUST be before static file serving to intercept CSS requests
app.use((req, res, next) => {
  // Check if this is a Monaco Editor CSS file request
  const monacoCssPattern = /\/assets\/monaco\/esm\/vs\/.*\.css$/;

  if (monacoCssPattern.test(req.path)) {
    // Determine locale from path
    let locale = DEFAULT_LOCALE;
    const pathSegments = req.path.split('/').filter(Boolean);

    if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
      locale = pathSegments[0];
      // Remove locale prefix from path for file lookup
      const pathWithoutLocale = '/' + pathSegments.slice(1).join('/');
      const localePath = getLocalePath(locale);
      const cssFilePath = join(localePath, pathWithoutLocale);

      if (existsSync(cssFilePath)) {
        // Return a JavaScript module that dynamically loads the CSS as a stylesheet
        res.type('application/javascript');

        return res.send(
          `
// Dynamically load CSS file as stylesheet
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '${pathWithoutLocale}';
document.head.appendChild(link);
        `.trim(),
        );
      }

      return next();
    } else {
      // Root path (no locale prefix)
      const localePath = getLocalePath(DEFAULT_LOCALE);
      const cssFilePath = join(localePath, req.path);

      if (existsSync(cssFilePath)) {
        // Return a JavaScript module that dynamically loads the CSS as a stylesheet
        res.type('application/javascript');

        return res.send(
          `
// Dynamically load CSS file as stylesheet
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '${req.path}';
document.head.appendChild(link);
        `.trim(),
        );
      }

      return next();
    }
  }

  return next();
});

// Serve static files for each locale
// Express static middleware will only serve files that exist, and call next() for others
// This is after the CSS middleware so CSS files are intercepted first
for (const locale of AVAILABLE_LOCALES) {
  const localePath = getLocalePath(locale);

  app.use(`/${locale}`, express.static(localePath, { index: false }));
}

// Also serve from root for default locale (backward compatibility and direct access)
const defaultLocalePath = getLocalePath(DEFAULT_LOCALE);

app.use(express.static(defaultLocalePath, { index: false }));

// Middleware to handle extensionless Monaco Editor JavaScript imports
// Monaco Editor uses relative imports without .js extensions, but browsers require them
// This must be after static file serving but before the Angular router catch-all
app.use((req, res, next) => {
  // Check if this is a Monaco Editor file request without extension
  // Match both locale-prefixed paths (/en/assets/monaco/...) and root paths (/assets/monaco/...)
  const monacoPattern = /\/assets\/monaco\/esm\/vs\/.*\/[^/]+$/;

  if (monacoPattern.test(req.path) && !req.path.endsWith('.js') && !req.path.endsWith('.css')) {
    // Determine locale from path or request
    let locale = DEFAULT_LOCALE;
    const pathSegments = req.path.split('/').filter(Boolean);

    if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
      locale = pathSegments[0];
      // Remove locale prefix from path for file lookup
      const pathWithoutLocale = '/' + pathSegments.slice(1).join('/');
      const localePath = getLocalePath(locale);
      const filePath = join(localePath, pathWithoutLocale + '.js');

      if (existsSync(filePath)) {
        return res.sendFile(resolve(filePath));
      }
    } else {
      // Root path (no locale prefix)
      const localePath = getLocalePath(DEFAULT_LOCALE);
      const filePath = join(localePath, req.path + '.js');

      if (existsSync(filePath)) {
        return res.sendFile(resolve(filePath));
      }
    }
  }

  next();
});

// Handle Angular SPA routing - serve index.html for all routes
// This must be after static file serving and Monaco extension middleware
app.get('*', (req, res) => {
  const locale = getLocaleFromRequest(req);
  const localePath = getLocalePath(locale);
  const indexPath = join(localePath, 'index.html');

  if (!existsSync(indexPath)) {
    console.error(`Index file not found: ${indexPath}`);
    res.status(404).send('Locale build not found. Please build the application first.');

    return;
  }

  if (!getLocaleFromPath(req)) {
    res.redirect(302, `/${locale}${req.url}`);

    return;
  }

  res.sendFile(resolve(indexPath));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Express server running on http://localhost:${port}`);
  console.log(`📦 Serving files from: ${baseDistPath}`);
  console.log(`🌐 Available locales: ${AVAILABLE_LOCALES.join(', ')}`);
  console.log(`🌍 Default locale: ${DEFAULT_LOCALE}`);
});
