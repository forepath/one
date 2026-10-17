import { HttpErrorResponse } from '@angular/common/http';

/**
 * A readable message from a control-plane error: Nest's `message` (string or validation list) plus what the API
 * attaches (apply `blockers`, conflicting `locks`, plan `issues`).
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    let body = error.error as Record<string, unknown> | string | null;

    // `responseType: 'text'` requests (exports) get the JSON error body as a string.
    if (typeof body === 'string' && body.trim().startsWith('{')) {
      try {
        body = JSON.parse(body) as Record<string, unknown>;
      } catch {
        // Not JSON after all: shown as it is.
      }
    }

    if (body && typeof body === 'object') {
      const message = Array.isArray(body['message'])
        ? (body['message'] as unknown[]).join('; ')
        : typeof body['message'] === 'string'
          ? body['message']
          : null;
      const details = [body['blockers'], body['locks'], body['issues']]
        .filter(Array.isArray)
        .flatMap((list) =>
          (list as unknown[]).map((item) =>
            typeof item === 'string'
              ? item
              : typeof (item as { message?: unknown })?.message === 'string'
                ? `${(item as { path?: string }).path ? `${(item as { path?: string }).path}: ` : ''}${(item as { message: string }).message}`
                : JSON.stringify(item),
          ),
        );

      if (message) return details.length > 0 ? `${message}: ${details.join('; ')}` : message;
    }

    if (typeof body === 'string' && body.trim()) return body;

    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;

  return fallback;
}

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * {@link apiErrorMessage} for requests with `responseType: 'blob'`: Angular hands the error body over as a Blob, so it
 * is read as text (and parsed as JSON where it is) first to get to the server's message.
 */
export async function apiErrorMessageAsync(error: unknown, fallback: string): Promise<string> {
  if (error instanceof HttpErrorResponse && typeof Blob !== 'undefined' && error.error instanceof Blob) {
    let body: unknown = null;

    try {
      const text = await blobText(error.error);

      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } catch {
      body = null;
    }

    return apiErrorMessage(
      new HttpErrorResponse({
        error: body,
        status: error.status,
        statusText: error.statusText,
        url: error.url ?? undefined,
        headers: error.headers,
      }),
      fallback,
    );
  }

  return apiErrorMessage(error, fallback);
}
