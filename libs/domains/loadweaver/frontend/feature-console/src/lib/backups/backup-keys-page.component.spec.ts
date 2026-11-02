import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type AccessMe,
  BackupsService,
  ConsoleAccessFacade,
  ConsoleBackupKeysFacade,
  ConsoleEndpointService,
  type DrInfoDocument,
  type KitShare,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, type BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub, testKeyGeneration } from '../testing';
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

  const me = (fleetIdentity: boolean) =>
    ({
      clusterRole: 'cluster-admin',
      projects: {},
      fleetIdentity,
      fleetApprovals: fleetIdentity,
    }) as unknown as AccessMe;

  async function setup(streams: Record<string, unknown> = {}, fleet = false, identity = true) {
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
        { provide: ConsoleAccessFacade, useValue: accessStub(me(fleet ? identity : false)) },
        ...(fleet
          ? [
              {
                provide: ConsoleEndpointService,
                useValue: { fleetMode: true, nativeConsoleUrl: (path: string) => `https://cp.example.com${path}` },
              },
            ]
          : []),
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
    const c = fixture.componentInstance;
    const [g2, g1] = c.generations();

    expect(q('keys-generations')?.textContent).toContain('Kit not confirmed');
    expect(q('keys-generations')?.querySelector('fpc-badge[aria-label="Escrowed in KMS"]')).not.toBeNull();
    // The active generation's shares are open: share 1 handed out, share 2 offers "Download once".
    const shares = c.sharesOf(g2);

    expect(q('keys-shares-2')).not.toBeNull();
    expect(c.shareActions(shares[0])).toEqual([]);
    expect(c.shareActions(shares[1]).map((i) => i.id)).toEqual(['download']);
    expect(c.generationMenu(g1).some((i) => i.id === 'escrow')).toBe(false);
    // No raw key root id (D11): only "Copy ID" in ⋮.
    expect(q('keys-generations')?.textContent).not.toContain(g2.rootId);
  });

  it('puts the kit actions of a generation in ⋮; rotate is the last action of the generations table head, primary (LW-06)', async () => {
    await setup();

    expect(
      fixture.componentInstance.generationMenu(fixture.componentInstance.generations()[0]).map((i) => i.id),
    ).toEqual(['escrow', 'confirm', 'reissue', 'copy-id']);
    expect(document.body.querySelector('[fpcPanelFooter]')).toBeNull();

    const actions = [
      ...document.body.querySelectorAll(
        '[data-testid="keys-generations"] [data-testid="fpc-data-table-toolbar"] fpc-button',
      ),
    ];

    expect(actions.at(-1)?.getAttribute('data-testid')).toBe('keys-rotate');
    expect(actions.at(-1)?.querySelector('button')?.classList).toContain('btn-primary');
  });

  it('fleet mode with a cluster that verifies this fleet: the kit actions are there, no note (2026-10-30)', async () => {
    await setup({}, true, true);

    expect(q('keys-fleet-trust')).toBeNull();
    const c = fixture.componentInstance;

    expect(c.shareActions(c.sharesOf(c.generations()[0])[1]).map((i) => i.id)).toEqual(['download']);
    expect(c.generationMenu(c.generations()[0]).map((i) => i.id)).toEqual(['escrow', 'confirm', 'reissue', 'copy-id']);
    expect(q('keys-rotate')).not.toBeNull();
  });

  it('fleet mode without trust: a note with the native link instead of the kit actions; rotate and escrow stay', async () => {
    await setup({}, true, false);

    expect(q('keys-fleet-trust')?.textContent).toContain('needs the cluster to trust this fleet');
    expect((q('keys-fleet-native-link') as HTMLAnchorElement | null)?.href).toBe(
      'https://cp.example.com/operate/backups/keys',
    );
    const c = fixture.componentInstance;

    expect(c.shareActions(c.sharesOf(c.generations()[0])[1])).toEqual([]);
    expect(c.generationMenu(c.generations()[0]).map((i) => i.id)).toEqual(['escrow', 'copy-id']);
    expect(q('keys-rotate')).not.toBeNull();
  });

  it('single-cluster mode: no fleet note, the kit actions are there', async () => {
    await setup();

    expect(q('keys-fleet-trust')).toBeNull();
    expect(
      fixture.componentInstance.generationMenu(fixture.componentInstance.generations()[0]).map((i) => i.id),
    ).toContain('reissue');
  });

  it('hands out a share only after a confirmation', async () => {
    await setup();

    const c = fixture.componentInstance;

    c.onShareAction(c.sharesOf(c.generations()[0])[1], 'download');
    expect(c.shareFor()).toEqual({ generation: 2, index: 2 });
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
    expect((q('keys-share-text')?.querySelector('textarea') as HTMLTextAreaElement).value).toContain('share 2 of 3');
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
