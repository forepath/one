import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  downloadAdminFileManagerArchive,
  downloadAdminFileManagerArchiveFailure,
  downloadAdminFileManagerArchiveSuccess,
  downloadAdminFileManagerFile,
  downloadAdminFileManagerFileFailure,
  downloadAdminFileManagerFileSuccess,
  listAdminFileManagerDirectory,
  listAdminFileManagerDirectoryFailure,
  listAdminFileManagerDirectorySuccess,
} from './admin-file-manager.actions';
import { buildAdminFileManagerCacheKey } from './admin-file-manager.reducer';

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const listAdminFileManagerDirectory$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(listAdminFileManagerDirectory),
      switchMap(({ params }) => {
        const path = params.path ?? '';
        const view = params.view ?? 'tenant';
        const viewTenantId = view === 'unified' ? null : (params.viewTenantId ?? null);

        return service.listAdminFiles(params).pipe(
          map((response) =>
            listAdminFileManagerDirectorySuccess({
              cacheKey: buildAdminFileManagerCacheKey(view, viewTenantId, path),
              path,
              view: response.view,
              viewTenantId: response.viewTenantId ?? viewTenantId,
              entries: response.entries,
            }),
          ),
          catchError((error: Error) =>
            of(listAdminFileManagerDirectoryFailure({ error: error.message ?? 'Failed to list files' })),
          ),
        );
      }),
    ),
  { functional: true },
);

export const downloadAdminFileManagerFile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(downloadAdminFileManagerFile),
      switchMap(({ params, fileName }) =>
        service.downloadAdminFile(params).pipe(
          tap((blob) => {
            const name = fileName || params.path?.split('/').pop() || 'download';

            triggerBrowserDownload(blob, name);
          }),
          map(() => downloadAdminFileManagerFileSuccess()),
          catchError((error: Error) =>
            of(downloadAdminFileManagerFileFailure({ error: error.message ?? 'Failed to download file' })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const downloadAdminFileManagerArchive$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(downloadAdminFileManagerArchive),
      switchMap(({ params, fileName }) =>
        service.downloadAdminFileArchive(params).pipe(
          tap((blob) => {
            const folder = params.path?.split('/').filter(Boolean).pop() || 'files';

            triggerBrowserDownload(blob, fileName || `${folder}.zip`);
          }),
          map(() => downloadAdminFileManagerArchiveSuccess()),
          catchError((error: Error) =>
            of(downloadAdminFileManagerArchiveFailure({ error: error.message ?? 'Failed to download archive' })),
          ),
        ),
      ),
    ),
  { functional: true },
);
