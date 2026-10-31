import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleNodesFacade,
  NodesService,
  RESOURCE_NAME_PATTERN,
  type CreateJoinTokenRequest,
  type JoinToken,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcRunBulk,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { firstValueFrom } from 'rxjs';

import { joinCommand, mayJoinNodes, parseLabels } from '../nodes/node-format';
import { dlBulkSummary, dlCopyIdItem } from '../section/data-list';

const DEFAULT_TTL_MINUTES = 60;

/** Lifecycle of a join token as the list shows it. */
export type JoinTokenStatus = 'active' | 'used' | 'revoked' | 'expired';

export function joinTokenStatus(token: JoinToken, now: number = Date.now()): JoinTokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.usedAt) return 'used';

  return Date.parse(token.expiresAt) <= now ? 'expired' : 'active';
}

/** Tokens of a site (all when `site` is null), filtered by free text over prefix, site, description and labels. */
export function filterJoinTokens(tokens: readonly JoinToken[], site: string | null, query: string): JoinToken[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return tokens.filter((t) => {
    if (site !== null && t.site !== site) return false;

    const text = [
      t.tokenPrefix,
      t.site,
      t.description ?? '',
      t.usedByNode ?? '',
      ...Object.entries(t.labels ?? {}).map(([k, v]) => `${k}=${v}`),
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}
const MAX_TTL_MINUTES = 24 * 60;

/**
 * Join tokens in the Workspace (3.36): the token list with revoke (side panel) and the "Add a node" dialog with the
 * installer line, moved here from the nodes list. Infra operators and cluster admins; through the fleet only the
 * cluster-wide admin grant (the relay's rule); the installer line uses the cluster's own public URL, as natively.
 */
@Component({
  selector: 'loadweaver-workspace-join-tokens',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
  ],
  host: {
    '[class.d-flex]': 'showList()',
    '[class.flex-column]': 'showList()',
    '[class.flex-grow-1]': 'showList()',
    '[class.min-h-0]': 'showList()',
  },
  templateUrl: './workspace-join-tokens.component.html',
  standalone: true,
})
export class LoadweaverWorkspaceJoinTokensComponent {
  private readonly facade = inject(ConsoleNodesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly endpoints = inject(ConsoleEndpointService);

  /** Show the token list (Cluster / Site "Join tokens" tab); the dialog works without it. */
  readonly showList = input(false);
  /** The site whose tokens the list shows (null = all sites); also preset in the dialog. */
  readonly site = input<string | null>(null);
  /** Known sites, offered in the dialog. */
  readonly siteNames = input<readonly string[]>([]);

  private readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly tokens = toSignal(this.facade.tokens$, { initialValue: [] as JoinToken[] });
  readonly tokensError = toSignal(this.facade.tokensError$, { initialValue: null });
  readonly creatingToken = toSignal(this.facade.creatingToken$, { initialValue: false });
  readonly createdToken = toSignal(this.facade.createdToken$, { initialValue: null });
  readonly revokingToken = toSignal(this.facade.revokingToken$, { initialValue: null });
  readonly tokenError = toSignal(this.facade.tokenError$, { initialValue: null });

  readonly fleetMode = this.endpoints.fleetMode;
  readonly mayJoin = computed(() => mayJoinNodes(this.me()?.clusterRole, this.fleetMode));
  readonly sites = computed(() => this.siteNames().map((site) => ({ site })));
  readonly joinCommand = computed(() => {
    const token = this.createdToken();
    const scriptUrl = token ? this.facade.installScriptUrl() : null;

    return scriptUrl ? joinCommand(scriptUrl) : null;
  });

  readonly query = signal('');
  readonly rows = computed(() => filterJoinTokens(this.tokens(), this.site(), this.query()));

  readonly joinOpen = signal(false);
  readonly revokeFor = signal<JoinToken | null>(null);
  readonly invalid = signal(false);
  joinSite = '';
  description = '';
  witness = false;
  ttlMinutes = DEFAULT_TTL_MINUTES;
  labels = '';
  readonly maxTtl = MAX_TTL_MINUTES;

  readonly tokensTitle = $localize`:@@lwConsoleNodes-tokens:Join tokens`;
  readonly joinTitle = $localize`:@@lwConsoleNodes-joinTitle:Add a node`;
  readonly revokeLabel = $localize`:@@lwConsoleNodes-revoke:Revoke`;
  readonly revokeTitle = $localize`:@@lwConsoleNodes-revokeTitle:Revoke the join token?`;
  readonly revokeMessage = $localize`:@@lwConsoleNodes-revokeMessage:A node can no longer join with it.`;
  readonly revokeConfirm = $localize`:@@lwConsoleNodes-revokeConfirm:Revoke`;
  readonly keepLabel = $localize`:@@lwConsoleNodes-keep:Keep`;
  readonly searchLabel = $localize`:@@lwConsoleJoinTokens-search:Search join tokens`;
  private readonly statusLabels: Record<JoinTokenStatus, string> = {
    active: $localize`:@@lwConsoleJoinTokens-active:Active`,
    used: $localize`:@@lwConsoleJoinTokens-used:Used`,
    revoked: $localize`:@@lwConsoleJoinTokens-revoked:Revoked`,
    expired: $localize`:@@lwConsoleJoinTokens-expired:Expired`,
  };
  /** 3.38 D1: State · Token (prefix, the name people know it by) · site · description · expires. */
  readonly columns: FpcTableColumn<JoinToken>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleJoinTokens-status:Status`,
      type: 'state',
      state: (t) => ({ label: this.statusLabel(t), tone: this.badgeTone(t) }),
    },
    {
      id: 'token',
      label: $localize`:@@lwConsoleJoinTokens-token:Token`,
      value: (t) => t.tokenPrefix,
      required: true,
      priority: 1,
    },
    { id: 'site', label: $localize`:@@lwConsoleNodes-site:Site`, value: (t) => t.site, priority: 1 },
    {
      id: 'description',
      label: $localize`:@@lwConsoleNodes-description:Description`,
      value: (t) => t.description ?? '',
    },
    {
      id: 'labels',
      label: $localize`:@@lwConsoleJoinTokens-labels:Labels`,
      value: (t) =>
        Object.entries(t.labels ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(', '),
      hidden: true,
      mono: true,
    },
    { id: 'expires', label: $localize`:@@lwConsoleNodes-expires:Expires`, value: (t) => t.expiresAt },
    {
      id: 'created',
      label: $localize`:@@lwConsoleJoinTokens-created:Created`,
      value: (t) => t.createdAt,
      hidden: true,
    },
    {
      id: 'usedBy',
      label: $localize`:@@lwConsoleJoinTokens-usedBy:Joined node`,
      value: (t) => t.usedByNode ?? '',
      hidden: true,
    },
  ];

  private readonly injector = inject(Injector);
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkRevoke = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly revokeSelectedHint = $localize`:@@lwConsoleJoinTokens-revokeSelectedHint:Revoke the selected active join tokens`;
  readonly revokeSelectedTitle = $localize`:@@lwConsoleJoinTokens-revokeSelectedTitle:Revoke join tokens?`;
  readonly revokeSelectedMessage = computed(
    () =>
      $localize`:@@lwConsoleJoinTokens-revokeSelectedMessage:${this.selectedTokens().length}:count: selected join tokens will be revoked; no node can join with them any more.`,
  );
  private readonly selectedTokens = computed(() => {
    const ids = new Set(this.selected());

    return this.tokens().filter((t) => ids.has(t.id));
  });
  /** Only active tokens can be revoked; the server checks every token again. */
  readonly canRevokeSelection = computed(
    () => this.selectedTokens().length > 0 && this.selectedTokens().every((t) => joinTokenStatus(t) === 'active'),
  );
  readonly rowMenu = (token: JoinToken): FpcMenuItem[] => [
    ...(joinTokenStatus(token) === 'active'
      ? [{ id: 'revoke', label: this.revokeLabel, icon: 'trash', danger: true }]
      : []),
    dlCopyIdItem(),
  ];

  onRowAction(token: JoinToken, action: string): void {
    if (action === 'revoke') this.revokeFor.set(token);
    else if (action === 'copy-id') fpcCopyText(token.id);
  }

  /** Bulk Revoke: one call per token (same endpoint + authorization as the row action), per-token result. */
  async revokeSelected(): Promise<void> {
    const tokens = this.selectedTokens().filter((t) => joinTokenStatus(t) === 'active');

    if (tokens.length === 0) return;

    const service = this.injector.get(NodesService);
    const result = await fpcRunBulk(tokens, (token) => firstValueFrom(service.revokeJoinToken(token.id)));

    this.bulkResult.set(dlBulkSummary(result, (token) => `${token.tokenPrefix}…`));
    this.selected.set([]);
    this.reload();
  }

  tokenStatus(token: JoinToken): JoinTokenStatus {
    return joinTokenStatus(token);
  }

  statusLabel(token: JoinToken): string {
    return this.statusLabels[joinTokenStatus(token)];
  }

  /** Token state as a tone badge (3.38 R10): active / used / revoked / expired. */
  badgeTone(token: JoinToken): 'success' | 'neutral' | 'danger' | 'warning' {
    const status = joinTokenStatus(token);

    return status === 'active'
      ? 'success'
      : status === 'revoked'
        ? 'danger'
        : status === 'used'
          ? 'neutral'
          : 'warning';
  }

  reload(): void {
    if (this.mayJoin()) this.facade.loadJoinTokens();
  }

  constructor() {
    effect(() => {
      if (this.mayJoin()) untracked(() => this.facade.loadJoinTokens());
    });
    // Fleet mode: the installer line uses the cluster's own public URL (from its summary), like its own console.
    effect(() => {
      if (this.fleetMode && this.mayJoin())
        untracked(() =>
          this.injector
            .get(NodesService)
            .cluster()
            .subscribe({ error: () => undefined }),
        );
    });
  }

  /** Opens the "Add a node" dialog, for a site if given. */
  open(site: string | null = null): void {
    if (!this.mayJoin()) return;

    this.joinSite = site ?? this.siteNames()[0] ?? '';
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
    const site = this.joinSite.trim();
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
