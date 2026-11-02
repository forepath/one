import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ConsoleAccessFacade,
  ConsoleReportsFacade,
  ReportsService,
  type AccessMe,
  type Report,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, Subject, throwError } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { lastFinishedMonth, monthValue, readBlobText } from './report-format';
import { LoadweaverReportsPageComponent } from './reports-page.component';

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    scope: 'cluster',
    year: 2026,
    month: 9,
    status: 'completed',
    files: [
      { name: 'report.html', path: 'cluster/2026/09/report.html', bytes: 2048, sha256: 'a' },
      { name: 'report.json', path: 'cluster/2026/09/report.json', bytes: 512, sha256: 'b' },
    ],
    error: null,
    completedAt: '2026-10-01T03:01:00.000Z',
    ...overrides,
  };
}

describe('LoadweaverReportsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverReportsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let service: { download: jest.Mock; archive: jest.Mock };

  async function setup(me: AccessMe) {
    facade = facadeStub(
      {
        reports$: [
          report(),
          report({ id: 'r2', scope: 'shop', status: 'failed', files: [], error: 'object store down' }),
        ],
        loading$: false,
        error$: null,
        running$: false,
        queued$: null,
        runError$: null,
        path$: 'cluster/2026',
        entries$: [
          { name: '09', path: 'cluster/2026/09', type: 'folder' },
          { name: 'report.html', path: 'cluster/2026/report.html', type: 'file', bytes: 2048 },
          { name: 'report.json', path: 'cluster/2026/report.json', type: 'file', bytes: 512 },
        ],
        entriesLoading$: false,
        entriesError$: null,
      },
      ['load', 'run', 'openFolder', 'clearRunResult'],
    );
    service = {
      download: jest.fn().mockReturnValue(of(new Blob(['<h1>September</h1>'], { type: 'application/octet-stream' }))),
      archive: jest.fn().mockReturnValue(of(new Blob(['PK']))),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverReportsPageComponent],
      providers: [
        { provide: ConsoleReportsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        { provide: ReportsService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverReportsPageComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    Object.assign(window.URL, { createObjectURL: jest.fn().mockReturnValue('blob:x'), revokeObjectURL: jest.fn() });
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads runs and the root folder; cluster admins run any scope for the last finished month', async () => {
    await setup({ userId: 'a', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    expect(facade['load']).toHaveBeenCalledWith();
    expect(facade['openFolder']).toHaveBeenCalledWith('');
    expect(component.scopes()).toEqual(['cluster', 'shop']);
    expect(component.scope()).toBe('cluster');
    expect(component.month()).toBe(monthValue(lastFinishedMonth().year, lastFinishedMonth().month));
    expect(el().querySelector('[data-testid="reports-list"]')?.textContent).toContain('object store down');

    // The run form lives in the "Run report" dialog of the header.
    expect(el().querySelector('[data-testid="report-run-form"]')).toBeNull();
    (el().querySelector('[data-testid="report-run-open"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="report-run-form"] #lw-report-scope')).not.toBeNull();

    component.scope.set('shop');
    component.month.set('2026-08');
    component.run();
    expect(facade['run']).toHaveBeenCalledWith({ scope: 'shop', year: 2026, month: 8 });
    facade['queued$'].next({ id: 'r1' });
    fixture.detectChanges();
    expect(component.runOpen()).toBe(false);

    facade['run'].mockClear();
    component.month.set('2999-01');
    expect(component.monthValid()).toBe(false);
    component.run();
    expect(facade['run']).not.toHaveBeenCalled();
  });

  it('renders runs as a table: actions in ⋮, search narrows, no-matches state', async () => {
    await setup({ userId: 'a', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    expect(el().querySelector('fpc-list-header')).toBeNull();
    expect(component.runMenu(component.reports()[0]).map((i) => i.id)).toContain('copy-id');

    component.search.set('SHOP');
    fixture.detectChanges();
    expect(component.filteredReports().length).toBe(1);

    component.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('shows Runs | Files as tabs, each table with its own search; folder crumbs head the files table', async () => {
    await setup({ userId: 'a', clusterRole: 'cluster-admin', projects: {} });

    expect(el().querySelector('[data-testid="reports-list"] input')?.getAttribute('placeholder')).toBe(
      'Search report runs',
    );
    expect(el().querySelector('[data-testid="report-entries"]')).toBeNull();
    fixture.componentInstance.lane.set('files');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="report-entries"] [data-testid="report-breadcrumbs"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="report-entries"] input')?.getAttribute('placeholder')).toBe(
      'Search report files',
    );

    // The runs search leaves the files alone.
    fixture.componentInstance.search.set('nothing-like-this');
    expect(fixture.componentInstance.filteredEntries()).toEqual(fixture.componentInstance.entries());
  });

  it('hides the run form from members who may not run reports', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    expect(fixture.componentInstance.scopes()).toEqual([]);
    expect(el().querySelector('[data-testid="report-run-form"]')).toBeNull();
    expect(el().querySelector('[data-testid="report-run-open"]')).toBeNull();
  });

  it('walks the tree, downloads files and folders', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'admin' } });

    const component = fixture.componentInstance;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    component.openEntry({ name: '09', path: 'cluster/2026/09', type: 'folder' });
    expect(facade['openFolder']).toHaveBeenLastCalledWith('cluster/2026/09');
    component.up();
    expect(facade['openFolder']).toHaveBeenLastCalledWith('cluster');

    component.openEntry({ name: 'report.json', path: 'cluster/2026/report.json', type: 'file' });
    expect(service.download).toHaveBeenCalledWith('cluster/2026/report.json');

    component.downloadFolder('cluster/2026');
    expect(service.archive).toHaveBeenCalledWith('cluster/2026');
    expect(click).toHaveBeenCalledTimes(2);

    service.archive.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, error: { message: 'folder too large for one archive' } })),
    );
    component.downloadFolder('cluster');
    await Promise.resolve();
    expect(component.fileError()).toBe('folder too large for one archive');

    service.download.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 404, error: new Blob([JSON.stringify({ message: 'No such report file' })]) }),
      ),
    );
    component.downloadFile('cluster/2026/missing.json', 'missing.json');
    for (let i = 0; i < 50 && component.fileError() !== 'No such report file'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(component.fileError()).toBe('No such report file');
    expect((window.URL.createObjectURL as jest.Mock).mock.calls[0][0].type).toBe('application/octet-stream');

    component.showFiles(report());
    expect(facade['openFolder']).toHaveBeenLastCalledWith('cluster/2026/09');
    expect(component.lane()).toBe('files');
  });

  it('opens report.html in a new tab inside a sandboxed viewer', async () => {
    await setup({ userId: 'u', clusterRole: 'auditor', projects: {} });

    const tab = { location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const created: Blob[] = [];

    (window.URL.createObjectURL as jest.Mock).mockImplementation((blob: Blob) => {
      created.push(blob);

      return 'blob:viewer';
    });
    const download = new Subject<Blob>();

    service.download.mockReturnValue(download);

    fixture.componentInstance.openReport('cluster/2026/09/report.html');
    expect(open).toHaveBeenCalledWith('', '_blank');

    download.next(new Blob(['<h1>September</h1>']));
    download.complete();
    for (let i = 0; i < 50 && !tab.location.href; i++) await new Promise((resolve) => setTimeout(resolve, 5));

    expect(tab.location.href).toBe('blob:viewer');
    expect(created[0].type).toBe('text/html');
    expect(await readBlobText(created[0])).toContain('sandbox=""');
    // The viewer stays loadable while its tab is open (no timed revoke).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:viewer');
    expect(fixture.componentInstance.busyPath()).toBeNull();
  });

  it('reports a blocked tab', async () => {
    await setup({ userId: 'u', clusterRole: 'auditor', projects: {} });
    jest.spyOn(window, 'open').mockReturnValue(null);

    fixture.componentInstance.openReport('cluster/2026/09/report.html');

    expect(service.download).not.toHaveBeenCalled();
    expect(fixture.componentInstance.fileError()).toBeTruthy();
  });
});
