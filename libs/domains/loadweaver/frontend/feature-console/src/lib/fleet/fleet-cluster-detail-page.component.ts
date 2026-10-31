import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  apiErrorMessage,
  backendMessageLabel,
  ConsoleFleetFacade,
  fleetAvailabilityOf,
  FLEET_ROLES,
  FleetService,
  isFleetClusterId,
  type FleetCard,
  type FleetCloudStatus,
  type FleetCluster,
  type FleetGrant,
  type FleetOperation,
  type FleetSigningKey,
  type FleetIdentity,
  type FleetTrustAttempt,
  type HealthState,
  type FleetRole,
  type FleetUser,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDatePipe,
  fpcFormatDateTime,
  fpcRunBulk,
  type FpcMenuItem,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueDirective,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSectionRowComponent,
  FpcStatusBadgeComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filter, firstValueFrom, map, take } from 'rxjs';

import { isGlobalAdmin } from '../guards/global-admin.guard';
import { healthLabel } from '../overview/console-format';
import { dlBulkSummary } from '../section/data-list';
import {
  FLEET_OPERATION_TONE,
  fleetConnectionIcon,
  fleetConnectionLabel,
  fleetConnectionTone,
  fleetKeyStateLabel,
  fleetTrustOutcomeLabel,
  fleetTrustView,
  fleetOperationProgress,
  fleetOperationStatusLabel,
  fleetRoleLabel,
  fleetStepLabel,
  fleetStepTone,
} from './fleet-format';
import { LoadweaverLaneComponent } from '../section/lane.component';

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * One fleet cluster (3.24): the connection and its health, the Loadweaver Cloud teardown / read-only grace and the
 * final backup (fleet admins), and the grants (fleet admins): per user, cluster-wide or one project, viewer /
 * operator / admin.
 */
