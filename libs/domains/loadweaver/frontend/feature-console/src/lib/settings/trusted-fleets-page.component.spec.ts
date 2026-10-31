import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsoleTrustedFleetsService, type TrustedFleet } from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import {
  LoadweaverTrustedFleetsPageComponent,
  trustedFleetForm,
  trustedFleetFormError,
  trustedFleetPayload,
} from './trusted-fleets-page.component';

const PEM = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAabc\n-----END PUBLIC KEY-----';
const fleet: TrustedFleet = {
  issuer: 'fleet-1',
  name: 'Main fleet',
  keys: [{ kid: 'k1', publicKey: PEM, addedAt: '2026-10-26T12:00:00.000Z', fingerprint: 'SHA256:abc' }],
  createdBy: 'admin',
  createdAt: '2026-10-26T12:00:00.000Z',
  updatedAt: '2026-10-26T12:00:00.000Z',
};

describe('trusted fleets (3.24)', () => {
  it('validates the form like the cluster', () => {
    const form = trustedFleetForm(null);

    expect(trustedFleetFormError(form)).not.toBeNull();
    expect(
      trustedFleetFormError({ issuer: 'fleet-1', name: 'Main', keys: [{ kid: 'k1', publicKey: PEM }] }),
    ).toBeNull();
    expect(
      trustedFleetFormError({ issuer: 'fleet 1', name: 'Main', keys: [{ kid: 'k1', publicKey: PEM }] }),
    ).not.toBeNull();
    expect(
      trustedFleetFormError({ issuer: 'fleet-1', name: 'Main', keys: [{ kid: 'k1', publicKey: 'nope' }] }),
    ).not.toBeNull();
    expect(
      trustedFleetFormError({
        issuer: 'fleet-1',
        name: 'Main',
        keys: [
          { kid: 'k1', publicKey: PEM },
          { kid: 'k1', publicKey: PEM },
        ],
      }),
    ).not.toBeNull();
    expect(
      trustedFleetPayload({
        issuer: 'fleet-1',
        name: ' Main ',
        keys: [
          { kid: ' k1 ', publicKey: ` ${PEM} ` },
          { kid: '', publicKey: '' },
        ],
      }),
    ).toEqual({ name: 'Main', keys: [{ kid: 'k1', publicKey: PEM }] });
    expect(trustedFleetForm(fleet)).toEqual({
      issuer: 'fleet-1',
      name: 'Main fleet',
      keys: [{ kid: 'k1', publicKey: PEM }],
    });
  });

  describe('page', () => {
    let fixture: ComponentFixture<LoadweaverTrustedFleetsPageComponent>;
    const api = {
      list: jest.fn(() => of([fleet])),
      put: jest.fn(() => of(fleet)),
      remove: jest.fn(() => of(undefined)),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      await TestBed.configureTestingModule({
        imports: [LoadweaverTrustedFleetsPageComponent],
        providers: [{ provide: ConsoleTrustedFleetsService, useValue: api }],
      }).compileComponents();
      fixture = TestBed.createComponent(LoadweaverTrustedFleetsPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    const el = () => fixture.nativeElement as HTMLElement;

    it('lists the trusted fleets with their key fingerprints', () => {
      expect(el().querySelector('[data-testid="trusted-fleet-fleet-1"]')?.textContent).toContain('SHA256:abc');
      expect(el().querySelector('fpc-list-header')).toBeNull();
      expect(el().querySelector('[data-testid="trusted-fleets-list"] tr.fpc-data-table__row')).not.toBeNull();
      expect(el().querySelector('[data-testid="trusted-fleets-lane"]')?.textContent).toContain('Fleets');
      // Edit / Remove sit in the row's ⋮ (3.38 D8).
      expect(fixture.componentInstance.rowMenu().map((item) => item.id)).toEqual(['edit', 'remove']);
    });

    it('searches the fleets', () => {
      fixture.componentInstance.search.set('nope');
      fixture.detectChanges();
      expect(
        el().querySelector('[data-testid="trusted-fleets-list"] [data-testid="fpc-data-table-no-matches"]'),
      ).not.toBeNull();
      fixture.componentInstance.search.set('fleet-1');
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toHaveLength(1);
    });

    it('saves a new fleet only when the form is valid, and removes after confirmation', async () => {
      const page = fixture.componentInstance;

      page.openEditor(null);
      await page.save();
      expect(api.put).not.toHaveBeenCalled();

      page.addKey();
      expect(page.keyLabel(1)).toBe('Key 2');
      page.removeKey(1);
      page.patch({ issuer: 'fleet-2', name: 'Second' });
      page.patchKey(0, { kid: 'k1', publicKey: PEM });
      await page.save();
      expect(api.put).toHaveBeenCalledWith('fleet-2', { name: 'Second', keys: [{ kid: 'k1', publicKey: PEM }] });
      expect(page.editorOpen()).toBe(false);

      page.removeFor.set(fleet);
      await page.confirmRemove();
      expect(api.remove).toHaveBeenCalledWith('fleet-1');
    });

    it('removes the selected fleets one by one and reports per fleet', async () => {
      const page = fixture.componentInstance;

      page.fleets.set([fleet, { ...fleet, issuer: 'fleet-2', name: 'Theirs' }]);
      api.remove.mockImplementation(((issuer: string) =>
        issuer === 'fleet-2' ? throwError(() => ({ status: 403 })) : of(undefined)) as never);
      page.selected.set(['fleet-1', 'fleet-2']);
      await page.removeSelected();
      expect(api.remove).toHaveBeenCalledWith('fleet-1');
      expect(api.remove).toHaveBeenCalledWith('fleet-2');
      expect(page.bulkResult()?.tone).toBe('warning');
      expect(page.bulkResult()?.message).toContain('Theirs');
    });
  });
});
