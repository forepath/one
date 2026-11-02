/**
 * CORS headers of the API (the console runs on its own origin). Every request header the console sets must be listed,
 * or the browser drops the request after the preflight (Angular then reports "0 Unknown Error").
 */
export const CORS_ALLOWED_HEADERS: readonly string[] = [
  'Content-Type',
  'Authorization',
  'X-Correlation-Id',
  'X-Request-Id',
  'Range',
  'Content-Range',
  'X-Upload-Id',
  // Declared SHA-256 of a release bundle upload (fleet claim binding, 2026-10-27).
  'X-Loadweaver-Content-SHA256',
  // Optimistic concurrency of shared drafts (`PATCH /drafts/:id`, 3.36); the fleet relay forwards it.
  'If-Match',
];

export const CORS_EXPOSED_HEADERS: readonly string[] = [
  'Content-Length',
  'Content-Disposition',
  'X-Correlation-Id',
  'Content-Range',
  'Accept-Ranges',
  'X-File-Type',
  'X-Loadweaver-Warning',
  'X-Loadweaver-Version',
];
