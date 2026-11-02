import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type BackupRestore,
  type RestoreTest,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverBackupRestoresPageComponent } from './backup-restores-page.component';

function restore(overrides: Partial<BackupRestore> = {}): BackupRestore {
  return {
    id: 'r1',
    project: 'shop',
    name: 'restore-web',
    generation: 1,
    backupId: 'b1',
    volume: 'shop/web/data',
    kind: 'volume',
    status: 'done',
    node: 'n1',
    progress: null,
    error: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    finishedAt: '2026-10-01T10:05:00.000Z',
    ...overrides,
  };
}

function test(overrides: Partial<RestoreTest> = {}): RestoreTest {
  return {
    id: 't1',
    backupId: 'b1',
    project: 'shop',
    resource: 'shop/web/data',
    node: 'n1',
    status: 'passed',
    keyGeneration: 1,
    check: null,
    error: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

describe('LoadweaverBackupRestoresPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupRestoresPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        restores$: [restore(), restore({ id: 'r2', name: 'restore-db', volume: 'shop/db/pg', backupId: 'b2' })],
        restoreTests$: [test()],
        restoresLoaded$: true,
        restoresLoading$: false,
        restoresError$: null,
        restoresBusy$: false,
        openDeletions$: [],
      },
      ['loadRestores'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupRestoresPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupRestoresPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`);

  it('lists restores as a table; the name links the backup, ids only via Copy ID', () => {
    expect(facade['loadRestores']).toHaveBeenCalled();
    expect(el().querySelector('fpc-list-header')).toBeNull();
    expect(q('restores-list')?.querySelector('a.fpc-data-table__link')?.getAttribute('href')).toContain(
      '/operate/backups/',
    );
    expect(fixture.componentInstance.menu().map((i) => i.id)).toEqual(['open-backup', 'copy-id']);
  });

  it('searches restores and shows the no-matches state', () => {
    fixture.componentInstance.search.set('pg');
    fixture.detectChanges();
    expect(q('restores-list')?.textContent).toContain('restore-db');
    expect(q('restores-list')?.textContent).not.toContain('restore-web');

    fixture.componentInstance.search.set('nothing');
    fixture.detectChanges();
    expect(q('fpc-data-table-no-matches')).not.toBeNull();
  });

  it('searches restore tests on their tab', () => {
    fixture.componentInstance.activeTab.set('tests');
    fixture.componentInstance.testSearch.set('web');
    fixture.detectChanges();
    expect(q('restore-tests-list')?.textContent).toContain('web');
    expect(q('restores-list')).toBeNull();

    fixture.componentInstance.testSearch.set('nothing');
    fixture.detectChanges();
    expect(q('fpc-data-table-no-matches')).not.toBeNull();
  });
});
