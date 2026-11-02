import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { LiveFilesService } from './live-files.service';
import { LiveService } from './live.service';
import { TopologyService } from './topology.service';

describe('LiveFilesService / LiveService', () => {
  let http: HttpTestingController;
  let files: LiveFilesService;
  const target = 'replica:shop/web/api/0' as const;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    files = TestBed.inject(LiveFilesService);
  });

  afterEach(() => http.verify());

  it('lists a directory of a target', async () => {
    const result = firstValueFrom(files.list(target, '/etc'));
    const req = http.expectOne((r) => r.url === 'https://cp.example.com/api/live/files');

    expect(req.request.params.get('target')).toBe(target);
    expect(req.request.params.get('path')).toBe('/etc');
    req.flush([]);
    expect(await result).toEqual([]);
  });

  it('reads a range and reports the full size', async () => {
    const result = firstValueFrom(files.read(target, '/var/log/app.log', { start: 0, end: 3 }));
    const req = http.expectOne((r) => r.url.endsWith('/live/files/content'));

    expect(req.request.headers.get('Range')).toBe('bytes=0-3');
    req.flush(new Blob(['abcd']), {
      status: 206,
      statusText: 'Partial Content',
      headers: { 'Content-Range': 'bytes 0-3/4096', 'X-File-Type': 'text' },
    });

    expect(await result).toMatchObject({ size: 4096, partial: true, fileType: 'text' });
  });

  it('writes chunks with Content-Range and the upload id and returns the warning', async () => {
    const result = firstValueFrom(
      files.write(target, '/tmp/dump.sql', new Blob(['abcd']), { contentRange: 'bytes 0-3/10', uploadId: 'u1' }),
    );
    const req = http.expectOne((r) => r.method === 'PUT');

    expect(req.request.headers.get('Content-Range')).toBe('bytes 0-3/10');
    expect(req.request.headers.get('X-Upload-Id')).toBe('u1');
    expect(req.request.headers.get('Content-Type')).toBe('application/octet-stream');
    req.flush('', {
      status: 202,
      statusText: 'Accepted',
      headers: { 'X-Loadweaver-Warning': 'Changes in a container filesystem are lost on restart or migration' },
    });

    expect(await result).toEqual({
      complete: false,
      warning: 'Changes in a container filesystem are lost on restart or migration',
    });
  });

  it('creates, moves, copies and deletes', async () => {
    const created = firstValueFrom(files.create(target, '/tmp/x', 'directory'));

    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/live/files'))
      .flush('', { status: 201, statusText: 'Created' });
    expect(await created).toBeNull();

    const moved = firstValueFrom(files.move(target, '/tmp/x', '/tmp/y', true));
    const move = http.expectOne((r) => r.method === 'PATCH');

    expect(move.request.body).toEqual({ destination: '/tmp/y', overwrite: true });
    move.flush('', { status: 204, statusText: 'No Content', headers: { 'X-Loadweaver-Warning': 'lost' } });
    expect(await moved).toBe('lost');

    const copied = firstValueFrom(files.copy(target, '/tmp/y', '/tmp/z'));

    http.expectOne((r) => r.url.endsWith('/live/files/copy')).flush('', { status: 204, statusText: 'No Content' });
    await copied;

    const removed = firstValueFrom(files.remove(target, '/tmp/z'));

    http.expectOne((r) => r.method === 'DELETE').flush('', { status: 204, statusText: 'No Content' });
    expect(await removed).toBeNull();
  });

  it('lists sessions of a project, recordings and tunnels', async () => {
    const live = TestBed.inject(LiveService);

    TestBed.inject(TopologyService);

    const sessions = firstValueFrom(live.sessions('shop'));

    http.expectOne('https://cp.example.com/api/live/sessions?project=shop').flush([]);
    await sessions;

    const cast = firstValueFrom(live.recording('abc'));

    http.expectOne('https://cp.example.com/api/live/sessions/abc/recording').flush('{"version":2}');
    expect(await cast).toBe('{"version":2}');

    const tunnels = firstValueFrom(live.tunnels());

    http.expectOne('https://cp.example.com/api/live/tunnels').flush([]);
    await tunnels;
  });
});
