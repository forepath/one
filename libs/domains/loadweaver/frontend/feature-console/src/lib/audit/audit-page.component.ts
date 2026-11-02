import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleAuditFacade,
  ConsoleAuditService,
  type AuditEntry,
  type AuditExportFormat,
  type AuditFilter,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcDatePipe,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  fpcCopyText,
  FpcListToolbarComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
} from '@forepath/shared/frontend/ui-components';

import { saveFile } from '../live/live-format';
import { DL_API_KEY, dlUserLabel } from '../section/data-list';
import { isoToLocalInput, localInputToIso } from '../logs/logs-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** An audit actor type, readable (3.38 D9; unknown ones as they are). */
export function auditActorTypeLabel(type: string): string {
  switch (type) {
    case 'user':
      return $localize`:@@lwConsoleAudit-actorUser:User`;
    case 'service':
      return $localize`:@@lwConsoleAudit-actorService:Service`;
    case 'system':
      return $localize`:@@lwConsoleAudit-actorSystem:System`;
    case 'node':
      return $localize`:@@lwConsoleAudit-actorNode:Node`;
    case 'token':
      return $localize`:@@lwConsoleAudit-actorToken:API token`;
    case 'api-key':
      return DL_API_KEY;
    default:
      return type;
  }
}

/** The subject of an audit action (`plan.apply` → "Plan"), translated for the common ones. */
function auditSubjectLabel(subject: string): string {
  switch (subject) {
    case 'plan':
      return $localize`:@@lwConsoleAudit-subjectPlan:Plan`;
    case 'draft':
      return $localize`:@@lwConsoleAudit-subjectDraft:Draft`;
    case 'node':
      return $localize`:@@lwConsoleAudit-subjectNode:Node`;
    case 'backup':
      return $localize`:@@lwConsoleAudit-subjectBackup:Backup`;
    case 'git':
      return $localize`:@@lwConsoleAudit-subjectGit:Git`;
    case 'update':
      return $localize`:@@lwConsoleAudit-subjectUpdate:Update`;
    case 'cluster':
      return $localize`:@@lwConsoleAudit-subjectCluster:Cluster`;
    case 'project':
      return $localize`:@@lwConsoleAudit-subjectProject:Project`;
    case 'vm':
      return $localize`:@@lwConsoleAudit-subjectVm:Virtual machine`;
    case 'workload':
      return $localize`:@@lwConsoleAudit-subjectWorkload:Workload`;
    case 'certificate':
      return $localize`:@@lwConsoleAudit-subjectCertificate:Certificate`;
    case 'alert':
      return $localize`:@@lwConsoleAudit-subjectAlert:Alert`;
    default:
      return humanizeAuditWords(subject, true);
  }
}

function humanizeAuditWords(text: string, capital = false): string {
  const words = text.replace(/[-_.]+/g, ' ').trim();

  return capital && words ? words[0].toUpperCase() + words.slice(1) : words;
}

/**
 * An audit action as people read it (D7, LW-05): `update.bundle-refused` → "Update: bundle refused" (the key stays in
 * the tooltip, the filters and the export).
 */
export function auditActionLabel(action: string): string {
  const dot = action.indexOf('.');

  if (dot < 0) return humanizeAuditWords(action, true);

  return `${auditSubjectLabel(action.slice(0, dot))}: ${humanizeAuditWords(action.slice(dot + 1))}`;
}

/**
 * Who acted, readable (D11): a user by the email the API resolved ("Deleted user" when gone), other actors by
 * type and name (node, API key, system).
 */
export function auditActorLabel(entry: Pick<AuditEntry, 'actorType' | 'actorId' | 'actorEmail'>): string {
  if (entry.actorType === 'user') {
    const who = dlUserLabel(entry.actorId, entry.actorEmail);

    return `${auditActorTypeLabel(entry.actorType)}${who ? ' ' + who : ''}`;
  }

  // Components / nodes by name in words, not as a second raw key ("System (update policy)").
  const who = entry.actorId ? humanizeAuditWords(entry.actorId) : '';

  return `${auditActorTypeLabel(entry.actorType)}${who ? ` (${who})` : ''}`;
}

/** The value "Only this actor" narrows to: the user's email when known (the API matches it), else the id. */
export function auditActorFilterValue(entry: Pick<AuditEntry, 'actorType' | 'actorId' | 'actorEmail'>): string | null {
  return (entry.actorType === 'user' && entry.actorEmail) || entry.actorId;
}

/** Text filters in the URL and the form. */
export const AUDIT_TEXT_FILTERS = ['project', 'action', 'actor', 'target', 'text'] as const;

type AuditTextFilter = (typeof AUDIT_TEXT_FILTERS)[number];

const PAGE_SIZES = [25, 50, 100];

/**
 * The audit log (3.18): search by actor, action (exact or `prefix*`), target prefix, project, time and full text;
 * newest first, paged by sequence number; entry details; CSV / NDJSON export; for auditors and cluster admins the
 * hash chain's verification. Project admins see their projects' entries (the API scopes it). Filters live in the URL.
 */
