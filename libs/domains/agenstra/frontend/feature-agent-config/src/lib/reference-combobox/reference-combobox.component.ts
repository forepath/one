import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, map, Observable, of, Subject, switchMap } from 'rxjs';

/** One suggestion: `value` is what the field stores; `label` / `detail` are display only. */
export interface ReferenceComboboxOption {
  value: string;
  label?: string;
  detail?: string;
}

/** Lazily loads the suggestions the caller may see (asked once per loader, on the first open). */
export type ReferenceComboboxLoader = () => Observable<readonly ReferenceComboboxOption[]>;

type LoadResult = { options: readonly ReferenceComboboxOption[]; denied: boolean };

/** 401 / 403: the caller may not list these. The field stays a plain input with a hint, never an error. */
export function isReferenceAccessDenied(error: unknown): boolean {
  return error instanceof HttpErrorResponse
    ? error.status === 401 || error.status === 403
    : typeof error === 'object' && error !== null && [401, 403].includes((error as { status?: number }).status ?? 0);
}

/** Case-insensitive match on value, label and detail; the first `limit` hits. */
export function filterReferenceOptions(
  options: readonly ReferenceComboboxOption[],
  term: string,
  limit: number,
): ReferenceComboboxOption[] {
  const needle = term.trim().toLowerCase();
  const hits = needle
    ? options.filter((o) => `${o.value} ${o.label ?? ''} ${o.detail ?? ''}`.toLowerCase().includes(needle))
    : [...options];

  return hits.slice(0, limit);
}

/** `first`, then the entries of `second` with a value `first` doesn't have. */
export function mergeReferenceOptions(
  first: readonly ReferenceComboboxOption[],
  second: readonly ReferenceComboboxOption[],
): ReferenceComboboxOption[] {
  const seen = new Set(first.map((o) => o.value));

  return [...first, ...second.filter((o) => !seen.has(o.value))];
}

/**
 * Reference typeahead for Agenstra name / id fields (2026-10-29): a free-text combobox over `fpc-typeahead-select`.
 * Typing writes the value right away (a name the list doesn't show can still be entered); focus lists what the caller
 * may see, typing filters on the client. Suggestions come from `options` (an already loaded list) or a `loader`
 * (one scoped API call on the first open). A 401 / 403 from the loader (or `denied`) keeps the menu closed and shows
 * a hint instead of an error.
 */
@Component({
  selector: 'agenstra-reference-combobox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcTypeaheadSelectComponent],
  host: { class: 'agenstra-reference-combobox d-block' },
  template: `
    <fpc-typeahead-select
      [inputId]="inputId()"
      [listboxId]="inputId() + '-listbox'"
      [size]="size()"
      [placeholder]="placeholder()"
      [ariaLabel]="ariaLabel()"
      [disabled]="disabled()"
      [required]="required()"
      [loading]="busy()"
      [query]="value()"
      (queryChange)="type($event)"
      [open]="open()"
      (openChange)="setOpen($event)"
      (cleared)="type('')"
      (keydown.enter)="enter.emit()"
      data-testid="ref-combobox-input"
    >
      <div fpcTypeaheadSuggestions>
        @for (option of visibleOptions(); track option.value) {
          <button
            type="button"
            role="option"
            class="dropdown-item py-2 text-start"
            [attr.aria-selected]="option.value === value()"
            (mousedown)="pick(option, $event)"
            data-testid="ref-combobox-option"
          >
            <span class="d-block small fw-medium text-truncate" [class.font-monospace]="monospace()">{{
              option.label ?? option.value
            }}</span>
            @if (option.detail) {
              <span class="d-block text-body-secondary small text-truncate">{{ option.detail }}</span>
            }
          </button>
        } @empty {
          <span class="dropdown-item-text text-body-secondary small" data-testid="ref-combobox-empty"
            >{{ emptyText() }} {{ typeAnywayLabel }}</span
          >
        }
      </div>
    </fpc-typeahead-select>
    @if (isDenied()) {
      <p class="form-text mb-0" data-testid="ref-combobox-denied">{{ deniedHint() ?? deniedLabel }}</p>
    }
  `,
})
export class ReferenceComboboxComponent {
  /** The stored value (free text). */
  readonly value = model<string>('');
  /** An already loaded list (filtered on the client); listed before the loader's results. */
  readonly options = input<readonly ReferenceComboboxOption[] | null>(null);
  /** A scoped list call, asked on the first open (and again when the loader changes). */
  readonly loader = input<ReferenceComboboxLoader | null>(null);
  /** External loading state (for `options`). */
  readonly loading = input(false);
  /** External "may not list" state (for `options`). */
  readonly denied = input(false);
  readonly inputId = input('agenstraReferenceCombobox');
  readonly size = input<'sm' | 'md'>('md');
  readonly placeholder = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly disabled = input(false);
  readonly required = input(false);
  readonly monospace = input(false);
  readonly suggestionLimit = input(20);
  readonly emptyText = input($localize`:@@featureReferenceCombobox-empty:Nothing found.`);
  readonly deniedHint = input<string | null>(null);

