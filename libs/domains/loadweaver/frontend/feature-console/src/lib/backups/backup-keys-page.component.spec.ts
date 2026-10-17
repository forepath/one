import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BackupsService,
  ConsoleBackupKeysFacade,
  type DrInfoDocument,
  type KitShare,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, type BehaviorSubject } from 'rxjs';

import { facadeStub, testKeyGeneration } from '../testing';
import { LoadweaverBackupKeysPageComponent } from './backup-keys-page.component';

const share: KitShare = {
  document: {
    format: 'loadweaver-recovery-kit',
    version: 1,
    cluster: 'prod',
    generation: 1,
    rootId: 'root-1',
    index: 2,
    shares: 3,
    threshold: 2,
    share: 'abc',
    createdAt: '2026-10-01T10:00:00.000Z',
    checksum: '0123456789abcdef',
  },
  text: 'LOADWEAVER RECOVERY KIT\nshare 2 of 3\nabc',
};

describe('LoadweaverBackupKeysPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverBackupKeysPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let createObjectURL: jest.Mock;
  let backups: { drInfo: jest.Mock };

  async function setup(streams: Record<string, unknown> = {}) {
    const active = testKeyGeneration({
      generation: 2,
      kit: {
        shares: 3,
        threshold: 2,
        downloaded: [{ index: 1, downloadedAt: '2026-10-01T11:00:00.000Z', downloadedBy: 'u1' }],
        confirmedAt: null,
        confirmedBy: null,
      },
    });
    const retired = testKeyGeneration({
      active: false,
      retiredAt: '2026-10-01T10:00:00.000Z',
      kit: { shares: 3, threshold: 2, downloaded: [], confirmedAt: '2026-09-01T10:00:00.000Z', confirmedBy: 'u1' },
      escrow: { provider: 'vault', keyRef: 'k', at: '2026-09-01T10:00:00.000Z' },
    });

    facade = facadeStub(
      {
        generations$: [active, retired],
        active$: active,
        loaded$: true,
        loading$: false,
        error$: null,
        acting$: null,
        actionError$: null,
        lastSuccess$: null,
        share$: null,
        ...streams,
      },
      ['load', 'rotate', 'reissue', 'downloadShare', 'confirm', 'escrow', 'clearShare', 'clearActionError'],
    );
    backups = {
      drInfo: jest.fn(() =>
        of({
          format: 'loadweaver-dr-info',
          version: 1,
          clusterId: 'prod',
          keys: [],
          targets: [],
        } as unknown as DrInfoDocument),
      ),
    };
    createObjectURL = jest.fn(() => 'blob:x');
    Object.assign(window.URL, { createObjectURL, revokeObjectURL: jest.fn() });

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupKeysPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleBackupKeysFacade, useValue: facade },
        { provide: BackupsService, useValue: backups },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverBackupKeysPageComponent);
    fixture.detectChanges();
  }

  const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('warns that backups are not recoverable and lists generations with their shares', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(q('keys-not-recoverable')?.textContent).toContain('not recoverable');
    expect(q('keys-generation-2')?.textContent).toContain('Kit not confirmed');
    expect(q('keys-generation-1')?.textContent).toContain('Escrowed in KMS');
    expect(q('keys-shares-2')?.textContent).toContain('handed out');
    expect(q('keys-share-2-1')).toBeNull();
    expect(q('keys-share-2-2')).not.toBeNull();
    expect(q('keys-escrow-1')).toBeNull();
  });

  it('hands out a share only after a confirmation', async () => {
    await setup();

    (q('keys-share-2-2')?.querySelector('button') as HTMLButtonElement).click();
    expect(facade['downloadShare']).not.toHaveBeenCalled();
    fixture.componentInstance.downloadShare();
    expect(facade['downloadShare']).toHaveBeenCalledWith(2, 2);
  });

  it('saves a received share as a text file once and shows it once', async () => {
    await setup();

    (facade['share$'] as BehaviorSubject<unknown>).next({ generation: 2, index: 2, share });
    fixture.detectChanges();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(q('keys-share-once')?.textContent).toContain("can't be downloaded again");
    expect((q('keys-share-text') as HTMLTextAreaElement).value).toContain('share 2 of 3');
    fixture.detectChanges();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    (q('keys-share-close')?.querySelector('button') as HTMLButtonElement).click();
    expect(facade['clearShare']).toHaveBeenCalled();
  });

  it('confirms the kit with pasted shares', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.openConfirm(c.generations()[0]);
    expect(c.pasted()).toEqual(['', '']);
    c.setPasted(0, ' share-a ');
    c.setPasted(1, 'share-b');
    c.addPasted();
    c.addPasted();
    expect(c.pasted()).toHaveLength(3);
    c.submitConfirm();
    expect(facade['confirm']).toHaveBeenCalledWith(2, ['share-a', 'share-b']);
  });

  it('re-issues and rotates with a valid kit size (default 3 / 2)', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.openSize({ mode: 'rotate' });
    expect([c.kitShares, c.kitThreshold]).toEqual([3, 2]);
    c.kitThreshold = 4;
    expect(c.validSize(c.kitShares, c.kitThreshold)).toBe(false);
    c.submitSize();
    expect(facade['rotate']).not.toHaveBeenCalled();
    c.kitShares = 5;
    c.kitThreshold = 3;
    c.submitSize();
    expect(facade['rotate']).toHaveBeenCalledWith({ shares: 5, threshold: 3 });
    c.openSize({ mode: 'reissue', generation: 2 }, c.generations()[0]);
    c.submitSize();
    expect(facade['reissue']).toHaveBeenCalledWith(2, { shares: 3, threshold: 2 });
  });

  it('escrows after a confirmation and closes dialogs on success', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.askEscrow(c.generations()[0]);
    c.escrow();
    expect(facade['escrow']).toHaveBeenCalledWith(2);
    c.openConfirm(c.generations()[0]);
    (facade['lastSuccess$'] as BehaviorSubject<unknown>).next({ action: 'confirm', generation: 2 });
    fixture.detectChanges();
    expect(c.confirmFor()).toBeNull();
  });

  it('downloads the DR info next to the kit and links the platform backups', async () => {
    await setup();

    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    expect(q('keys-dr-platform')).not.toBeNull();
    await fixture.componentInstance.downloadDrInfo();
    expect(backups.drInfo).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(fixture.componentInstance.drError()).toBeNull();
    click.mockRestore();
  });
});
