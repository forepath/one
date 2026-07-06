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
  const mainModule = typeof require !== 'undefined' ? require.main : null;

  if (mainModule?.filename) {
    return resolve(dirname(mainModule.filename), 'browser');
  }

  if (process.argv[1]) {
    return resolve(dirname(process.argv[1]), 'browser');
  }

  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return resolve(dirname(fileURLToPath(import.meta.url)), 'browser');
  }

  throw new Error('Unable to determine base dist path.');
}

const baseDistPath = getBaseDistPath();
const DEFAULT_LOCALE = process.env['DEFAULT_LOCALE'] || 'en';

function getAvailableLocales(): string[] {
  if (!existsSync(baseDistPath)) {
    return [DEFAULT_LOCALE];
  }

  const locales = readdirSync(baseDistPath).filter((entry) => statSync(join(baseDistPath, entry)).isDirectory());

  return locales.length > 0 ? locales : [DEFAULT_LOCALE];
}

const AVAILABLE_LOCALES = getAvailableLocales();

function getLocaleFromRequest(req: express.Request): string {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  const acceptLanguage = req.headers['accept-language'];

  if (acceptLanguage) {
    for (const locale of AVAILABLE_LOCALES) {
      if (acceptLanguage.includes(locale)) {
        return locale;
      }
    }
  }

  return DEFAULT_LOCALE;
}

function getLocaleFromPath(req: express.Request): string | undefined {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  return undefined;
}

function getLocalePath(locale: string): string {
  const localePath = join(baseDistPath, locale);

  if (existsSync(localePath)) {
    return localePath;
  }

  console.warn(`Locale directory not found: ${localePath}, falling back to ${DEFAULT_LOCALE}`);

  return join(baseDistPath, DEFAULT_LOCALE);
}

app.use((req, res, next) => {
  const monacoCssPattern = /\/assets\/monaco\/esm\/vs\/.*\.css$/;

  if (monacoCssPattern.test(req.path)) {
    const fetchDest = req.headers['sec-fetch-dest'];
    const acceptHeader = String(req.headers['accept'] ?? '').toLowerCase();
    const expectsScript =
      fetchDest === 'script' ||
      fetchDest === 'worker' ||
      acceptHeader.includes('javascript') ||
      acceptHeader.includes('ecmascript') ||
      acceptHeader.includes('text/javascript') ||
      acceptHeader.includes('application/javascript');

    if (!expectsScript) {
      return next();
    }

    let locale = DEFAULT_LOCALE;
    const pathSegments = req.path.split('/').filter(Boolean);

    if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
      locale = pathSegments[0];
      const pathWithoutLocale = '/' + pathSegments.slice(1).join('/');
      const localePath = getLocalePath(locale);
      const cssFilePath = join(localePath, pathWithoutLocale);

      if (existsSync(cssFilePath)) {
        res.type('application/javascript');

        const safeHref = JSON.stringify(pathWithoutLocale);

        return res.send(
          `
// Dynamically load CSS file as stylesheet
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = ${safeHref};
document.head.appendChild(link);
        `.trim(),
        );
      }

      return next();
    }

    const localePath = getLocalePath(DEFAULT_LOCALE);
    const cssFilePath = join(localePath, req.path);

    if (existsSync(cssFilePath)) {
      res.type('application/javascript');

      const safeHref = JSON.stringify(req.path);

      return res.send(
        `
// Dynamically load CSS file as stylesheet
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = ${safeHref};
document.head.appendChild(link);
      `.trim(),
      );
    }

    return next();
  }

  return next();
});

for (const locale of AVAILABLE_LOCALES) {
  app.use(`/${locale}`, express.static(getLocalePath(locale), { index: false }));
}

const defaultLocalePath = getLocalePath(DEFAULT_LOCALE);

app.use(express.static(defaultLocalePath, { index: false }));

app.use((req, res, next) => {
  const monacoPattern = /\/assets\/monaco\/esm\/vs\/.*\/[^/]+$/;

  if (monacoPattern.test(req.path) && !req.path.endsWith('.js') && !req.path.endsWith('.css')) {
    let locale = DEFAULT_LOCALE;
    const pathSegments = req.path.split('/').filter(Boolean);

    if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
      locale = pathSegments[0];
      const pathWithoutLocale = '/' + pathSegments.slice(1).join('/');
      const localePath = getLocalePath(locale);
      const filePath = join(localePath, pathWithoutLocale + '.js');

      if (existsSync(filePath)) {
        return res.sendFile(resolve(filePath));
      }
    } else {
      const localePath = getLocalePath(DEFAULT_LOCALE);
      const filePath = join(localePath, req.path + '.js');

      if (existsSync(filePath)) {
        return res.sendFile(resolve(filePath));
      }
    }
  }

  return next();
});

app.get('*', (req, res) => {
  const locale = getLocaleFromRequest(req);
  const indexPath = join(getLocalePath(locale), 'index.html');

  if (!existsSync(indexPath)) {
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
  console.log(`Marpdown editor server running on http://localhost:${port}`);
  console.log(`Serving files from: ${baseDistPath}`);
  console.log(`Available locales: ${AVAILABLE_LOCALES.join(', ')}`);
});