@Component({
  selector: 'loadweaver-audit-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDatePipe,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcListToolbarComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
  ],
  // Fills the routed outlet: the table scrolls, not the page (3.38: no panel inside a scrolling page).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './audit-page.component.html',
  standalone: true,
})
export class LoadweaverAuditPageComponent implements OnInit {
  private readonly facade = inject(ConsoleAuditFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(ConsoleAuditService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly entries = toSignal(this.facade.entries$, { initialValue: [] as AuditEntry[] });
  readonly page = toSignal(this.facade.page$, { initialValue: 0 });
  readonly hasNext = toSignal(this.facade.hasNext$, { initialValue: false });
  readonly hasPrevious = toSignal(this.facade.hasPrevious$, { initialValue: false });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly verification = toSignal(this.facade.verification$, { initialValue: null });
  readonly verifiedAt = toSignal(this.facade.verifiedAt$, { initialValue: null });
  readonly verifying = toSignal(this.facade.verifying$, { initialValue: false });
  readonly verifyError = toSignal(this.facade.verifyError$, { initialValue: null });
  readonly clusterRole = toSignal(this.access.clusterRole$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly fromInput = signal('');
  readonly toInput = signal('');
  readonly filters = signal<Record<AuditTextFilter, string>>({
    project: '',
    action: '',
    actor: '',
    target: '',
    text: '',
  });
  readonly limit = signal(25);
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding(
    { fromInput: this.fromInput, toInput: this.toInput, filters: this.filters, limit: this.limit },
    () => this.search(),
  );
  readonly expanded = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly applied = signal<AuditFilter | null>(null);
  readonly filtersOpen = signal(false);

  /** Applied drawer filters (3.38 R12: the count follows Apply; the lead full-text search is not counted). */
  readonly activeFilterCount = computed(() => {
    const applied = this.applied() ?? {};

    return (
      AUDIT_TEXT_FILTERS.filter((name) => name !== 'text' && applied[name]).length +
      (applied.from ? 1 : 0) +
      (applied.to ? 1 : 0)
    );
  });
  private textTimer: ReturnType<typeof setTimeout> | null = null;

  /** The chain's verification: auditors and cluster admins. */
  readonly canVerify = computed(() => this.clusterRole() === 'cluster-admin' || this.clusterRole() === 'auditor');

  readonly pageSizes = PAGE_SIZES;

  readonly title = $localize`:@@lwConsoleAudit-title:Audit log`;
  readonly loadingLabel = $localize`:@@lwConsoleAudit-loading:Loading audit entries`;
  /** Columns of the audit table (3.38: `fpc-data-table`; server order, newest first, no client sort). */
  readonly columns: FpcTableColumn<AuditEntry>[] = [
    { id: 'at', label: $localize`:@@lwConsoleAudit-colTime:Time`, value: (e) => e.at, sortable: false, required: true },
    {
      id: 'action',
      label: $localize`:@@lwConsoleAudit-colAction:Action`,
      value: (e) => auditActionLabel(e.action),
      sortable: false,
    },
    {
      id: 'target',
      label: $localize`:@@lwConsoleAudit-colTarget:Target`,
      value: (e) => e.target,
      sortable: false,
      mono: true,
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleAudit-colProject:Project`,
      value: (e) => e.project ?? '',
      sortable: false,
    },
    {
      id: 'actor',
      label: $localize`:@@lwConsoleAudit-colActor:Actor`,
      value: (e) => auditActorLabel(e),
      sortable: false,
    },
  ];
  readonly rowId = (entry: AuditEntry) => String(entry.seq);
  readonly searchLabel = $localize`:@@lwConsoleAudit-search:Search audit events`;
  readonly fromLabel = $localize`:@@lwConsoleAudit-from:From`;
  readonly toLabel = $localize`:@@lwConsoleAudit-to:To`;
  readonly newerLabel = $localize`:@@lwConsoleAudit-newer:Newer`;
  readonly olderLabel = $localize`:@@lwConsoleAudit-older:Older`;
  readonly pageSizeLabel = $localize`:@@lwConsoleAudit-pageSize:Entries per page`;
  readonly verifyLabel = $localize`:@@lwConsoleAudit-verify:Verify chain`;
  readonly pageLabel = $localize`:@@lwConsoleAudit-page:Page`;
  readonly actionLabel = $localize`:@@lwConsoleAudit-actionLabel:Action`;
  readonly actionText = auditActionLabel;
  readonly exportLabel = $localize`:@@lwConsoleAudit-export:Export`;
  readonly exportCsvLabel = $localize`:@@lwConsoleAudit-exportCsv:Export CSV`;
  readonly exportNdjsonLabel = $localize`:@@lwConsoleAudit-exportNdjson:Export NDJSON`;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const filters = { ...this.filters() };

    for (const name of AUDIT_TEXT_FILTERS) filters[name] = params.get(name) ?? '';

    this.filters.set(filters);
    this.fromInput.set(isoToLocalInput(params.get('from')));
    this.toInput.set(isoToLocalInput(params.get('to')));
    this.search();
  }

  placeholder(name: AuditTextFilter): string {
    switch (name) {
      case 'project':
        return $localize`:@@lwConsoleAudit-project:Project`;
      case 'action':
        return $localize`:@@lwConsoleAudit-action:Action (e.g. terminal.* or plan.apply)`;
      case 'actor':
        return $localize`:@@lwConsoleAudit-actor:Actor (email or id)`;
      case 'target':
        return $localize`:@@lwConsoleAudit-target:Target prefix`;
      default:
        return this.searchLabel;
    }
  }

  /** The lead search is live (debounced server search); the drawer fields wait for Apply. */
  onTextChange(value: string): void {
    this.setFilter('text', value);

    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      this.search();
    }, 300);
  }

  setFilter(name: AuditTextFilter, value: string): void {
    this.filters.set({ ...this.filters(), [name]: value });
  }

  filter(): AuditFilter {
    const filter: AuditFilter = {};
    const from = localInputToIso(this.fromInput());
    const to = localInputToIso(this.toInput());

    if (from) filter.from = from;

    if (to) filter.to = to;

    for (const name of AUDIT_TEXT_FILTERS) {
      const value = this.filters()[name].trim();

      if (value) filter[name] = value;
    }

    return filter;
  }

  search(): void {
    const filter = this.filter();

    this.applied.set(filter);
    this.expanded.set(null);
    this.facade.search(filter, this.limit());
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        from: filter.from ?? null,
        to: filter.to ?? null,
        ...Object.fromEntries(AUDIT_TEXT_FILTERS.map((name) => [name, filter[name] ?? null])),
      },
    });
  }

  reset(): void {
    this.filters.set({ project: '', action: '', actor: '', target: '', text: '' });
    this.fromInput.set('');
    this.toInput.set('');
    this.search();
  }

  onLimitChange(limit: number | string): void {
    this.limit.set(Number(limit));
    this.search();
  }

  /** Server paging (cursor by sequence number): one page newer / older; back to page 1 starts over. */
  onPage(page: number): void {
    const current = this.page() + 1;

    if (page === current) return;

    if (page === 1 && current > 2) this.search();
    else if (page > current) this.older();
    else this.newer();
  }

  readonly rowMenu = (entry: AuditEntry): FpcMenuItem[] => [
    { id: 'details', label: this.detailsLabel, icon: 'chevron-expand' },
    { id: 'only-action', label: this.onlyActionLabel, icon: 'funnel', dividerBefore: true },
    { id: 'only-target', label: this.onlyTargetLabel, icon: 'funnel' },
    ...(entry.actorId ? [{ id: 'only-actor', label: this.onlyActorLabel, icon: 'funnel' }] : []),
    { id: 'copy-hash', label: this.copyHashLabel, icon: 'clipboard', dividerBefore: true },
  ];
  readonly detailsLabel = $localize`:@@lwConsoleAudit-details:Details`;
  readonly onlyActionLabel = $localize`:@@lwConsoleAudit-onlyAction:Only this action`;
  readonly onlyTargetLabel = $localize`:@@lwConsoleAudit-onlyTarget:Only this target`;
  readonly onlyActorLabel = $localize`:@@lwConsoleAudit-onlyActor:Only this actor`;
  readonly actorFilterValue = auditActorFilterValue;
  readonly copyHashLabel = $localize`:@@lwConsoleAudit-copyHash:Copy chain hash`;

  onRowAction(entry: AuditEntry, action: string): void {
    if (action === 'details') this.toggle(entry);
    else if (action === 'only-action') this.narrow('action', entry.action);
    else if (action === 'only-target') this.narrow('target', entry.target);
    else if (action === 'only-actor') this.narrow('actor', auditActorFilterValue(entry));
    else if (action === 'copy-hash') fpcCopyText(entry.hash);
  }

  older(): void {
    this.facade.next();
  }

  newer(): void {
    this.facade.previous();
  }

  toggle(entry: AuditEntry): void {
    this.expanded.set(this.expanded() === entry.seq ? null : entry.seq);
  }

  /** Narrows the search to a value of an entry. */
  narrow(name: AuditTextFilter, value: string | null): void {
    if (!value) return;

    this.setFilter(name, value);
    this.search();
  }

  details(entry: AuditEntry): string {
    return JSON.stringify(entry.details ?? {}, null, 2);
  }

  /** A terminal session's entries link to the session list. */
  sessionOf(entry: AuditEntry): string | null {
    return entry.action.startsWith('terminal.') && typeof entry.details?.['session'] === 'string'
      ? (entry.details['session'] as string)
      : null;
  }

  verify(): void {
    this.facade.verify();
  }

  export(format: AuditExportFormat): void {
    this.exporting.set(true);
    this.exportError.set(null);
    this.service.export(this.applied() ?? this.filter(), format).subscribe({
      next: (content) => {
        this.exporting.set(false);
        saveFile(this.document, content, `audit-${new Date().toISOString().slice(0, 10)}.${format}`);
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.exportError.set(apiErrorMessage(error, 'Export failed'));
      },
    });
  }
}
