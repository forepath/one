jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleFilesFacade,
  ConsoleLiveFacade,
  LIVE_UPLOAD_CHUNK,
  LIVE_UPLOAD_WHOLE_MAX,
  LiveFilesService,
  type LiveFileEntry,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { facadeStub } from '../testing';
import { FILES_TEXT_PREVIEW_MAX, filePreviewKind, LoadweaverFilesPageComponent } from './files-page.component';

function entry(name: string, overrides: Partial<LiveFileEntry> = {}): LiveFileEntry {
  return { name, type: 'file', size: 12, modifiedAt: '2026-10-18T09:00:00.000Z', mode: 0o644, ...overrides };
}

const target = 'replica:shop/web/api/0';

describe('LoadweaverFilesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverFilesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let service: Record<string, jest.Mock>;
  let navigate: jest.SpyInstance;

  async function create(query: Record<string, string> = { target, path: '/etc' }) {
    facade = facadeStub(
      {
        target$: query['target'] ?? null,
        path$: query['path'] ?? '/',
        entries$: [entry('nginx', { type: 'directory', size: 0, mode: 0o755 }), entry('hosts'), entry('logo.png')],
        loading$: false,
        error$: null,
        busy$: false,
        operationError$: null,
        warning$: null,
      },
      ['open', 'refresh', 'run', 'setWarning', 'dismissMessages'],
    );
    service = {
      list: jest.fn().mockReturnValue(of([])),
      read: jest
        .fn()
        .mockReturnValue(of({ data: new Blob(['127.0.0.1 localhost']), size: 19, partial: false, fileType: 'text' })),
      download: jest.fn().mockReturnValue(of(new Blob(['x']))),
      write: jest.fn().mockReturnValue(of({ warning: 'lost on restart', complete: true })),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverFilesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleFilesFacade, useValue: facade },
        { provide: LiveFilesService, useValue: service },
        {
          provide: ConsoleLiveFacade,
          useValue: facadeStub(
            {
              replicas$: [
                {
                  id: 'shop/web/api/0',
                  project: 'shop',
                  deployment: 'web',
                  service: 'api',
                  index: 0,
                  node: 'n1',
                  state: 'running',
                },
              ],
              volumes$: [{ id: 'shop/web/data', project: 'shop', deployment: 'web', name: 'data' }],
              projects$: ['shop'],
              targetsError$: null,
            },
            ['loadTargets'],
          ),
        },
      ],
    }).compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverFilesPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () => fixture.componentInstance;

  it('opens a deep-linked target and lists it with breadcrumbs', async () => {
    await create();

    expect(facade['open']).toHaveBeenCalledWith(target, '/etc');
    expect(navigate.mock.calls[0][1].queryParams).toEqual({ target, path: '/etc', replica: null });
    expect(el().querySelector('[data-testid="files-table"]')?.textContent).toContain('hosts');
    expect(el().querySelector('[data-testid="files-crumbs"]')?.textContent).toContain('etc');

    const options = [...el().querySelectorAll('[data-testid="files-target"] option')].map(
      (o) => (o as HTMLOptionElement).value,
    );

    expect(options).toEqual(expect.arrayContaining(['replica:shop/web/api/0', 'volume:shop/web/data']));
  });

  it('accepts ?replica= from the map and asks for a target without one', async () => {
    await create({ replica: 'shop/web/api/0' });
    expect(facade['open']).toHaveBeenCalledWith(target, '/');

    TestBed.resetTestingModule();
    await create({});
    expect(facade['open']).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Choose a replica or a volume');
  });

  it('opens directories and previews text read-only', async () => {
    await create();

    component().activate(entry('nginx', { type: 'directory' }));
    expect(facade['open']).toHaveBeenLastCalledWith(target, '/etc/nginx');

    await component().showPreview(entry('hosts'));
    fixture.detectChanges();

    expect(service['read']).toHaveBeenCalledWith(target, '/etc/hosts', undefined);
    expect(component().preview()).toMatchObject({ kind: 'text', text: '127.0.0.1 localhost', loading: false });
    expect(el().querySelector('[data-testid="files-preview"] fpc-code-editor')).not.toBeNull();
  });

  it('reads only the beginning of large text files and skips binaries', async () => {
    await create();
    service['read'].mockReturnValue(of({ data: new Blob(['abc']), size: 5_000_000, partial: true, fileType: 'text' }));

    await component().showPreview(entry('app.log', { size: 5_000_000 }));
    expect(service['read']).toHaveBeenCalledWith(target, '/etc/app.log', { start: 0, end: FILES_TEXT_PREVIEW_MAX - 1 });
    expect(component().preview()).toMatchObject({ partial: true });

    await component().showPreview(entry('archive.tar.gz'));
    expect(component().preview()).toMatchObject({ kind: 'binary' });
    expect(service['read']).toHaveBeenCalledTimes(1);
  });

  it('previews raster images as data: URLs and never creates blob: URLs for them', async () => {
    await create();

    const createObjectURL = jest.fn(() => 'blob:x');

    Object.assign(window.URL, { createObjectURL, revokeObjectURL: jest.fn() });
    service['read'].mockReturnValue(
      of({ data: new Blob(['<svg onload="alert(1)"/>']), size: 24, partial: false, fileType: 'image' }),
    );

    await component().showPreview(entry('logo.png'));
    fixture.detectChanges();

    const preview = component().preview();

    expect(preview?.kind).toBe('image');
    expect(preview?.imageUrl?.startsWith('data:image/png;base64,')).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(el().querySelector<HTMLImageElement>('[data-testid="files-image"]')?.src).toMatch(/^data:image\/png/);
  });

  it('previews SVG as text, not as an image', async () => {
    await create();

    const createObjectURL = jest.fn(() => 'blob:x');

    Object.assign(window.URL, { createObjectURL, revokeObjectURL: jest.fn() });
    service['read'].mockReturnValue(
      of({ data: new Blob(['<svg><script>alert(1)</script></svg>']), size: 37, partial: false, fileType: 'image' }),
    );

    await component().showPreview(entry('evil.svg'));
    fixture.detectChanges();

    expect(component().preview()).toMatchObject({ kind: 'text', imageUrl: null });
    expect(component().preview()?.text).toContain('<script>');
    expect(el().querySelector('[data-testid="files-image"]')).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('classifies previews by extension', () => {
    expect(filePreviewKind('/a/b.PNG')).toBe('image');
    expect(filePreviewKind('/a/b.avif')).toBe('image');
    expect(filePreviewKind('/a/b.svg')).toBe('text');
    expect(filePreviewKind('/a/hosts')).toBe('text');
    expect(filePreviewKind('/a/b.tar.gz')).toBe('binary');
    expect(filePreviewKind('/a/b.pdf')).toBe('binary');
    expect(filePreviewKind('/a/png')).toBe('text');
  });

  it('uploads small files whole and large ones in chunks', async () => {
    await create();

    const small = new File(['hello'], 'a.txt');
    const size = LIVE_UPLOAD_WHOLE_MAX + 5;
    const large = { name: 'dump.sql', size, slice: jest.fn(() => new Blob(['x'])) } as unknown as File;

    await component().upload([small, large]);

    expect(service['write']).toHaveBeenNthCalledWith(1, target, '/etc/a.txt', small);
    expect(service['write']).toHaveBeenNthCalledWith(2, target, '/etc/dump.sql', expect.any(Blob), {
      contentRange: `bytes 0-${LIVE_UPLOAD_CHUNK - 1}/${size}`,
      uploadId: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    });
    expect(service['write']).toHaveBeenCalledTimes(3);
    expect(service['write'].mock.calls[2][3].contentRange).toBe(`bytes ${LIVE_UPLOAD_CHUNK}-${size - 1}/${size}`);
    expect(service['write'].mock.calls[1][3].uploadId).toBe(service['write'].mock.calls[2][3].uploadId);
    expect(
      component()
        .uploads()
        .map((u) => u.status),
    ).toEqual(['done', 'done']);
    expect(facade['setWarning']).toHaveBeenCalledWith('lost on restart');
    expect(facade['refresh']).toHaveBeenCalled();

    fixture.detectChanges();
    expect(el().querySelectorAll('[data-testid="files-uploads"] fpc-progress')).toHaveLength(2);
  });

  it('creates, moves, copies and deletes through the slice', async () => {
    await create();

    component().openCreate('directory');
    component().createName.set('dump');
    component().submitCreate();
    expect(facade['run']).toHaveBeenLastCalledWith(target, { kind: 'create', path: '/etc/dump', type: 'directory' });

    component().openMove(entry('hosts'), 'move');
    component().moveDestination.set('/tmp/hosts');
    component().submitMove();
    expect(facade['run']).toHaveBeenLastCalledWith(target, {
      kind: 'move',
      path: '/etc/hosts',
      destination: '/tmp/hosts',
      overwrite: false,
    });

    component().openMove(entry('hosts'), 'copy');
    expect(component().moveDestination()).toBe('/etc/hosts.copy');
    component().moveOverwrite.set(true);
    component().submitMove();
    expect(facade['run']).toHaveBeenLastCalledWith(target, {
      kind: 'copy',
      path: '/etc/hosts',
      destination: '/etc/hosts.copy',
      overwrite: true,
    });

    component().askDelete(entry('nginx', { type: 'directory' }));
    expect(component().deleteMessage()).toContain('/etc/nginx and everything in it');
    component().confirmDelete();
    expect(facade['run']).toHaveBeenLastCalledWith(target, { kind: 'delete', path: '/etc/nginx' });
  });

  it('shows the container filesystem warning and downloads with credentials', async () => {
    await create();
    facade['warning$'].next('Changes in a container filesystem are lost on restart or migration');
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="files-warning"]')?.textContent).toContain('lost on restart');

    const createObjectURL = jest.fn(() => 'blob:x');

    Object.assign(window.URL, { createObjectURL, revokeObjectURL: jest.fn() });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await component().download(entry('hosts'));

    expect(service['download']).toHaveBeenCalledWith(target, '/etc/hosts');
    expect(createObjectURL).toHaveBeenCalled();
    expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/octet-stream');
  });

  it('shows the server message of a failed download', async () => {
    await create();
    Object.assign(window.URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    service['download'].mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: new Blob([JSON.stringify({ message: 'No such file or directory' })]),
          }),
      ),
    );

    await component().download(entry('hosts'));

    expect(component().downloadError()).toBe('No such file or directory');
  });
});
