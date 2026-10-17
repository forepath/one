import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleRemoteAccessFacade,
  type VpnClient,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import {
  deviceStatusLabel,
  deviceStatusTone,
  enrollCommand,
  isConnected,
  isRestricted,
  mayManageAllDevices,
  restrictionLines,
} from './device-format';

const REFRESH_MS = 30_000;

/**
 * Remote access (3.31): the caller's enrolled devices (every client for infra operators and cluster admins) with
 * posture state and connection, instant revocation, and how to enroll a device with the CLI — the key pair is
 * generated on the device, so no private key ever passes through the browser.
 */
@Component({
  selector: 'loadweaver-devices-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
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

  readonly title = $localize`:@@lwConsoleDevices-title:Remote access`;
  readonly refreshLabel = $localize`:@@lwConsoleDevices-refresh:Refresh`;
  readonly enrollTitle = $localize`:@@lwConsoleDevices-enroll:Enroll a device`;
  readonly mineTitle = $localize`:@@lwConsoleDevices-mine:My devices`;
  readonly allTitle = $localize`:@@lwConsoleDevices-all:All clients`;
  readonly revokeTitle = $localize`:@@lwConsoleDevices-revokeTitle:Revoke the device?`;
  readonly revokeConfirm = $localize`:@@lwConsoleDevices-revokeConfirm:Revoke`;
  readonly keepLabel = $localize`:@@lwConsoleDevices-keep:Keep`;
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

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revokeFor.set(null);
  }

  confirmRevoke(): void {
    const device = this.revokeFor();

    this.revokeFor.set(null);

    if (device) this.facade.revoke(device.id);
  }
}
