import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ConsoleTrustedFleetsService,
  type TrustedFleet,
  type TrustedFleetInput,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

export const MAX_TRUSTED_FLEET_KEYS = 3;
const ISSUER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const PEM = /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/;

/** The editor's form: one row per key (`kid` + PEM as pasted from the fleet). */
export interface TrustedFleetForm {
  issuer: string;
  name: string;
  keys: { kid: string; publicKey: string }[];
}

export function trustedFleetForm(fleet: TrustedFleet | null): TrustedFleetForm {
  return fleet
    ? { issuer: fleet.issuer, name: fleet.name, keys: fleet.keys.map((k) => ({ kid: k.kid, publicKey: k.publicKey })) }
    : { issuer: '', name: '', keys: [{ kid: '', publicKey: '' }] };
}

/** The form's problem (null when it can be saved): the server validates the keys again (Ed25519). */
export function trustedFleetFormError(form: TrustedFleetForm): string | null {
  if (!ISSUER.test(form.issuer.trim()))
    return $localize`:@@lwConsoleTrustedFleets-invalidIssuer:Enter the fleet's issuer id as the fleet shows it.`;

  if (!form.name.trim()) return $localize`:@@lwConsoleTrustedFleets-invalidName:Enter a name.`;

  const keys = form.keys.filter((k) => k.kid.trim() || k.publicKey.trim());

  if (keys.length === 0 || keys.length > MAX_TRUSTED_FLEET_KEYS)
    return $localize`:@@lwConsoleTrustedFleets-invalidKeyCount:Add one to three keys.`;

  if (keys.some((k) => !KID.test(k.kid.trim()) || !PEM.test(k.publicKey.trim())))
    return $localize`:@@lwConsoleTrustedFleets-invalidKey:Each key needs its key id and the public key (PEM) as the fleet shows them.`;

  if (new Set(keys.map((k) => k.kid.trim())).size !== keys.length)
    return $localize`:@@lwConsoleTrustedFleets-duplicateKey:A key id is used twice.`;

  return null;
}