  /** Enter in the input (e.g. submit the manual branch switch). */
  readonly enter = output<void>();

  readonly typeAnywayLabel = $localize`:@@featureReferenceCombobox-typeAnyway:You can still type a value.`;
  readonly deniedLabel = $localize`:@@featureReferenceCombobox-denied:You can't list these here. Type the value.`;

  readonly open = signal(false);
  private readonly filterTerm = signal('');
  private readonly loaded = signal<readonly ReferenceComboboxOption[] | null>(null);
  private readonly loaderBusy = signal(false);
  private readonly loaderDenied = signal(false);
  private readonly loads = new Subject<ReferenceComboboxLoader>();
  private typing = false;
  private readonly shell = viewChild(FpcTypeaheadSelectComponent);

  readonly busy = computed(() => this.loading() || this.loaderBusy());
  readonly isDenied = computed(() => this.denied() || this.loaderDenied());
  readonly visibleOptions = computed(() =>
    filterReferenceOptions(
      mergeReferenceOptions(this.options() ?? [], this.loader() ? (this.loaded() ?? []) : []),
      this.filterTerm(),
      this.suggestionLimit(),
    ),
  );

  constructor() {
    // A new loader (other scope, e.g. another repository) forgets the previous list.
    effect(() => {
      this.loader();
      untracked(() => {
        this.loaded.set(null);
        this.loaderDenied.set(false);
        this.loaderBusy.set(false);
      });
    });

    this.loads
      .pipe(
        switchMap((loader) =>
          loader().pipe(
            map((options): LoadResult => ({ options, denied: false })),
            catchError((error: unknown) => of<LoadResult>({ options: [], denied: isReferenceAccessDenied(error) })),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ options, denied }) => {
        this.loaderBusy.set(false);
        this.loaded.set(options);
        this.loaderDenied.set(denied);

        if (denied) {
          this.open.set(false);
          this.shell()?.open.set(false);
        }
      });
  }

  setOpen(open: boolean): void {
    // Denied, or nothing to list yet (no list, no loader, e.g. before the first save): a plain input.
    if (open && (this.isDenied() || (!this.loader() && this.options() === null))) {
      // The shell opened itself (focus / typing): close it again, our `open` never became true.
      this.shell()?.open.set(false);

      return;
    }

    const opening = open && !this.open();

    this.open.set(open);

    if (!opening) {
      return;
    }

    // Focus lists everything (the stored value doesn't filter); typing opens it too and keeps its own filter.
    if (!this.typing) {
      this.filterTerm.set('');
    }

    const loader = this.loader();

    if (loader && this.loaded() === null && !this.loaderBusy()) {
      this.loaderBusy.set(true);
      this.loads.next(loader);
    }
  }

  type(text: string): void {
    this.typing = true;
    queueMicrotask(() => (this.typing = false));
    this.value.set(text);
    this.filterTerm.set(text);
  }

  pick(option: ReferenceComboboxOption, event: Event): void {
    event.preventDefault();
    this.value.set(option.value);
    this.filterTerm.set('');
    this.open.set(false);
  }
}
