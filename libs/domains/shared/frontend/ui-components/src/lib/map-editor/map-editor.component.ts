import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';

/** A map value of `fpc-map-editor` (labels, options, variables, per-key numbers). */
export type FpcMapValue = Readonly<Record<string, string | number>>;

/** Texts of `fpc-map-editor` (English defaults; consumers pass localized ones). */
export interface FpcMapEditorLabels {
  key: string;
  value: string;
  add: string;
  /** `{key}` = the row's key. */
  remove: string;
  empty: string;
  duplicate: string;
  invalidKey: string;
  invalidValue: string;
  requiredKey: string;
}

export const FPC_MAP_EDITOR_DEFAULT_LABELS: FpcMapEditorLabels = {
  key: 'Key',
  value: 'Value',
  add: 'Add entry',
  remove: 'Remove {key}',
  empty: 'No entries yet.',
  duplicate: 'This key is used twice.',
  invalidKey: 'Invalid key.',
  invalidValue: 'Invalid value.',
  requiredKey: 'Enter a key.',
};

interface MapRow {
  id: number;
  key: string;
  value: string;
}

/** One row's problem (null = fine). */
export function fpcMapRowError(
  row: { key: string; value: string },
  rows: readonly { key: string }[],
  options: { keyPattern?: string | null; valuePattern?: string | null; valueType?: 'text' | 'number' },
): 'requiredKey' | 'duplicate' | 'invalidKey' | 'invalidValue' | null {
  const key = row.key.trim();

  if (!key) return row.value.trim() ? 'requiredKey' : null;

  // The first row of a key wins; later ones are the duplicates.
  const first = rows.find((r) => r.key.trim() === key);

  if (first && first !== row) return 'duplicate';

  if (options.keyPattern && !safeRegex(options.keyPattern)?.test(key)) return 'invalidKey';

  if (options.valueType === 'number' && row.value.trim() !== '' && !Number.isFinite(Number(row.value))) {
    return 'invalidValue';
  }

  if (options.valuePattern && !safeRegex(options.valuePattern)?.test(row.value)) return 'invalidValue';

  return null;
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return null;
  }
}

function toRows(value: FpcMapValue | null | undefined, start: number): MapRow[] {
  return Object.entries(value ?? {}).map(([key, v], index) => ({ id: start + index, key, value: String(v) }));
}

let nextMapEditorId = 0;

/**
 * Generic key / value map editor (2026-10-29): labels, options, variables, per-key numbers. Rows of a key and a value
 * input with Remove, and Add. `[(value)]` is a plain object: only complete, valid rows are written (a new empty row,
 * a duplicate or an invalid key stays local and shows its error until fixed). `valueType="number"` writes numbers.
 * `keyPattern` / `valuePattern` (regex sources, e.g. from a JSON Schema) validate per row.
 */
