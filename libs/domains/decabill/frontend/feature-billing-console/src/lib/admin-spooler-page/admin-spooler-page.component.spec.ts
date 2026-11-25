import { TestBed } from '@angular/core/testing';
import { AdminSpoolerService, type SpoolJob } from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminSpoolerPageComponent } from './admin-spooler-page.component';

const job = (id: string, patch: Partial<SpoolJob> = {}): SpoolJob =>
  ({
    id,
    kind: 'print.inventory_labels',
    status: 'completed',
    outputTarget: 'download',
    title: `Labels ${id}`,
    documentType: null,
    documentId: null,
    attempts: 1,
    error: null,
    hasFile: true,
    fileName: `${id}.pdf`,
    fileSize: 4,
    externalLetterId: null,
    canRetry: false,
    canCancel: false,
    createdByUserId: null,
    createdAt: '2026-11-25T10:00:00Z',
    startedAt: null,
    finishedAt: '2026-11-25T10:00:05Z',
    ...patch,
  }) as SpoolJob;

describe('AdminSpoolerPageComponent', () => {
  let service: Record<string, jest.Mock>;
  let component: AdminSpoolerPageComponent;

  beforeEach(() => {
    service = {
      list: jest.fn(() => of({ items: [job('j1')], total: 1, limit: 25, offset: 0, counts: {} })),
      downloadFile: jest.fn(() => of(new Blob(['%PDF']))),
      retry: jest.fn(() => of(job('j2'))),
      cancel: jest.fn(() => throwError(() => ({ error: { message: 'Only queued spool jobs can be cancelled' } }))),
    };
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    TestBed.configureTestingModule({ providers: [{ provide: AdminSpoolerService, useValue: service }] });
    component = TestBed.runInInjectionContext(() => new AdminSpoolerPageComponent());
  });

  it('offers download, retry and cancel only where the job allows it', () => {
    const failed = job('j2', { status: 'failed', hasFile: false, canRetry: true, error: 'Chromium crashed' });
    const queued = job('j3', { status: 'queued', hasFile: false, canCancel: true });
    const enabled = (row: SpoolJob) =>
      component
        .rowMenu(row)
        .filter((item) => !item.disabled)
        .map((item) => item.id);

    expect(enabled(job('j1'))).toEqual(['download', 'copy-id']);
    expect(enabled(failed)).toEqual(['retry', 'copy-id']);
    expect(enabled(queued)).toEqual(['cancel', 'copy-id']);
    expect(component.rowInlineActions(failed)).toEqual([]);
    expect(component.columns[0].state?.(failed)?.label).toBe('Failed');
  });

  it('downloads files, retries and reports refused cancels', () => {
    component.onRowAction(job('j1'), 'download');
    expect(service['downloadFile']).toHaveBeenCalledWith('j1');

    component.onRowAction(job('j2', { status: 'failed', canRetry: true }), 'retry');
    expect(service['retry']).toHaveBeenCalledWith('j2');
    expect(component.notice()?.tone).toBe('success');

    component.onRowAction(job('j3', { status: 'queued', canCancel: true }), 'cancel');
    expect(component.notice()).toEqual({ tone: 'danger', message: 'Only queued spool jobs can be cancelled' });

    // Not allowed by the row state: nothing is requested.
    component.onRowAction(job('j4', { canRetry: false }), 'retry');
    expect(service['retry']).toHaveBeenCalledTimes(1);
  });
});
