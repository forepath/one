import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  WorkspaceSearchFacade,
  WorkspaceSearchService,
  type WorkspaceSearchHitDto,
  type WorkspaceSearchMatchDto,
  type WorkspaceSearchMode,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAccordionComponent,
  FpcAccordionItemComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcSpinnerComponent,
  FpcTypeaheadSelectComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  of,
  skip,
  Subject,
  switchMap,
} from 'rxjs';

import { fileIconNameForName } from '../file-icon.util';
import { buildPathPrefixSuggestions } from './path-prefix-suggestions.util';

@Component({
  selector: 'framework-workspace-search-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAccordionComponent,
    FpcAccordionItemComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcSpinnerComponent,
    FpcTypeaheadSelectComponent,
  ],
  templateUrl: './workspace-search-panel.component.html',
  styleUrls: ['./workspace-search-panel.component.scss'],
})
export class WorkspaceSearchPanelComponent {
  private readonly facade = inject(WorkspaceSearchFacade);
  private readonly searchService = inject(WorkspaceSearchService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queryChanges = new Subject<string>();
  private readonly includeSuggestChanges = new Subject<string>();
  private readonly excludeSuggestChanges = new Subject<string>();

  clientId = input.required<string>();
  agentId = input.required<string>();

  openHit = output<{ path: string; line?: number | null }>();

  query = signal('');
  mode = toSignal(this.facade.mode$, { initialValue: 'full' as WorkspaceSearchMode });
  includePaths = signal<string[]>([]);
  excludePaths = signal<string[]>([]);
  includeDraft = signal('');
  excludeDraft = signal('');
  includeSuggestionsOpen = signal(false);
  excludeSuggestionsOpen = signal(false);
  includePathSuggestions = signal<string[]>([]);
  excludePathSuggestions = signal<string[]>([]);
  includeSuggestLoading = signal(false);
  excludeSuggestLoading = signal(false);

  readonly indexStatus$ = this.facade.indexStatus$;
  readonly hits = toSignal(this.facade.hits$, { initialValue: [] as WorkspaceSearchHitDto[] });
  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;

  /** Filenames that appear on more than one distinct path in the current hit list. */
  private readonly duplicateFileNames = computed(() => {
    const pathsByName = new Map<string, Set<string>>();

    for (const hit of this.hits()) {
      const label = this.fileLabel(hit);
      const paths = pathsByName.get(label) ?? new Set<string>();

      paths.add(hit.path);
      pathsByName.set(label, paths);
    }

    const duplicates = new Set<string>();

    for (const [name, paths] of pathsByName) {
      if (paths.size > 1) {
        duplicates.add(name);
      }
    }

    return duplicates;
  });

  readonly modeFullLabel = $localize`:@@featureWorkspaceSearch-modeFull:Full`;
  readonly modeFilesLabel = $localize`:@@featureWorkspaceSearch-modeFiles:Files`;
  readonly queryPlaceholderFull = $localize`:@@featureWorkspaceSearch-queryPlaceholder:Search files and content…`;
  readonly queryPlaceholderFiles = $localize`:@@featureWorkspaceSearch-queryPlaceholderFiles:Search by file path…`;

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      const agentId = this.agentId();

      if (clientId && agentId) {
        this.facade.loadStatus(clientId, agentId);
      }
    });

    this.queryChanges.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      this.runSearch(query);
    });

    this.facade.mode$.pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.runSearch(this.query(), mode);
      this.focusQueryInput();
    });

    this.bindPathSuggestStream(
      this.includeSuggestChanges,
      () => this.includePaths(),
      (paths) => this.includePathSuggestions.set(paths),
      (loading) => this.includeSuggestLoading.set(loading),
    );
    this.bindPathSuggestStream(
      this.excludeSuggestChanges,
      () => this.excludePaths(),
      (paths) => this.excludePathSuggestions.set(paths),
      (loading) => this.excludeSuggestLoading.set(loading),
    );
  }

  queryPlaceholder(): string {
    return this.mode() === 'files' ? this.queryPlaceholderFiles : this.queryPlaceholderFull;
  }

  onQueryInput(value: string): void {
    this.query.set(value);
    this.facade.setQuery(value);
    this.queryChanges.next(value);
  }

  onModeSelect(value: string): void {
    const mode: WorkspaceSearchMode = value === 'files' ? 'files' : 'full';

    if (this.mode() === mode) {
      return;
    }

    this.facade.setMode(mode);
  }

  onIncludeDraftChange(value: string): void {
    this.includeDraft.set(value);
    this.includeSuggestionsOpen.set(value.trim().length > 0);
    this.includeSuggestChanges.next(value);
  }

  onExcludeDraftChange(value: string): void {
    this.excludeDraft.set(value);
    this.excludeSuggestionsOpen.set(value.trim().length > 0);
    this.excludeSuggestChanges.next(value);
  }

  addIncludePath(raw: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const path = this.normalizePath(raw);

    if (!path || this.includePaths().includes(path)) {
      this.includeDraft.set('');
      this.includeSuggestionsOpen.set(false);
      this.includePathSuggestions.set([]);

      return;
    }

    const next = [...this.includePaths(), path];

    this.includePaths.set(next);
    this.facade.setIncludePaths(next);
    this.includeDraft.set('');
    this.includeSuggestionsOpen.set(false);
    this.includePathSuggestions.set([]);
    this.runSearch(this.query());
  }

  addExcludePath(raw: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const path = this.normalizePath(raw);

    if (!path || this.excludePaths().includes(path)) {
      this.excludeDraft.set('');
      this.excludeSuggestionsOpen.set(false);
      this.excludePathSuggestions.set([]);

      return;
    }

    const next = [...this.excludePaths(), path];

    this.excludePaths.set(next);
    this.facade.setExcludePaths(next);
    this.excludeDraft.set('');
    this.excludeSuggestionsOpen.set(false);
    this.excludePathSuggestions.set([]);
    this.runSearch(this.query());
  }

  removeIncludePath(path: string): void {
    const next = this.includePaths().filter((item) => item !== path);

    this.includePaths.set(next);
    this.facade.setIncludePaths(next);
    this.runSearch(this.query());
  }

  removeExcludePath(path: string): void {
    const next = this.excludePaths().filter((item) => item !== path);

    this.excludePaths.set(next);
    this.facade.setExcludePaths(next);
    this.runSearch(this.query());
  }

  onIncludeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.addIncludePath(this.includeDraft(), event);
    }
  }

  onExcludeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.addExcludePath(this.excludeDraft(), event);
    }
  }

  onRebuild(): void {
    this.facade.reindex(this.clientId(), this.agentId());
  }

  /** Text excerpts for a hit (prefers `matches`; falls back to legacy snippet/line). */
  hitMatches(hit: WorkspaceSearchHitDto): WorkspaceSearchMatchDto[] {
    if (hit.matches && hit.matches.length > 0) {
      return hit.matches;
    }

    if (hit.snippet != null && hit.snippet !== '' && hit.line != null && hit.line > 0) {
      return [{ line: hit.line, snippet: hit.snippet }];
    }

    return [];
  }

  hitHasMatches(hit: WorkspaceSearchHitDto): boolean {
    return this.hitMatches(hit).length > 0;
  }

  fileIconForHit(hit: WorkspaceSearchHitDto): string {
    return fileIconNameForName(hit.fileName || hit.path);
  }

  /** Basename shown in result rows; full path is on the native `title` tooltip. */
  fileLabel(hit: WorkspaceSearchHitDto): string {
    const name = hit.fileName?.trim();

    if (name) {
      return name;
    }

    const segments = hit.path.replace(/\\/g, '/').split('/').filter(Boolean);

    return segments[segments.length - 1] || hit.path;
  }

  /**
   * Parent directory for disambiguating duplicate basenames.
   * Empty when the file sits at workspace root (omit the muted line).
   */
  filePathHint(hit: WorkspaceSearchHitDto): string {
    const normalized = hit.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const slash = normalized.lastIndexOf('/');

    if (slash <= 0) {
      return '';
    }

    return normalized.slice(0, slash);
  }

  /** True when another hit shares this basename on a different path. */
  showPathDisambiguator(hit: WorkspaceSearchHitDto): boolean {
    return this.duplicateFileNames().has(this.fileLabel(hit)) && this.filePathHint(hit).length > 0;
  }

  onSelectFile(hit: WorkspaceSearchHitDto): void {
    this.openHit.emit({ path: hit.path, line: null });
  }

  onSelectMatch(hit: WorkspaceSearchHitDto, match: WorkspaceSearchMatchDto): void {
    this.openHit.emit({ path: hit.path, line: match.line });
  }

  focusQueryInput(): void {
    queueMicrotask(() => {
      document.getElementById('workspaceSearchQuery')?.focus();
    });
  }

  private bindPathSuggestStream(
    source$: Subject<string>,
    selectedPaths: () => string[],
    setSuggestions: (paths: string[]) => void,
    setLoading: (loading: boolean) => void,
  ): void {
    source$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((raw) => {
          const query = raw.trim();

          if (!query) {
            setSuggestions([]);
            setLoading(false);

            return EMPTY;
          }

          const clientId = this.clientId();
          const agentId = this.agentId();

          if (!clientId || !agentId) {
            setSuggestions([]);
            setLoading(false);

            return EMPTY;
          }

          setLoading(true);

          return this.searchService.search(clientId, agentId, query, [], [], 'files').pipe(
            map((response) =>
              buildPathPrefixSuggestions(
                response.hits.map((hit) => hit.path),
                query,
                selectedPaths(),
              ),
            ),
            catchError(() => of([] as string[])),
            finalize(() => setLoading(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((paths) => setSuggestions(paths));
  }

  private runSearch(query: string, modeOverride?: WorkspaceSearchMode): void {
    const trimmed = query.trim();

    if (!trimmed) {
      this.facade.clearResults();

      return;
    }

    this.facade.search(
      this.clientId(),
      this.agentId(),
      trimmed,
      this.includePaths(),
      this.excludePaths(),
      modeOverride ?? this.mode(),
    );
  }

  private normalizePath(raw: string): string | null {
    const normalized = raw.replace(/^\/+/, '').replace(/\\/g, '/').trim();

    if (!normalized || normalized.includes('..') || normalized.includes('\0')) {
      return null;
    }

    return normalized;
  }
}
