import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';

import { BackupsService } from './backups.service';

const API = 'https://cp.example.com/api';

describe('BackupsService', () => {
  let service: BackupsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    service = TestBed.inject(BackupsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads status and the catalog with filters', () => {
    service.status().subscribe();
    service.catalog().subscribe();
    service.catalog({ project: 'shop', resource: 'shop/web/data', includeDeleted: true, limit: 50 }).subscribe();
    service.get('b 1').subscribe();

    http.expectOne(`${API}/backups/status`).flush({});
    http.expectOne(`${API}/backups`).flush([]);
    http.expectOne(`${API}/backups?project=shop&resource=shop/web/data&includeDeleted=true&limit=50`).flush([]);
    http.expectOne(`${API}/backups/b%201`).flush({});
  });

  it('browses, downloads and compares backups', () => {
    service.files('b1').subscribe();
    service.files('b1', 'uploads/2026').subscribe();
    service.download('b1', 'uploads/a b.txt').subscribe();
    service.diff('b1', 'b2').subscribe();

    http.expectOne(`${API}/backups/b1/files`).flush([]);
    http.expectOne(`${API}/backups/b1/files?path=uploads/2026`).flush([]);

    const download = http.expectOne((r) => r.url === `${API}/backups/b1/download`);

    expect(download.request.params.get('path')).toBe('uploads/a b.txt');
    expect(download.request.responseType).toBe('blob');
    download.flush(new Blob(['x']));
    http.expectOne(`${API}/backups/diff?from=b1&to=b2`).flush({ added: [], removed: [], changed: [], stats: null });
  });

  it('starts backups and restore tests and reads restores', () => {
    service.backupNow('shop/web/data').subscribe();
    service.restoreTest('b1').subscribe();
    service.restoreTests({ project: 'shop' }).subscribe();
    service.restores().subscribe();
    service.restores('shop').subscribe();

    const now = http.expectOne(`${API}/backups/now`);

    expect(now.request.method).toBe('POST');
    expect(now.request.body).toEqual({ volume: 'shop/web/data' });
    now.flush({});
    expect(http.expectOne(`${API}/backups/b1/restore-test`).request.method).toBe('POST');
    http.expectOne(`${API}/backups/restore-tests?project=shop`).flush([]);
    http.expectOne(`${API}/backups/restores`).flush([]);
    http.expectOne(`${API}/backups/restores?project=shop`).flush([]);
  });

  it('requests, approves and cancels deletions', () => {
    service.deletions().subscribe();
    service.requestDeletion(['b1'], 'GDPR request').subscribe();
    service.actOnDeletion('d1', 'approve').subscribe();
    service.actOnDeletion('d1', 'cancel').subscribe();

    http.expectOne((r) => r.method === 'GET' && r.url === `${API}/backups/deletions`).flush([]);

    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${API}/backups/deletions`);

    expect(request.request.body).toEqual({ backupIds: ['b1'], reason: 'GDPR request' });
    request.flush({});
    expect(http.expectOne(`${API}/backups/deletions/d1/approve`).request.method).toBe('POST');
    expect(http.expectOne(`${API}/backups/deletions/d1/cancel`).request.method).toBe('POST');
  });

  it('manages the backup key and its recovery kit', () => {
    service.keys().subscribe();
    service.rotateKey().subscribe();
    service.rotateKey({ shares: 5, threshold: 3 }).subscribe();
    service.reissueKit(2, { shares: 3, threshold: 2 }).subscribe();
    service.downloadShare(2, 1).subscribe();
    service.confirmKit(2, ['a', 'b']).subscribe();
    service.escrow(2).subscribe();

    http.expectOne(`${API}/backups/keys`).flush([]);

    const [plain, sized] = http.match(`${API}/backups/keys/rotate`);

    expect(plain.request.body).toEqual({});
    expect(sized.request.body).toEqual({ shares: 5, threshold: 3 });
    plain.flush({});
    sized.flush({});
    expect(http.expectOne(`${API}/backups/keys/2/kit`).request.body).toEqual({ shares: 3, threshold: 2 });
    expect(http.expectOne(`${API}/backups/keys/2/kit/shares/1`).request.method).toBe('POST');
    expect(http.expectOne(`${API}/backups/keys/2/kit/confirm`).request.body).toEqual({ shares: ['a', 'b'] });
    expect(http.expectOne(`${API}/backups/keys/2/escrow`).request.method).toBe('POST');
  });

  it('reads platform backups and backs up a kind now', () => {
    service.platformStatus().subscribe();
    service.runPlatformBackup('etcd').subscribe();
    service.runPlatformCopies().subscribe();

    http.expectOne(`${API}/backups/platform`).flush({});

    const run = http.expectOne(`${API}/backups/platform/etcd/run`);

    expect(run.request.method).toBe('POST');
    run.flush({ kind: 'etcd', status: 'succeeded', backup: 's1', bytes: 1, error: null, deleted: [] });

    const copies = http.expectOne(`${API}/backups/platform/copies/run`);

    expect(copies.request.method).toBe('POST');
    copies.flush([]);
  });

  it('requests, lists and discards point-in-time restores', () => {
    service.platformRestores().subscribe();
    service.requestPlatformRestore().subscribe();
    service.requestPlatformRestore({ targetTime: '2026-10-19T10:00:00+02:00', node: 'n2' }).subscribe();
    service.discardPlatformRestore('r 1').subscribe();

    http.expectOne((r) => r.method === 'GET' && r.url === `${API}/backups/platform/postgres/restores`).flush([]);

    const requests = http.match(`${API}/backups/platform/postgres/restores`);

    expect(requests.map((r) => r.request.method)).toEqual(['POST', 'POST']);
    expect(requests[0].request.body).toEqual({});
    expect(requests[1].request.body).toEqual({ targetTime: '2026-10-19T10:00:00+02:00', node: 'n2' });
    requests.forEach((r) => r.flush({}));

    const discard = http.expectOne(`${API}/backups/platform/postgres/restores/r%201`);

    expect(discard.request.method).toBe('DELETE');
    discard.flush({});
  });

  it('plans, lists, approves and cancels cut-overs', () => {
    service.planPlatformCutover('r1').subscribe();
    service.platformCutovers().subscribe();
    service.actOnPlatformCutover('c1', 'approve').subscribe();
    service.actOnPlatformCutover('c1', 'cancel').subscribe();

    expect(http.expectOne(`${API}/backups/platform/postgres/restores/r1/cutover`).request.method).toBe('POST');
    expect(http.expectOne(`${API}/backups/platform/cutovers`).request.method).toBe('GET');
    expect(http.expectOne(`${API}/backups/platform/cutovers/c1/approve`).request.method).toBe('POST');
    expect(http.expectOne(`${API}/backups/platform/cutovers/c1/cancel`).request.method).toBe('POST');
  });

  it('reads the DR info, downloads etcd snapshots and restores OpenSearch indices', () => {
    service.drInfo().subscribe();
    service.downloadEtcdSnapshot('etcd-2026.db').subscribe();
    service.restoreOpensearch({ snapshot: 's1', indices: ['logs-*'], renamePrefix: 'restored-' }).subscribe();

    expect(http.expectOne(`${API}/backups/platform/dr-info`).request.method).toBe('GET');

    const etcd = http.expectOne(`${API}/backups/platform/etcd/etcd-2026.db`);

    expect(etcd.request.responseType).toBe('blob');
    etcd.flush(new Blob(['x']));
    expect(http.expectOne(`${API}/backups/platform/opensearch/restore`).request.body).toEqual({
      snapshot: 's1',
      indices: ['logs-*'],
      renamePrefix: 'restored-',
    });
  });
});
