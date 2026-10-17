import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';

import { facadeStub, testBackup } from '../testing';
import { LoadweaverBackupRestoreModalComponent } from './backup-restore-modal.component';

const ID = '6f0c1b0e-0000-4000-8000-000000000001';

describe('LoadweaverBackupRestoreModalComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupRestoreModalComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(path: string | null = null) {
    facade = facadeStub({ planningRestore$: false, restorePlanError$: null }, ['planRestore', 'clearRestorePlanError']);

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupRestoreModalComponent],
      providers: [{ provide: ConsoleBackupsFacade, useValue: facade }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupRestoreModalComponent);
    fixture.componentRef.setInput('backup', testBackup());
    fixture.componentRef.setInput('candidates', [
      testBackup(),
      testBackup({ id: 'b-failed', status: 'failed' }),
      testBackup({ id: 'b0', startedAt: '2026-09-30T10:00:00.000Z' }),
    ]);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('volumes', [
      { id: 'shop/web/data', project: 'shop', deployment: 'web', name: 'data' },
      { id: 'shop/web/cache', project: 'shop', deployment: 'web', name: 'cache' },
      { id: 'blog/web/data', project: 'blog', deployment: 'web', name: 'data' },
    ]);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  }

  const body = () => document.body;

  it('restores the whole volume into itself, warning that containers stop', async () => {
    await setup();

    const c = fixture.componentInstance;

    expect(c.choices().map((b) => b.id)).toEqual([ID, 'b0']);
    expect(c.scope()).toBe('volume');
    c.next();
    fixture.detectChanges();

    expect(body().querySelector('[data-testid="restore-stop-warning"]')?.textContent).toContain('stopped');
    c.submit();
    expect(facade['planRestore']).toHaveBeenCalledWith({
      backup: { id: ID, project: 'shop' },
      deployment: 'web',
      volume: 'data',
      mode: 'replace',
    });
  });

  it('restores side by side into a new volume of the project', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.next();
    c.target.set('other');
    fixture.detectChanges();

    expect(c.deployments()).toEqual(['web']);
    expect(c.deploymentVolumes()).toEqual(['cache', 'data']);
    expect(c.targetVolume()).toBe('data-restored');
    expect(c.targetExists()).toBe(false);
    expect(body().querySelector('[data-testid="restore-new-volume"]')).not.toBeNull();
    c.volume.set('Bad Name');
    expect(c.valid()).toBe(false);
    c.volume.set('cache');
    c.mode.set('merge');
    expect(c.targetExists()).toBe(true);
    c.submit();
    expect(facade['planRestore']).toHaveBeenCalledWith(expect.objectContaining({ volume: 'cache', mode: 'merge' }));
  });

  it('restores a single path prefilled from the file browser', async () => {
    await setup('/uploads/a.txt');

    const c = fixture.componentInstance;

    expect(c.scope()).toBe('path');
    expect(c.sourcePath()).toBe('uploads/a.txt');
    expect(c.mode()).toBe('merge');
    c.next();
    c.targetPath.set('restored/a.txt');
    c.overwrite.set(true);
    c.description.set('ticket 42');
    c.submit();
    expect(facade['planRestore']).toHaveBeenCalledWith({
      backup: { id: ID, project: 'shop' },
      deployment: 'web',
      volume: 'data',
      mode: 'merge',
      path: 'uploads/a.txt',
      targetPath: 'restored/a.txt',
      overwrite: true,
      description: 'ticket 42',
    });
  });

  it('refuses invalid paths', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.setScope('path');
    c.sourcePath.set('../etc/passwd');
    expect(c.stepOneValid()).toBe(false);
    c.next();
    expect(c.step()).toBe(1);
    c.sourcePath.set('uploads');
    c.next();
    c.targetPath.set('a/../b');
    expect(c.valid()).toBe(false);
  });
});