export function trustedFleetPayload(form: TrustedFleetForm): TrustedFleetInput {
  return {
    name: form.name.trim(),
    keys: form.keys
      .filter((k) => k.kid.trim() || k.publicKey.trim())
      .map((k) => ({ kid: k.kid.trim(), publicKey: k.publicKey.trim() })),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: string | string[] } | null)?.message;

    return Array.isArray(message) ? message.join('; ') : (message ?? error.message);
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * Trusted fleets (3.24, cluster admins, only in the cluster's own console): the fleets whose signed identity
 * claims this cluster accepts, so approvals through a fleet are given — and counted — as the real person. Each fleet
 * shows its issuer id and public keys (with fingerprints) to copy here; up to three keys allow a rotation.
 */
@Component({
  selector: 'loadweaver-trusted-fleets-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './trusted-fleets-page.component.html',
  standalone: true,
})
export class LoadweaverTrustedFleetsPageComponent implements OnInit {
  private readonly api = inject(ConsoleTrustedFleetsService);

  readonly fleets = signal<TrustedFleet[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** The editor: `null` closed, `editing` the issuer of an existing fleet (issuer fixed). */
  readonly editorOpen = signal(false);
  readonly editing = signal<string | null>(null);
  readonly form = signal<TrustedFleetForm>(trustedFleetForm(null));
  readonly formError = computed(() => trustedFleetFormError(this.form()));
  readonly attempted = signal(false);
  readonly removeFor = signal<TrustedFleet | null>(null);
  readonly maxKeys = MAX_TRUSTED_FLEET_KEYS;

  readonly title = $localize`:@@lwConsoleTrustedFleets-title:Trusted fleets`;
  readonly refreshLabel = $localize`:@@lwConsoleTrustedFleets-refresh:Refresh`;
  readonly addLabel = $localize`:@@lwConsoleTrustedFleets-add:Trust a fleet`;
  readonly editKeysLabel = $localize`:@@lwConsoleTrustedFleets-editKeys:Edit keys`;
  readonly removeLabel = $localize`:@@lwConsoleTrustedFleets-remove:Remove`;
  readonly editorTitle = $localize`:@@lwConsoleTrustedFleets-editorTitle:Trusted fleet`;
  readonly removeTitle = $localize`:@@lwConsoleTrustedFleets-removeTitle:Stop trusting this fleet?`;
  readonly removeMessage = $localize`:@@lwConsoleTrustedFleets-removeMessage:Approvals through this fleet stop working; everything else through the fleet keeps working as the fleet's service user.`;
  readonly removeConfirm = $localize`:@@lwConsoleTrustedFleets-removeConfirm:Stop trusting`;
  readonly cancelLabel = $localize`:@@lwConsoleTrustedFleets-cancel:Cancel`;
  /** Lane title: never repeats the page title (3.38 R8). */
  readonly laneTitle = $localize`:@@lwConsoleTrustedFleets-fleets:Fleets`;
  readonly searchLabel = $localize`:@@lwConsoleTrustedFleets-search:Search fleets`;
  readonly loadingLabel = $localize`:@@lwConsoleTrustedFleets-loading:Loading trusted fleets`;
  readonly removeKeyLabel = $localize`:@@lwConsoleTrustedFleets-removeKey:Remove key`;
  /** 3.38 D1: State · Fleet · issuer · key fingerprints · last key added. */
  readonly columns: FpcTableColumn<TrustedFleet>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleTrustedFleets-colState:Status`,
      type: 'state',
      state: (f) =>
        f.keys.length > 0
          ? { label: $localize`:@@lwConsoleTrustedFleets-stateTrusted:Trusted`, tone: 'success', icon: 'shield-check' }
          : { label: $localize`:@@lwConsoleTrustedFleets-stateNoKeys:No keys`, tone: 'warning' },
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleTrustedFleets-colFleet:Fleet`,
      value: (f) => f.name,
      required: true,
      priority: 1,
    },
    {
      id: 'issuer',
      label: $localize`:@@lwConsoleTrustedFleets-issuer:Issuer`,
      value: (f) => f.issuer,
      mono: true,
      priority: 1,
    },
    { id: 'keys', label: $localize`:@@lwConsoleTrustedFleets-colKeys:Key fingerprints`, priority: 2 },
    {
      id: 'added',
      label: $localize`:@@lwConsoleTrustedFleets-colAdded:Last key added`,
      value: (f) => this.lastKeyAdded(f) ?? '',
      priority: 3,
    },
  ];
  readonly fleetId = (f: TrustedFleet): string => f.issuer;
  readonly keysOf = (f: TrustedFleet) => f.keys;
  readonly lastKeyAdded = (f: TrustedFleet): string | null =>
    f.keys
      .map((k) => k.addedAt)
      .sort()
      .at(-1) ?? null;
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.editKeysLabel, icon: 'pencil' },
    { id: 'remove', label: this.removeLabel, icon: 'trash', danger: true, dividerBefore: true },
  ];
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkRemove = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly selectedFleets = computed(() => {
    const ids = new Set(this.selected());

    return this.fleets().filter((f) => ids.has(f.issuer));
  });
  readonly search = signal('');
  readonly visible = computed(() =>
    filterBySearch(this.fleets(), this.search(), (f) => [f.name, f.issuer, f.keys.map((k) => k.kid)]),
  );

  /** Section title of key `index` in the editor. */
  keyLabel(index: number): string {
    return $localize`:@@lwConsoleTrustedFleets-keyN:Key ${index + 1}:number:`;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      this.fleets.set(await firstValueFrom(this.api.list()));
      this.loaded.set(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  openEditor(fleet: TrustedFleet | null): void {
    this.editing.set(fleet?.issuer ?? null);
    this.form.set(trustedFleetForm(fleet));
    this.attempted.set(false);
    this.error.set(null);
    this.editorOpen.set(true);
  }

  patch(change: Partial<TrustedFleetForm>): void {
    this.form.update((f) => ({ ...f, ...change }));
  }

  patchKey(index: number, change: Partial<{ kid: string; publicKey: string }>): void {
    this.form.update((f) => ({ ...f, keys: f.keys.map((k, i) => (i === index ? { ...k, ...change } : k)) }));
  }

  addKey(): void {
    this.form.update((f) =>
      f.keys.length >= MAX_TRUSTED_FLEET_KEYS ? f : { ...f, keys: [...f.keys, { kid: '', publicKey: '' }] },
    );
  }

  removeKey(index: number): void {
    this.form.update((f) => ({ ...f, keys: f.keys.filter((_, i) => i !== index) }));
  }

  async save(): Promise<void> {
    this.attempted.set(true);

    if (this.formError()) return;

    this.busy.set(true);
    this.error.set(null);

    try {
      const form = this.form();

      await firstValueFrom(this.api.put(form.issuer.trim(), trustedFleetPayload(form)));
      this.editorOpen.set(false);
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  onRowAction(fleet: TrustedFleet, action: string): void {
    if (action === 'edit') this.openEditor(fleet);
    else if (action === 'remove') this.removeFor.set(fleet);
  }

  /** Bulk Remove: one call per fleet (same endpoint + authorization as the row action), per-fleet result. */
  async removeSelected(): Promise<void> {
    const fleets = this.selectedFleets();

    if (fleets.length === 0) return;

    this.busy.set(true);

    try {
      const result = await fpcRunBulk(fleets, (fleet) => firstValueFrom(this.api.remove(fleet.issuer)));

      this.bulkResult.set(dlBulkSummary(result, (fleet) => fleet.name));
      this.selected.set([]);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  async confirmRemove(): Promise<void> {
    const fleet = this.removeFor();

    this.removeFor.set(null);

    if (!fleet) return;

    this.busy.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(this.api.remove(fleet.issuer));
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
