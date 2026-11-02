import { HttpErrorResponse } from '@angular/common/http';

/** True for the "no access" answers (401 / 403): admin reference selects then fall back to a plain text input. */
export function isAccessDeniedError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
}
