import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  BackupsService,
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleLiveFacade,
  type AccessMe,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of } from 'rxjs';

import { accessStub, facadeStub, testBackup } from '../testing';
import { LoadweaverBackupDetailPageComponent } from './backup-detail-page.component';

const ID = '6f0c1b0e-0000-4000-8000-000000000001';

describe('LoadweaverBackupDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let service: { download: jest.Mock };

  async function setup(me: AccessMe, path = 'uploads') {
    const backup = testBackup({ lockedUntil: '2099-01-01T00:00:00.000Z' });

    query = new BehaviorSubject(convertToParamMap(path ? { path } : {}));
    facade = facadeStub(
      {
        selected$: backup,
        volumeBackups$: [backup, testBackup({ id: 'b0', startedAt: '2026-09-30T10:00:00.000Z' })],
        selectedLoading$: false,
        selectedError$: null,
        files$: {
          id: ID,
          path,
          loading: false,
          error: null,
          entries: [
            { name: 'a.txt', directory: false, mode: '-rw-r--r--', size: 2048, modified: '2026-10-01', object: 'o1' },
            { name: 'img', directory: true, mode: 'drwxr-xr-x', size: 0, modified: '2026-10-01', object: 'o2' },
          ],
        },
        testing$: [],
        actionError$: null,
        planningRestore$: false,
        restorePlanError$: null,
      },
      ['open', 'browse', 'testNow', 'planRestore', 'clearRestorePlanError'],
    );
    service = { download: jest.fn().mockReturnValue(of(new Blob(['x']))) };

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupsFacade, useValue: facade },
        { provide: BackupsService, useValue: service },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        { provide: ConsoleLiveFacade, useValue: facadeStub({ volumes$: [] }, ['loadTargets']) },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: ID })),
            queryParamMap: query,
            snapshot: { queryParamMap: query.value },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupDetailPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('opens the backup and lists the directory, folders first', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } });

    expect(facade['open']).toHaveBeenCalledWith(ID);
    expect(facade['browse']).toHaveBeenCalledWith(ID, 'uploads');
    expect(q('backup-details')?.textContent).toContain('shop/web/data');
    expect(q('backup-crumbs')?.textContent).toContain('uploads');

    const rows = [...(q('backup-files')?.querySelectorAll('tbody tr') ?? [])].map((r) => r.textContent ?? '');

    expect(rows[0]).toContain('img');
    expect(rows[1]).toContain('2.0 KiB');
    // Viewers browse and download, but don't restore.
    expect(q('backup-restore-a.txt')).toBeNull();
    expect(q('backup-restore')).toBeNull();
  });

  it('navigates into directories and downloads files', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;

    component.activate({ name: 'img', directory: true, mode: '', size: 0, modified: '', object: '' });
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { path: 'uploads/img' } }));

    Object.assign(window.URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    await component.download({ name: 'a.txt', directory: false, mode: '', size: 1, modified: '', object: '' });
    expect(service.download).toHaveBeenCalledWith(ID, 'uploads/a.txt');
    expect(component.downloading()).toBeNull();
  });

  it('restores a file or the directory through the wizard and starts restore tests', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    (q('backup-restore-a.txt') as HTMLButtonElement).click();
    expect(fixture.componentInstance.restoreOpen()).toBe(true);
    expect(fixture.componentInstance.restorePath()).toBe('uploads/a.txt');
    fixture.componentInstance.openRestore(fixture.componentInstance.path());
    expect(fixture.componentInstance.restorePath()).toBe('uploads');
    (q('backup-test')?.querySelector('button') as HTMLButtonElement).click();
    expect(facade['testNow']).toHaveBeenCalledWith(ID);
  });

  it('compares with an older backup of the volume', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } }, '');

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.openDiff();
    expect(fixture.componentInstance.diffOther).toBe('b0');
    fixture.componentInstance.compare();
    expect(navigate).toHaveBeenCalledWith(['/backups/diff'], { queryParams: { from: 'b0', to: ID } });
  });
});
