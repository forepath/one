import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { FpcFormControlComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { map, of, Subject, switchMap, tap, timer } from 'rxjs';

import { joinSecretRef, REF_TEXT, splitSecretRef, type ReferenceTarget } from './reference-fields';
import { LoadweaverReferenceSource, type ReferenceOption } from './reference-source';
import { SCHEMA_KIND_LABELS } from './schema-form-labels';

/** Typing settles this long before the server is asked (picking from the menu is immediate). */
export const REFERENCE_DEBOUNCE_MS = 250;

/**
 * A reference field of the generated form (2026-10-29): a combobox over the referenced objects the caller may see
 * (`fpc-typeahead-select`), storing exactly what the schema expects (the name / id). Typing stays free text, so
 * a name the list doesn't show (or a kind the caller can't list: `denied`, with a hint) can still be entered; the
 * YAML follows on every change. Secret references are a project picker + the secret's name (`secret://p/name`).
 */
@Component({
  selector: 'loadweaver-reference-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FpcFormControlComponent, FpcTypeaheadSelectComponent],
  host: { class: 'lw-reference-field d-block', '[attr.data-ref]': 'refKey()' },
  template: `
    @if (target().type === 'secret') {
      @let s = secret();
      <div class="row g-2" data-testid="schema-ref-secret">
        <div class="col-12 col-sm-5">
          <loadweaver-reference-field
            [target]="projectTarget"
            [value]="s.project"
            [placeholder]="projectPlaceholder()"
            [controlId]="controlId() + '-project'"
            [ariaLabel]="secretProjectLabel + ': ' + ariaLabel()"
            [disabled]="disabled()"
            (valueChange)="setSecret($event ?? '', s.name)"
          />
        </div>
        <div class="col-12 col-sm-7" data-testid="schema-ref-secret-name">
          <!-- Second picker: the secret's name in the chosen project (names only; typing stays possible). -->
          <loadweaver-reference-field
            [target]="{ type: 'secretName', project: s.project || null }"
            [value]="s.name"
            [placeholder]="secretNameLabel"
            [controlId]="controlId()"
            [ariaLabel]="secretNameLabel + ': ' + ariaLabel()"
            [disabled]="disabled()"
            [invalid]="invalid()"
            (valueChange)="setSecret(s.project, $event ?? '')"
          />
        </div>
      </div>
    } @else {
      <fpc-typeahead-select
        [inputId]="controlId()"
        [listboxId]="controlId() + '-listbox'"
        [placeholder]="placeholder() ?? placeholderLabel"
        [ariaLabel]="ariaLabel()"
        [disabled]="disabled()"
        [loading]="loading()"
        [query]="text()"
        (queryChange)="type($event)"
        [open]="open()"
        (openChange)="setOpen($event)"
        (cleared)="type('')"
        data-testid="schema-ref-input"
      >
        <div fpcTypeaheadSuggestions>
          @for (option of options(); track option.value) {
            <button
              type="button"
              role="option"
              class="dropdown-item py-2 text-start"
              [attr.aria-selected]="option.value === text()"
              (mousedown)="pick(option, $event)"
              data-testid="schema-ref-option"
            >
              <span class="d-block small fw-medium text-truncate">{{ option.label }}</span>
              @if (option.detail) {
                <span class="d-block text-body-secondary small text-truncate">{{ option.detail }}</span>
              }
            </button>
          } @empty {
            <span class="dropdown-item-text text-body-secondary small" data-testid="schema-ref-empty">{{
              emptyText()
            }}</span>
          }
        </div>
      </fpc-typeahead-select>
      @if (denied()) {
        <p class="form-text mb-0" data-testid="schema-ref-denied">{{ deniedLabel }}</p>
      }
    }
  `,
})
export class LoadweaverReferenceFieldComponent {
  private readonly source = inject(LoadweaverReferenceSource);

  readonly target = input.required<ReferenceTarget>();
  readonly value = input<unknown>(undefined);
  readonly controlId = input('lw-ref');
  readonly ariaLabel = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);

  readonly valueChange = output<string | undefined>();

  readonly placeholderLabel = REF_TEXT.placeholder;
  readonly deniedLabel = REF_TEXT.denied;
  readonly secretProjectLabel = REF_TEXT.secretProject;
  readonly secretNameLabel = REF_TEXT.secretName;
  readonly projectTarget: ReferenceTarget = { type: 'project' };

  readonly text = computed(() => {
    const value = this.value();

    return value === undefined || value === null ? '' : String(value);
  });
  readonly secret = computed(() => splitSecretRef(this.value()));
  /** The secret's project defaults to the edited resource's project. */
  readonly projectPlaceholder = computed(() => this.source.project() ?? REF_TEXT.project);
  readonly refKey = computed(() => {
    const t = this.target();

    return t.type === 'resource' ? t.kind : t.type;
  });

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly options = signal<ReferenceOption[]>([]);
  readonly denied = signal(false);
  readonly emptyText = computed(() => {
    const t = this.target();
    const project = this.source.project();

    if (t.type === 'backup') return REF_TEXT.backupEmpty.replace('{project}', project ?? '—');
    if (t.type === 'secretName')
      return t.project ? REF_TEXT.secretEmpty.replace('{project}', t.project) : REF_TEXT.secretPickProject;

    const kind = t.type === 'resource' ? (SCHEMA_KIND_LABELS[t.kind] ?? t.kind) : REF_TEXT.project;
    const empty =
      t.type === 'resource' && t.projectScoped && project
        ? REF_TEXT.emptyInProject.replace('{kind}', kind).replace('{project}', project)
        : REF_TEXT.empty.replace('{kind}', kind);

    return `${empty} ${REF_TEXT.typeAnyway}`;
  });

  private typing = false;
  private readonly queries = new Subject<{ term: string; now: boolean }>();

  constructor() {
    this.queries
      .pipe(
        tap(() => this.loading.set(true)),
        // Opening asks at once; typing settles first (a newer query cancels the pending one: a debounce).
        switchMap(({ term, now }) =>
          (now ? of(term) : timer(REFERENCE_DEBOUNCE_MS).pipe(map(() => term))).pipe(
            switchMap((t) => this.source.search(this.target(), t)),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.denied.set(result.denied);
        this.options.set(result.options);

        if (result.denied) this.open.set(false);
      });
  }

  setOpen(open: boolean): void {
    if (open && this.denied()) return;

    const opening = open && !this.open();

    this.open.set(open);

    // Focus: everything the caller can see (the stored value doesn't filter the menu). Typing opens it too, and then
    // its own query (already on its way) is the one that counts.
    if (opening && !this.typing) this.queries.next({ term: '', now: true });
  }

  type(text: string): void {
    this.valueChange.emit(text.trim() === '' ? undefined : text);

    if (this.denied()) return;

    this.typing = true;
    queueMicrotask(() => (this.typing = false));
    this.queries.next({ term: text, now: false });
  }

  pick(option: ReferenceOption, event: Event): void {
    event.preventDefault();
    this.valueChange.emit(option.value);
    this.open.set(false);
  }

  setSecret(project: string, name: string): void {
    // A name typed first goes into the edited resource's project.
    const p = project || (name ? (this.source.project() ?? '') : '');

    this.valueChange.emit(joinSecretRef(p, name));
  }
}
