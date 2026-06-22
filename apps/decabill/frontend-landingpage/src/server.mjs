import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Available locales - these should match the locales configured in project.json
const AVAILABLE_LOCALES = ['en', 'de'];
const DEFAULT_LOCALE = 'en';

// Load locale-specific server implementations
const localeServers = new Map();

for (const locale of AVAILABLE_LOCALES) {
  try {
    const serverPath = join(__dirname, locale, 'server.mjs');
    const serverModule = await import(serverPath);
    localeServers.set(locale, serverModule.default);
  } catch (error) {
    console.warn(`Failed to load server for locale ${locale}:`, error.message);
  }
}

// Function to determine locale from request
function getLocaleFromRequest(req) {
  // Check Accept-Language header
  const acceptLanguage = req.headers['accept-language'];
  if (acceptLanguage) {
    for (const locale of AVAILABLE_LOCALES) {
      if (acceptLanguage.includes(locale)) {
        return locale;
      }
    }
  }

  // Check URL path for locale prefix
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && AVAILABLE_LOCALES.includes(pathSegments[0])) {
    return pathSegments[0];
  }

  // Default to configured default locale
  return DEFAULT_LOCALE;
}

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    const locale = getLocaleFromRequest(req);
    const localeServer = localeServers.get(locale);

    if (!localeServer) {
      console.error(`No server found for locale: ${locale}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error: Locale server not found');
      return;
    }

    // Handle the request with the appropriate locale server
    await localeServer(req, res);
  } catch (error) {
    console.error('Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

const port = process.env['PORT'] || 4000;

server.listen(port, () => {
  console.log(`Delegating server running on http://localhost:${port}`);
  console.log(`Available locales: ${AVAILABLE_LOCALES.join(', ')}`);
  console.log(`Default locale: ${DEFAULT_LOCALE}`);
});
