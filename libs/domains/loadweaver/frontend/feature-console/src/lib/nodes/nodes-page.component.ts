import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  type ConsoleNode,
  ConsoleNodesFacade,
  type CreateJoinTokenRequest,
  type JoinToken,
  type NodeSite,
  RESOURCE_NAME_PATTERN,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import {
  formatCores,
  lifecycleLabel,
  mayOperateNodes,
  nodeIcon,
  nodeTone,
  parseLabels,
  usagePercent,
} from './node-format';

const REFRESH_MS = 30_000;
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 24 * 60;

/**
 * The installer line. The join token is never part of it (shell history, process list): the line reads it without
 * echo (`read -rs`, pasted from the console) into `LOADWEAVER_JOIN_TOKEN`, which the installer takes from the
 * environment (`sudo --preserve-env` hands it over).
 */
export function joinCommand(scriptUrl: string): string {
  return (
    `printf 'Join token: ' && read -rs LOADWEAVER_JOIN_TOKEN && echo && export LOADWEAVER_JOIN_TOKEN && ` +
    `curl -fsSL ${scriptUrl} | sudo --preserve-env=LOADWEAVER_JOIN_TOKEN bash -s -- --name <node-name>`
  );
}

/**
 * Nodes & sites (3.2, 3.21): nodes grouped by site with lifecycle, connection, roles and capacity, the control plane's
 * membership, and join tokens for new nodes (infra operators and cluster admins).
 */
@Component({
  selector: 'loadweaver-nodes-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
  ],
  templateUrl: './nodes-page.component.html',
  standalone: true,
})
export class LoadweaverNodesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleNodesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly sites = toSignal(this.facade.sites$, { initialValue: [] as NodeSite[] });
  readonly nodes = toSignal(this.facade.nodes$, { initialValue: [] as ConsoleNode[] });
  readonly cluster = toSignal(this.facade.cluster$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly tokens = toSignal(this.facade.tokens$, { initialValue: [] as JoinToken[] });
  readonly tokensError = toSignal(this.facade.tokensError$, { initialValue: null });
  readonly creatingToken = toSignal(this.facade.creatingToken$, { initialValue: false });
  readonly createdToken = toSignal(this.facade.createdToken$, { initialValue: null });
  readonly revokingToken = toSignal(this.facade.revokingToken$, { initialValue: null });
  readonly tokenError = toSignal(this.facade.tokenError$, { initialValue: null });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly mayOperate = computed(() => mayOperateNodes(this.me()?.clusterRole));
  readonly connectedCount = computed(() => this.nodes().filter((n) => n.connected && n.lifecycle !== 'left').length);
  readonly memberCount = computed(() => this.nodes().filter((n) => n.lifecycle !== 'left').length);
  readonly joinCommand = computed(() => {
    const token = this.createdToken();

    return token ? joinCommand(this.facade.installScriptUrl()) : null;
  });

  readonly joinOpen = signal(false);
  readonly revokeFor = signal<JoinToken | null>(null);
  readonly invalid = signal(false);
  site = '';
  description = '';
  witness = false;
  ttlMinutes = DEFAULT_TTL_MINUTES;
  labels = '';

  readonly tone = nodeTone;
  readonly icon = nodeIcon;
  readonly lifecycleLabel = lifecycleLabel;
  readonly cores = formatCores;
  readonly bytes = formatBytes;
  readonly percent = usagePercent;
  readonly maxTtl = MAX_TTL_MINUTES;

  readonly title = $localize`:@@lwConsoleNodes-title:Nodes & sites`;
  readonly refreshLabel = $localize`:@@lwConsoleNodes-refresh:Refresh`;
  readonly clusterTitle = $localize`:@@lwConsoleNodes-cluster:Cluster`;
  readonly tokensTitle = $localize`:@@lwConsoleNodes-tokens:Join tokens`;
  readonly joinTitle = $localize`:@@lwConsoleNodes-joinTitle:Add a node`;
  readonly revokeTitle = $localize`:@@lwConsoleNodes-revokeTitle:Revoke the join token?`;
  readonly revokeMessage = $localize`:@@lwConsoleNodes-revokeMessage:A node can no longer join with it.`;
  readonly revokeConfirm = $localize`:@@lwConsoleNodes-revokeConfirm:Revoke`;
  readonly keepLabel = $localize`:@@lwConsoleNodes-keep:Keep`;

  constructor() {
    // Join tokens need infra rights (auditors only read nodes).
    effect(() => {
      if (this.mayOperate()) untracked(() => this.facade.loadJoinTokens());
    });
  }

  ngOnInit(): void {
    this.facade.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(true));
  }

  refresh(): void {
    this.facade.load();

    if (this.mayOperate()) this.facade.loadJoinTokens();
  }

  open(node: ConsoleNode): void {
    void this.router.navigate(['/nodes', node.name]);
  }

  openJoin(): void {
    this.site = this.sites()[0]?.site ?? '';
    this.description = '';
    this.witness = false;
    this.ttlMinutes = DEFAULT_TTL_MINUTES;
    this.labels = '';
    this.invalid.set(false);
    this.facade.clearCreatedJoinToken();
    this.joinOpen.set(true);
  }

  onJoinOpenChange(open: boolean): void {
    this.joinOpen.set(open);

    // The plaintext token is shown only while the dialog is open.
    if (!open) this.facade.clearCreatedJoinToken();
  }

  createToken(): void {
    const site = this.site.trim();
    const ttl = Number(this.ttlMinutes);

    if ((site && !RESOURCE_NAME_PATTERN.test(site)) || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MINUTES) {
      this.invalid.set(true);

      return;
    }

    this.invalid.set(false);

    const labels = parseLabels(this.labels);
    const request: CreateJoinTokenRequest = {
      ttlMinutes: ttl,
      witness: this.witness,
      ...(site ? { site } : {}),
      ...(this.description.trim() ? { description: this.description.trim() } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };

    this.facade.createJoinToken(request);
  }

  copy(text: string): void {
    void navigator.clipboard?.writeText(text);
  }

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revokeFor.set(null);
  }

  confirmRevoke(): void {
    const token = this.revokeFor();

    if (token) this.facade.revokeJoinToken(token.id);

    this.revokeFor.set(null);
  }
}