@Component({
  selector: 'loadweaver-fleet-cluster-detail-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcStatusBadgeComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './fleet-cluster-detail-page.component.html',
  standalone: true,
})
export class LoadweaverFleetClusterDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly service = inject(FleetService);
  private readonly auth = inject(AuthenticationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  /** Phone lane switch (3.37): Connection | Fleet identity | Grants (admins). */
  readonly lane = signal<'connection' | 'identity' | 'grants'>('connection');
  readonly connectionTitle = $localize`:@@lwConsoleFleetCluster-connection:Connection`;
  readonly identityTitle = $localize`:@@lwConsoleFleetCluster-identity:Fleet identity`;
  readonly grantsTitle = $localize`:@@lwConsoleFleetCluster-grants:Grants`;
  readonly clusterId = signal<string>('');
  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly clustersLoaded = toSignal(this.facade.clustersLoaded$, { initialValue: false });
  readonly clustersError = toSignal(this.facade.clustersError$, { initialValue: null });
  readonly grants = toSignal(this.facade.grants$, { initialValue: [] as FleetGrant[] });
  readonly grantsLoading = toSignal(this.facade.grantsLoading$, { initialValue: false });
  readonly grantsError = toSignal(this.facade.grantsError$, { initialValue: null });
  readonly grantSaving = toSignal(this.facade.grantSaving$, { initialValue: false });
  readonly grantError = toSignal(this.facade.grantError$, { initialValue: null });
  readonly cloudStatus = toSignal(this.facade.cloudStatus$, { initialValue: {} as Record<string, FleetCloudStatus> });
  readonly cloudErrors = toSignal(this.facade.cloudErrors$, { initialValue: {} as Record<string, string> });
  readonly polling = toSignal(this.facade.polling$, { initialValue: [] as string[] });
  readonly admin = toSignal(isGlobalAdmin(this.auth), { initialValue: false });

  readonly cluster = computed(() => this.clusters().find((c) => c.id === this.clusterId()) ?? null);
  /** The cluster's overview card (its own health headline), once the fleet overview is loaded. */
  readonly cards = toSignal(this.facade.cards$, { initialValue: [] as FleetCard[] });
  readonly card = computed(() => this.cards().find((c) => c.id === this.clusterId()) ?? null);
  readonly cloud = computed(() => {
    const reference = this.cluster()?.reference;

    return reference ? (this.cloudStatus()[reference] ?? null) : null;
  });
  readonly cloudError = computed(() => {
    const reference = this.cluster()?.reference;

    return reference ? (this.cloudErrors()[reference] ?? null) : null;
  });

  /**
   * The fleet's signing identity (3.24, fleet admins): issuer and public keys the clusters hold under "trusted
   * fleets" (registered by the fleet itself, 2026-10-29), and the key rotation.
   */
  readonly identity = signal<FleetIdentity | null>(null);
  readonly identityError = signal<string | null>(null);
  readonly identityBusy = signal(false);
  readonly keyStateLabel = fleetKeyStateLabel;
  readonly messageLabel = backendMessageLabel;
  readonly copyIssuerLabel = $localize`:@@lwConsoleFleetCluster-copyIssuer:Copy issuer id`;
  readonly trustOutcomeLabel = fleetTrustOutcomeLabel;

  /**
   * Trust with this cluster (2026-10-29): one state from the cluster's health record (the identity probe decides;
   * the last attempt is a past event under it), see {@link fleetTrustView}.
   */
  readonly trust = computed(() => fleetTrustView(this.cluster()?.health, this.trustBusy()));

  /**
   * Establish trust (2026-10-29, fleet admins; modal): with the connection's credential, or a cluster admin's
   * one-time token that is sent once and forgotten (never kept in a signal after the call).
   */
  readonly trustOpen = signal(false);
  readonly trustBusy = signal(false);
  readonly trustError = signal<string | null>(null);
  /** The last result shown in the connection lane (dismissible). */
  readonly trustResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  trustToken = '';
  readonly trustTitle = $localize`:@@lwConsoleFleetCluster-trustTitle:Establish trust`;
  readonly trustActionLabel = $localize`:@@lwConsoleFleetCluster-trustAction:Establish trust…`;

  /** Known fleet users by id (emails in the grant list); empty when the user API isn't available. */
  readonly users = signal<Record<string, string>>({});

  readonly grantOpen = signal(false);
  readonly revoking = signal<FleetGrant | null>(null);
  readonly grantFormError = signal<string | null>(null);
  readonly userResults = signal<FleetUser[]>([]);
  readonly userSearchError = signal<string | null>(null);
  readonly searching = signal(false);
  userQuery = '';
  grantUserId = '';
  grantProject = '';
  grantRole: FleetRole = 'viewer';

  readonly roles = FLEET_ROLES;
  readonly roleLabel = fleetRoleLabel;
  /** Unreachable / read-only (3.43). */
  readonly availabilityOf = fleetAvailabilityOf;
  readonly connectionTone = fleetConnectionTone;
  readonly connectionIcon = fleetConnectionIcon;
  readonly connectionLabel = fleetConnectionLabel;
  readonly operationBadgeTone = FLEET_OPERATION_TONE;
  readonly operationStatusLabel = fleetOperationStatusLabel;
  readonly operationProgress = fleetOperationProgress;
  readonly stepBadgeTone = fleetStepTone;

  readonly backLabel = $localize`:@@lwConsoleFleetCluster-back:Back to the clusters`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetCluster-refresh:Refresh`;
  readonly grantTitle = $localize`:@@lwConsoleFleetCluster-grantTitle:Grant access`;
  readonly revokeTitle = $localize`:@@lwConsoleFleetCluster-revokeTitle:Remove the grant?`;
  readonly revokeMessage = $localize`:@@lwConsoleFleetCluster-revokeMessage:The user loses this access to the cluster through the fleet.`;
  readonly revokeConfirm = $localize`:@@lwConsoleFleetCluster-revokeConfirm:Remove`;
  readonly cancelLabel = $localize`:@@lwConsoleFleetCluster-cancel:Cancel`;
  readonly titleFallback = $localize`:@@lwConsoleFleetCluster-title:Cluster`;
  readonly cloudTitle = $localize`:@@lwConsoleFleetCluster-cloud:Loadweaver Cloud`;
  readonly finalBackupTitle = $localize`:@@lwConsoleFleetCluster-finalBackup:Final backup`;
  readonly userSearchLabel = $localize`:@@lwConsoleFleetCluster-userSearch:Search users`;
  readonly loadingLabel = $localize`:@@lwConsoleFleetCluster-loading:Loading the cluster`;
  readonly identityLoadingLabel = $localize`:@@lwConsoleFleetCluster-identityLoading:Loading the fleet identity`;

  /** The connection facts (3.38: `fpc-key-value-list`; health, access and approvals are rich values). */
  readonly connectionFacts = computed<FpcKeyValueItem[]>(() => {
    const c = this.cluster();

    if (!c) return [];

    const yes = $localize`:@@lwConsoleFleetCluster-yes:yes`;
    const no = $localize`:@@lwConsoleFleetCluster-no:no`;

    return [
      { key: 'connection', label: $localize`:@@lwConsoleFleetCluster-connectionFact:Connection` },
      ...(this.card()?.health ? [{ key: 'health', label: $localize`:@@lwConsoleFleetCluster-health:Health` }] : []),
      {
        key: 'version',
        label: $localize`:@@lwConsoleFleetCluster-version:Version`,
        value: c.health.version,
        mono: true,
      },
      { key: 'endpoint', label: $localize`:@@lwConsoleFleetCluster-endpoint:Endpoint`, value: c.endpoint, mono: true },
      {
        key: 'credential',
        label: $localize`:@@lwConsoleFleetCluster-credential:Service credential`,
        value: `…${c.credentialHint}`,
        mono: true,
      },
      { key: 'ca', label: $localize`:@@lwConsoleFleetCluster-customCa:Custom CA`, value: c.hasCustomCa ? yes : no },
      { key: 'access', label: $localize`:@@lwConsoleFleetCluster-access:Your access` },
      ...this.trustFacts(),
      ...(c.description
        ? [
            {
              key: 'description',
              label: $localize`:@@lwConsoleFleetCluster-description:Description`,
              value: c.description,
            },
          ]
        : []),
    ];
  });

  /** Loadweaver Cloud facts; the grace rule is the state's hint while the cluster is in teardown. */
  readonly cloudFacts = computed<FpcKeyValueItem[]>(() => {
    const c = this.cluster();

    if (!c?.reference) return [];

    return [
      {
        key: 'reference',
        label: $localize`:@@lwConsoleFleetCluster-reference:Reference`,
        value: c.reference,
        mono: true,
      },
      {
        key: 'state',
        label: $localize`:@@lwConsoleFleetCluster-state:State`,
        hint:
          c.state === 'teardown'
            ? $localize`:@@lwConsoleFleetCluster-graceHint:During the grace period every grant on this cluster is capped at viewer: reads, exports and catalog downloads work through the fleet, changes and terminals don't.`
            : null,
      },
    ];
  });

  /** 3.38 D1: User · scope · role · since; ⋮ edit / remove; bulk Remove. */
  readonly grantColumns: FpcTableColumn<FleetGrant>[] = [
    {
      id: 'user',
      label: $localize`:@@lwConsoleFleetCluster-colUser:User`,
      value: (g) => this.userLabel(g.userId),
      required: true,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleFleetCluster-colScope:Scope`,
      value: (g) => g.project ?? '',
      priority: 2,
    },
    {
      id: 'role',
      label: $localize`:@@lwConsoleFleetCluster-colRole:Role`,
      value: (g) => fleetRoleLabel(g.role),
      priority: 1,
    },
    {
      id: 'since',
      label: $localize`:@@lwConsoleFleetCluster-colSince:Since`,
      value: (g) => g.createdAt,
      priority: 2,
    },
  ];
  readonly grantMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.editGrantLabel, icon: 'pencil' },
    { id: 'remove', label: this.removeGrantLabel, icon: 'trash', danger: true },
  ];
  readonly editGrantLabel = $localize`:@@lwConsoleFleetCluster-editGrant:Edit grant`;
  readonly removeGrantLabel = $localize`:@@lwConsoleFleetCluster-removeGrant:Remove grant`;
  readonly selectedGrants = signal<readonly string[]>([]);
  readonly confirmBulkRevoke = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkRevokeTitle = $localize`:@@lwConsoleFleetCluster-bulkRevokeTitle:Remove the grants?`;
  readonly bulkRevokeMessage = computed(
    () =>
      $localize`:@@lwConsoleFleetCluster-bulkRevokeMessage:${this.selectedGrants().length}:count: selected grants are removed; those users lose their access to this cluster through the fleet.`,
  );

  /** Signing keys (3.38 D1): State · Key · fingerprint · created; the public key in the row detail; Activate inline. */
  readonly keyColumns: FpcTableColumn<FleetSigningKey>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleFleetCluster-colKeyState:State`,
      type: 'state',
      state: (k) => ({
        label: fleetKeyStateLabel(k.state),
        tone: k.state === 'active' ? 'success' : 'info',
        icon: k.state === 'active' ? 'key-fill' : 'hourglass-split',
      }),
    },
    {
      id: 'kid',
      label: $localize`:@@lwConsoleFleetCluster-colKey:Key`,
      value: (k) => this.keyTitle(k),
      required: true,
      priority: 1,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleFleetCluster-colCreated:Created`,
      value: (k) => k.createdAt,
      // Also on the stacked card (its own line, not joined into the key's title).
      priority: 1,
    },
  ];
  readonly keyId = (k: FleetSigningKey) => k.kid;
  readonly liveKeys = computed(() => (this.identity()?.keys ?? []).filter((k) => k.state !== 'retired'));
  readonly expandedKey = signal<string | null>(null);
  readonly keyInline = (k: FleetSigningKey): FpcMenuItem[] =>
    k.state === 'next'
      ? [{ id: 'activate', label: this.activateLabel, icon: 'check2-circle', disabled: this.identityBusy() }]
      : [];
  /** Key id, fingerprint and public key via ⋮ (D11, LW-13): copied, not shown as the row's text. */
  readonly keyMenu = (): FpcMenuItem[] => [
    { id: 'copy-id', label: $localize`:@@lwConsoleFleetCluster-copyKeyId:Copy key ID`, icon: 'clipboard' },
    {
      id: 'copy-fingerprint',
      label: $localize`:@@lwConsoleFleetCluster-copyFingerprint:Copy fingerprint`,
      icon: 'fingerprint',
    },
    {
      id: 'copy-public-key',
      label: $localize`:@@lwConsoleFleetCluster-copyPublicKey:Copy public key`,
      icon: 'key',
    },
  ];
  readonly activateLabel = $localize`:@@lwConsoleFleetCluster-identityActivate:Activate`;
  readonly keysTitle = $localize`:@@lwConsoleFleetCluster-keys:Signing keys`;

  /** The final backup's steps (nested, decision 2): State · Step · error. */
  readonly stepColumns: FpcTableColumn<FleetOperation['steps'][number]>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleFleetCluster-colStepState:State`,
      type: 'state',
      state: (step) => ({ label: fleetOperationStatusLabel(step.status), tone: fleetStepTone(step.status) }),
    },
    {
      id: 'step',
      label: $localize`:@@lwConsoleFleetCluster-colStep:Step`,
      value: (step) => fleetStepLabel(step.key),
      required: true,
      priority: 1,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsoleFleetCluster-colError:Error`,
      value: (step) => step.error ?? '',
      priority: 1,
    },
  ];
  readonly stepId = (step: FleetOperation['steps'][number]) => step.key;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.clusterId.set(params.get('id') ?? '');
      this.refresh();
    });
    this.facade.grantSaved$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.grantOpen.set(false));
    // The cluster's own health headline comes with the overview cards (loaded once if the overview wasn't open).
    if (this.cards().length === 0) this.facade.loadOverview();
    // Grants, Cloud status and user emails are for fleet admins.
    isGlobalAdmin(this.auth)
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.loadAdminData();
        this.service
          .users('', 100)
          .pipe(map((users) => Object.fromEntries(users.map((u) => [u.id, u.email]))))
          .subscribe({ next: (byId) => this.users.set(byId), error: () => undefined });
      });
  }

  refresh(): void {
    this.facade.loadClusters();

    if (this.admin()) this.loadAdminData();
  }

  private loadAdminData(): void {
    const id = this.clusterId();

    if (!isFleetClusterId(id)) return;

    this.facade.loadGrants(id);
    this.loadIdentity();
    // The reference is known once the clusters are loaded.
    this.facade.clusters$
      .pipe(
        map((clusters) => clusters.find((c) => c.id === id)?.reference ?? null),
        filter((reference): reference is string => !!reference),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((reference) => this.facade.loadCloudStatus(reference));
  }

  loadIdentity(): void {
    this.identityError.set(null);
    this.service.identity().subscribe({
      next: (identity) => this.identity.set(identity),
      error: (error: unknown) => this.identityError.set(apiErrorMessage(error, 'Failed to load the fleet identity')),
    });
  }

  openTrust(): void {
    this.trustToken = '';
    this.trustError.set(null);
    this.trustOpen.set(true);
  }

  onTrustOpenChange(open: boolean): void {
    this.trustOpen.set(open);

    // The token never outlives the dialog.
    if (!open) this.trustToken = '';
  }

  /**
   * Whether "Establish trust…" is offered: fleet admins, a working connection, a state registering can change (not
   * while it is trusted, pending, or the connection's credential can't carry identities anyway).
   */
  canEstablishTrust(c: FleetCluster): boolean {
    return (
      this.admin() &&
      c.state !== 'retired' &&
      this.trust().establishable &&
      (c.health.state === 'healthy' || c.health.state === 'degraded')
    );
  }

  /** Trust as key-value rows (2026-10-29): Trust, Trusted since, Last attempt (outcome + time), By. */
  private trustFacts(): FpcKeyValueItem[] {
    const view = this.trust();
    const facts: FpcKeyValueItem[] = [{ key: 'trust', label: $localize`:@@lwConsoleFleetCluster-trust:Trust` }];

    if (view.since)
      facts.push({
        key: 'trustSince',
        label: $localize`:@@lwConsoleFleetCluster-trustSince:Trusted since`,
        value: fpcFormatDateTime(view.since, this.locale),
      });

    if (view.attempt)
      facts.push(
        { key: 'trustAttempt', label: $localize`:@@lwConsoleFleetCluster-trustAttempt:Last attempt` },
        { key: 'trustAttemptBy', label: $localize`:@@lwConsoleFleetCluster-trustAttemptBy:Attempted by` },
      );

    return facts;
  }

  establishTrust(): void {
    const id = this.clusterId();
    const token = this.trustToken.trim();

    // Sent once; the field is cleared right away, whatever the outcome.
    this.trustToken = '';

    if (!isFleetClusterId(id)) return;

    this.trustBusy.set(true);
    this.trustError.set(null);
    this.service.establishTrust(id, token || undefined).subscribe({
      next: ({ attempt }) => {
        this.trustBusy.set(false);
        this.facade.loadClusters();

        if (attempt.state === 'established' || attempt.state === 'already-trusted') {
          this.trustOpen.set(false);
          this.trustResult.set({ tone: 'success', message: this.trustOutcomeLabel(attempt.state) ?? '' });
        } else {
          this.trustError.set(this.attemptMessage(attempt));
        }
      },
      error: (error: unknown) => {
        this.trustBusy.set(false);
        this.trustError.set(apiErrorMessage(error, 'Failed to establish trust'));
      },
    });
  }

  private attemptMessage(attempt: FleetTrustAttempt): string {
    const label = this.trustOutcomeLabel(attempt.state) ?? '';

    return attempt.reason ? `${label}. ${this.messageLabel(attempt.reason)}` : label;
  }

  /** Rotation, step 1: a next key to register in every cluster before it is activated. */
  createNextKey(): void {
    this.changeIdentity(this.service.createNextIdentityKey());
  }

  /** Rotation, step 2: the next key signs from now on (register it in the clusters first). */
  activateKey(kid: string): void {
    this.changeIdentity(this.service.activateIdentityKey(kid));
  }

  private changeIdentity(request: ReturnType<FleetService['identity']>): void {
    this.identityBusy.set(true);
    this.identityError.set(null);
    request.subscribe({
      next: (identity) => {
        this.identity.set(identity);
        this.identityBusy.set(false);
      },
      error: (error: unknown) => {
        this.identityError.set(apiErrorMessage(error, 'Failed to change the fleet identity'));
        this.identityBusy.set(false);
      },
    });
  }

  title(): string {
    return this.cluster()?.name ?? this.titleFallback;
  }

  poll(): void {
    if (this.cluster()) this.facade.pollCluster(this.clusterId());
  }

  open(): void {
    this.facade.openCluster(this.clusterId());
  }

  userLabel(userId: string): string {
    return this.users()[userId] ?? userId;
  }

  openGrant(grant?: FleetGrant): void {
    this.grantUserId = grant?.userId ?? '';
    this.grantProject = grant?.project ?? '';
    this.grantRole = grant?.role ?? 'viewer';
    this.userQuery = grant ? this.userLabel(grant.userId) : '';
    this.userResults.set([]);
    this.userSearchError.set(null);
    this.grantFormError.set(null);
    this.grantOpen.set(true);
  }

  searchUsers(): void {
    this.searching.set(true);
    this.userSearchError.set(null);
    this.service.users(this.userQuery).subscribe({
      next: (users) => {
        this.searching.set(false);
        this.userResults.set(users);

        if (users.length === 1) this.grantUserId = users[0].id;
      },
      error: (error: unknown) => {
        this.searching.set(false);
        this.userResults.set([]);
        this.userSearchError.set(
          `${$localize`:@@lwConsoleFleetCluster-userSearchFailed:The user search is not available; enter the user id.`} (${apiErrorMessage(error, '')})`,
        );
      },
    });
  }

  saveGrant(): void {
    this.grantFormError.set(null);

    const userId = this.grantUserId.trim();
    const project = this.grantProject.trim();

    if (!isFleetClusterId(userId)) {
      this.grantFormError.set($localize`:@@lwConsoleFleetCluster-userRequired:Choose a user (or enter the user id).`);

      return;
    }

    if (project && !PROJECT.test(project)) {
      this.grantFormError.set(
        $localize`:@@lwConsoleFleetCluster-projectInvalid:Project: a project name of the cluster.`,
      );

      return;
    }

    this.facade.putGrant(this.clusterId(), { userId, role: this.grantRole, ...(project ? { project } : {}) });
  }

  onGrantAction(grant: FleetGrant, action: string): void {
    if (action === 'edit') this.openGrant(grant);
    else if (action === 'remove') this.askRevoke(grant);
  }

  onKeyAction(key: FleetSigningKey, action: string): void {
    if (action === 'activate') this.activateKey(key.kid);
    else if (action === 'copy-id') fpcCopyText(key.kid);
    else if (action === 'copy-fingerprint') fpcCopyText(key.fingerprint);
    else if (action === 'copy-public-key') fpcCopyText(key.publicKey);
  }

  copyText(text: string): void {
    fpcCopyText(text);
  }

  /** A signing key as people read it: its role ("Active key"); when it was made is the Created column (2026-10-29). */
  keyTitle(key: FleetSigningKey): string {
    return key.state === 'active'
      ? $localize`:@@lwConsoleFleetCluster-keyTitleActive:Active key`
      : key.state === 'next'
        ? $localize`:@@lwConsoleFleetCluster-keyTitleNext:Next key`
        : $localize`:@@lwConsoleFleetCluster-keyTitleRetired:Retired key`;
  }

  /** The cluster's health headline in the overview's words (Healthy / Degraded / At risk / Failed). */
  healthText(state: string): string {
    return ['healthy', 'degraded', 'at-risk', 'failed', 'unknown'].includes(state)
      ? healthLabel(state as HealthState)
      : state;
  }

  healthTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
    return state === 'healthy'
      ? 'success'
      : state === 'degraded' || state === 'at-risk'
        ? 'warning'
        : state === 'failed'
          ? 'danger'
          : 'neutral';
  }

  toggleKey(key: FleetSigningKey): void {
    this.expandedKey.update((kid) => (kid === key.kid ? null : key.kid));
  }

  /** Bulk Remove: one call per grant (same endpoint + authorization as the row action), per-grant result. */
  async revokeSelected(): Promise<void> {
    const ids = new Set(this.selectedGrants());
    const grants = this.grants().filter((g) => ids.has(g.id));

    if (grants.length === 0) return;

    const result = await fpcRunBulk(grants, (g) => firstValueFrom(this.service.deleteGrant(g.clusterId, g.id)));

    this.bulkResult.set(dlBulkSummary(result, (g) => `${this.userLabel(g.userId)} (${fleetRoleLabel(g.role)})`));
    this.selectedGrants.set([]);
    this.refresh();
  }

  askRevoke(grant: FleetGrant): void {
    this.revoking.set(grant);
  }

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revoking.set(null);
  }

  confirmRevoke(): void {
    const grant = this.revoking();

    if (grant) this.facade.deleteGrant(this.clusterId(), grant.id);

    this.revoking.set(null);
  }
}