@Component({
  selector: 'fpc-map-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-map-editor',
    role: 'group',
    '[attr.aria-labelledby]': 'label() ? id + "-label" : null',
    '[attr.aria-label]': 'label() ? null : ariaLabel()',
  },
  template: `
    @if (label()) {
      <span class="form-label d-block mb-1" [id]="id + '-label'"
        >{{ label() }}
        @if (required()) {
          <span class="text-danger" aria-hidden="true">*</span>
        }
      </span>
    }
    @if (hint()) {
      <p class="form-text mt-0 mb-2">{{ hint() }}</p>
    }
    @if (rows().length > 0) {
      <div class="fpc-map-editor__head" aria-hidden="true">
        <span>{{ text().key }}</span
        ><span>{{ text().value }}</span
        ><span></span>
      </div>
      <ul class="fpc-map-editor__rows list-unstyled mb-0">
        @for (row of rows(); track row.id; let index = $index) {
          @let error = errorOf(row);
          <li class="fpc-map-editor__row" [attr.data-index]="index">
            <input
              class="form-control"
              [class.form-control-sm]="size() === 'sm'"
              [class.is-invalid]="error === 'duplicate' || error === 'invalidKey' || error === 'requiredKey'"
              [id]="id + '-key-' + row.id"
              [value]="row.key"
              [placeholder]="keyPlaceholder() ?? ''"
              [disabled]="disabled()"
              [attr.aria-label]="text().key + ' ' + (index + 1)"
              [attr.aria-describedby]="error ? id + '-error-' + row.id : null"
              autocomplete="off"
              spellcheck="false"
              (input)="setKey(row.id, $any($event.target).value)"
              data-testid="fpc-map-editor-key"
            />
            <input
              class="form-control"
              [class.form-control-sm]="size() === 'sm'"
              [class.is-invalid]="error === 'invalidValue'"
              [type]="valueType() === 'number' ? 'number' : 'text'"
              [value]="row.value"
              [placeholder]="valuePlaceholder() ?? ''"
              [disabled]="disabled()"
              [attr.aria-label]="text().value + ' ' + (row.key || index + 1)"
              [attr.aria-describedby]="error ? id + '-error-' + row.id : null"
              autocomplete="off"
              (input)="setValue(row.id, $any($event.target).value)"
              data-testid="fpc-map-editor-value"
            />
            @if (!disabled()) {
              <button
                type="button"
                class="btn btn-sm fpc-map-editor__remove"
                [attr.aria-label]="text().remove.replace('{key}', row.key || '#' + (index + 1))"
                [title]="text().remove.replace('{key}', row.key || '#' + (index + 1))"
                (click)="removeRow(row.id)"
                data-testid="fpc-map-editor-remove"
              >
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            }
            @if (error) {
              <p
                class="fpc-map-editor__error invalid-feedback d-block mb-0"
                [id]="id + '-error-' + row.id"
                role="alert"
              >
                {{ text()[error] }}
              </p>
            }
          </li>
        }
      </ul>
    } @else if (emptyText()) {
      <p class="small text-body-secondary mb-0">{{ emptyText() }}</p>
    }
    @if (!disabled()) {
      <button type="button" class="btn btn-sm fpc-map-editor__add" (click)="addRow()" data-testid="fpc-map-editor-add">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ text().add }}
      </button>
    }
  `,
  styleUrl: './map-editor.component.scss',
})
export class FpcMapEditorComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly value = model<FpcMapValue>({});
  readonly label = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly valueType = input<'text' | 'number'>('text');
  readonly keyPattern = input<string | null>(null);
  readonly valuePattern = input<string | null>(null);
  readonly keyPlaceholder = input<string | null>(null);
  readonly valuePlaceholder = input<string | null>(null);
  readonly emptyText = input<string | null>(FPC_MAP_EDITOR_DEFAULT_LABELS.empty);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly size = input<'sm' | 'md'>('md');
  readonly labels = input<Partial<FpcMapEditorLabels>>({});

  protected readonly id = `fpc-map-editor-${nextMapEditorId++}`;
  protected readonly text = computed(() => ({ ...FPC_MAP_EDITOR_DEFAULT_LABELS, ...this.labels() }));
  protected readonly rows = signal<MapRow[]>([]);
  private nextRowId = 0;
  /** The last value this editor wrote: echoes of it don't reset the rows (keeps incomplete rows). */
  private written: string | null = null;

  constructor() {
    effect(() => {
      const value = this.value();

      untracked(() => {
        if (this.written !== null && JSON.stringify(value ?? {}) === this.written) return;

        this.written = null;
        this.rows.set(toRows(value, this.nextRowId));
        this.nextRowId += Object.keys(value ?? {}).length;
      });
    });
  }

  protected errorOf(row: MapRow): keyof FpcMapEditorLabels | null {
    return fpcMapRowError(row, this.rows(), {
      keyPattern: this.keyPattern(),
      valuePattern: this.valuePattern(),
      valueType: this.valueType(),
    });
  }

  addRow(): void {
    const id = this.nextRowId++;

    this.rows.update((rows) => [...rows, { id, key: '', value: '' }]);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>(`#${this.id}-key-${id}`)?.focus(), {
      injector: this.injector,
    });
  }

  removeRow(id: number): void {
    this.rows.update((rows) => rows.filter((r) => r.id !== id));
    this.write();
  }

  setKey(id: number, key: string): void {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? { ...r, key } : r)));
    this.write();
  }

  setValue(id: number, value: string): void {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? { ...r, value } : r)));
    this.write();
  }

  /** Writes the complete, valid rows (in row order). */
  private write(): void {
    const next: Record<string, string | number> = {};

    for (const row of this.rows()) {
      const key = row.key.trim();

      if (!key || this.errorOf(row)) continue;

      if (this.valueType() === 'number') {
        // A number row without a number yet stays local.
        if (row.value.trim() !== '') next[key] = Number(row.value);
      } else {
        next[key] = row.value;
      }
    }

    if (JSON.stringify(next) === JSON.stringify(this.value() ?? {})) return;

    this.written = JSON.stringify(next);
    this.value.set(next);
  }
}
