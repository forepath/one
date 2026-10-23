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
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPagerComponent,
  FpcPanelComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { saveFile } from '../live/live-format';
import { isoToLocalInput, localInputToIso } from '../logs/logs-format';

/** Text filters in the URL and the form. */
export const AUDIT_TEXT_FILTERS = ['project', 'action', 'actor', 'target', 'text'] as const;

type AuditTextFilter = (typeof AUDIT_TEXT_FILTERS)[number];

const PAGE_SIZES = [25, 50, 100, 250, 500];

/**
 * The audit log (3.18): search by actor, action (exact or `prefix*`), target prefix, project, time and full text;
 * newest first, paged by sequence number; entry details; CSV / NDJSON export; for auditors and cluster admins the
 * hash chain's verification. Project admins see their projects' entries (the API scopes it). Filters live in the URL.
 */
@Component({
  selector: 'loadweaver-audit-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPagerComponent,
    FpcPanelComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
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
  readonly limit = signal(50);
  readonly expanded = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly applied = signal<AuditFilter | null>(null);
  readonly filtersOpen = signal(false);

  /** Filled filters in the panel (the full-text search field is not counted). */
  readonly activeFilterCount = computed(
    () =>
      AUDIT_TEXT_FILTERS.filter((name) => name !== 'text' && this.filters()[name].trim()).length +
      (this.fromInput() ? 1 : 0) +
      (this.toInput() ? 1 : 0),
  );

  /** The chain's verification: auditors and cluster admins. */
  readonly canVerify = computed(() => this.clusterRole() === 'cluster-admin' || this.clusterRole() === 'auditor');

  readonly pageSizes = PAGE_SIZES;

  readonly title = $localize`:@@lwConsoleAudit-title:Audit log`;
  readonly searchLabel = $localize`:@@lwConsoleAudit-search:Search`;
  readonly fromLabel = $localize`:@@lwConsoleAudit-from:From`;
  readonly toLabel = $localize`:@@lwConsoleAudit-to:To`;
  readonly newerLabel = $localize`:@@lwConsoleAudit-newer:Newer`;
  readonly olderLabel = $localize`:@@lwConsoleAudit-older:Older`;
  readonly pageSizeLabel = $localize`:@@lwConsoleAudit-pageSize:Entries per page`;
  readonly verifyLabel = $localize`:@@lwConsoleAudit-verify:Verify chain`;
  readonly resetLabel = $localize`:@@lwConsoleAudit-reset:Reset`;
  readonly pageLabel = $localize`:@@lwConsoleAudit-page:Page`;
  readonly filtersLabel = $localize`:@@lwConsoleAudit-filters:Filters`;
  readonly actionLabel = $localize`:@@lwConsoleAudit-actionLabel:Action`;
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
        return $localize`:@@lwConsoleAudit-actor:Actor id`;
      case 'target':
        return $localize`:@@lwConsoleAudit-target:Target prefix`;
      default:
        return $localize`:@@lwConsoleAudit-text:Full text`;
    }
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
