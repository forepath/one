import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, Injector, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleRemoteAccessFacade,
  RemoteAccessService,
  type VpnClient,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom, interval } from 'rxjs';

import {
  deviceStatusLabel,
  deviceStatusTone,
  enrollCommand,
  isConnected,
  isRestricted,
  mayManageAllDevices,
  restrictionLines,
} from './device-format';
import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem } from '../section/data-list';
import { certificateLabel, certificateTone, factLabel, factTone, reportSummary } from '../posture/posture-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const REFRESH_MS = 30_000;

/**
 * Remote access (3.31): the caller's enrolled devices (every client for infra operators and cluster admins) with
 * posture state and connection, instant revocation, and how to enroll a device with the CLI — the key pair is
 * generated on the device, so no private key ever passes through the browser.
 */
@Component({
  selector: 'loadweaver-devices-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    CommonModule,
    FormsModule,
  ],
  templateUrl: './devices-page.component.html',
  standalone: true,
})
export class LoadweaverDevicesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleRemoteAccessFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly devices = toSignal(this.facade.devices$, { initialValue: [] as VpnClient[] });
  readonly all = toSignal(this.facade.all$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly revoking = toSignal(this.facade.revoking$, { initialValue: null });
  readonly revokeError = toSignal(this.facade.revokeError$, { initialValue: null });
  readonly restrictedCount = toSignal(this.facade.restrictedCount$, { initialValue: 0 });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly search = signal('');
  /** The enroll modal (3.38 decision 12). */
  readonly enrollOpen = signal(false);
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filtered = computed(() =>
    filterBySearch(this.devices(), this.search(), (d) => [
      d.name,
      d.owner,
      d.address,
      d.subnets,
      d.effectiveGroups,
      d.lastEndpoint,
      this.statusLabel(d.status),
    ]),
  );
  readonly mayManageAll = computed(() => mayManageAllDevices(this.me()?.clusterRole));
  readonly deviceName = signal('');
  readonly command = computed(() => enrollCommand(this.deviceName()));
  readonly revokeFor = signal<VpnClient | null>(null);
  readonly revokeMessage = computed(() => {
    const device = this.revokeFor();

    return device
      ? $localize`:@@lwConsoleDevices-revokeMessage:${device.name}:name: (${device.owner}:owner:) loses remote access immediately. It has to enroll again.`
      : null;
  });

  readonly statusTone = deviceStatusTone;
  readonly statusLabel = deviceStatusLabel;
  readonly restricted = isRestricted;
  readonly restrictionLines = restrictionLines;
  readonly connected = (device: VpnClient) => isConnected(device);
  readonly reportSummary = reportSummary;
  readonly factLabel = (fact: Parameters<typeof factLabel>[0]) => factLabel(fact);
  readonly factTone = (fact: Parameters<typeof factTone>[0]) => factTone(fact);
  readonly certificateLabel = (certificate: Parameters<typeof certificateLabel>[0]) => certificateLabel(certificate);
  readonly certificateTone = (certificate: Parameters<typeof certificateTone>[0]) => certificateTone(certificate);

  readonly title = $localize`:@@lwConsoleDevices-title:Remote access`;
  readonly refreshLabel = $localize`:@@lwConsoleDevices-refresh:Refresh`;
  readonly closeLabel = $localize`:@@lwConsoleDevices-close:Close`;
  readonly enrollTitle = $localize`:@@lwConsoleDevices-enroll:Enroll a device`;
  readonly mineTitle = $localize`:@@lwConsoleDevices-mine:My devices`;
  readonly allTitle = $localize`:@@lwConsoleDevices-all:All clients`;
  readonly revokeTitle = $localize`:@@lwConsoleDevices-revokeTitle:Revoke the device?`;
  readonly revokeConfirm = $localize`:@@lwConsoleDevices-revokeConfirm:Revoke`;
  readonly keepLabel = $localize`:@@lwConsoleDevices-keep:Keep`;
  readonly revokeLabel = $localize`:@@lwConsoleDevices-revoke:Revoke`;
  readonly searchLabel = $localize`:@@lwConsoleDevices-search:Search devices`;
  readonly loadingLabel = $localize`:@@lwConsoleDevices-loading:Loading devices`;
  readonly machineLabel = $localize`:@@lwConsoleDevices-machine:Machine`;
  readonly connectedLabel = $localize`:@@lwConsoleDevices-connected:Connected`;

  /** 3.38 D1: State · Device · posture · owner (all clients) · address · subnets · groups · expires · handshake. */
  readonly columns = computed<FpcTableColumn<VpnClient>[]>(() => [
    {
      id: 'status',
      label: $localize`:@@lwConsoleDevices-colStatus:Status`,
      type: 'state',
      state: (d) => ({ label: deviceStatusLabel(d.status), tone: deviceStatusTone(d.status) }),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDevices-colDevice:Device`,
      value: (d) => d.name,
      required: true,
      priority: 1,
    },
    { id: 'posture', label: $localize`:@@lwConsoleDevices-colPosture:Posture`, priority: 1 },
    ...(this.all()
      ? [{ id: 'owner', label: $localize`:@@lwConsoleDevices-colOwner:Owner`, value: (d: VpnClient) => d.owner }]
      : []),
    {
      id: 'address',
      label: $localize`:@@lwConsoleDevices-colAddress:Address`,
      value: (d) => d.address,
      mono: true,
    },
    {
      id: 'subnets',
      label: $localize`:@@lwConsoleDevices-colSubnets:Subnets`,
      value: (d) => d.subnets.join(', '),
      mono: true,
      priority: 3,
    },
    {
      id: 'groups',
      label: $localize`:@@lwConsoleDevices-groups:Groups`,
      value: (d) => d.effectiveGroups.join(', '),
      priority: 3,
    },
    {
      id: 'validity',
      label: $localize`:@@lwConsoleDevices-expires:Expires`,
      value: (d) => d.revokedAt ?? d.expiresAt,
    },
    {
      id: 'handshake',
      label: $localize`:@@lwConsoleDevices-lastHandshake:Last handshake`,
      value: (d) => d.lastHandshakeAt ?? '',
      priority: 3,
    },
  ]);

  private readonly injector = inject(Injector);
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkRevoke = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly revokeSelectedHint = $localize`:@@lwConsoleDevices-revokeSelectedHint:Revoke the selected devices`;
  readonly revokeSelectedTitle = $localize`:@@lwConsoleDevices-revokeSelectedTitle:Revoke devices?`;
  readonly revokeSelectedMessage = computed(
    () =>
      $localize`:@@lwConsoleDevices-revokeSelectedMessage:${this.selectedDevices().length}:count: selected devices lose remote access immediately and have to enroll again.`,
  );
  private readonly selectedDevices = computed(() => {
    const ids = new Set(this.selected());

    return this.devices().filter((d) => ids.has(d.id));
  });
  /** Revoked devices cannot be revoked again; the server checks every device (owner / infra role). */
  readonly canRevokeSelection = computed(
    () => this.selectedDevices().length > 0 && this.selectedDevices().every((d) => d.status !== 'revoked'),
  );
  readonly rowMenu = (device: VpnClient): FpcMenuItem[] => [
    ...(device.status !== 'revoked' ? [{ id: 'revoke', label: this.revokeLabel, icon: 'trash', danger: true }] : []),
    dlCopyIdItem(),
  ];
  readonly restrictedLabel = $localize`:@@lwConsoleDevices-restrictedCount:active device(s) restricted by posture checks: some groups are replaced by their restricted group.`;

  ngOnInit(): void {
    this.facade.load(false);
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.all(), true));
  }

  refresh(): void {
    this.facade.load(this.all());
  }

  showAll(all: boolean): void {
    this.facade.load(all && this.mayManageAll());
  }

  copy(text: string): void {
    void navigator.clipboard?.writeText(text);
  }

  onRowAction(device: VpnClient, action: string): void {
    if (action === 'revoke') this.revokeFor.set(device);
    else if (action === 'copy-id') fpcCopyText(device.id);
  }

  /** Bulk Revoke: one call per device (same endpoint + authorization as the row action), per-device result. */
  async revokeSelected(): Promise<void> {
    const devices = this.selectedDevices().filter((d) => d.status !== 'revoked');

    if (devices.length === 0) return;

    const service = this.injector.get(RemoteAccessService);
    const result = await fpcRunBulk(devices, (device) => firstValueFrom(service.revoke(device.id)));

    this.bulkResult.set(dlBulkSummary(result, (device) => device.name));
    this.selected.set([]);
    this.refresh();
  }

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revokeFor.set(null);
  }

  confirmRevoke(): void {
    const device = this.revokeFor();

    this.revokeFor.set(null);

    if (device) this.facade.revoke(device.id);
  }
}
