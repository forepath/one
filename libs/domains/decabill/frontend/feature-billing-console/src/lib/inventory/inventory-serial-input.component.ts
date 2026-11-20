import { ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FpcBadgeComponent,
  FpcFormControlComponent,
  FpcTypeaheadSelectComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  compressSerialNumbers,
  parseSerialNumberInput,
  type SerialNumberInputErrorCode,
} from '@forepath/shared/shared/util-barcode';

/** Same bound as the API (serial numbers per movement, ranges expanded). */
export const INVENTORY_SERIALS_PER_MOVEMENT_MAX = 1000;

/** Units listed in the picker at once (the search narrows them down). */
const PICK_SHOWN = 20;

export interface InventorySerialSelection {
  /** Expanded, unique serial numbers. */
  serialNumbers: string[];
  /** Input tokens as typed (singles and ranges; what is sent to the API). */
  tokens: string[];
  /** Parsable and (with `available`) every serial number available. */
  valid: boolean;
}

const ERROR_LABELS: Record<SerialNumberInputErrorCode, string> = {
  invalid: $localize`:@@featureInventorySerials-errorInvalid:not a valid serial number`,
  'range-mismatch': $localize`:@@featureInventorySerials-errorRangeMismatch:range ends must differ only in their last number`,
  'range-order': $localize`:@@featureInventorySerials-errorRangeOrder:range must count upwards`,
  'too-many': $localize`:@@featureInventorySerials-errorTooMany:too many serial numbers`,
  duplicate: $localize`:@@featureInventorySerials-errorDuplicate:listed twice`,
};

/**
 * Serial number entry: one per line (or comma / semicolon separated) and ranges such as `SN-0001..SN-0050`, parsed
 * like the API does. With `available` (units at the source) every entry must match one of them; a typeahead over the
 * available units (searched locally, at most 20 shown) adds single units, all matching or all available ones.
 */
@Component({
  selector: 'framework-inventory-serial-input',
  standalone: true,
  imports: [FormsModule, FpcBadgeComponent, FpcFormControlComponent, FpcTypeaheadSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available() !== null) {
      <fpc-typeahead-select
        class="d-block mb-2"
        [inputId]="inputId() + 'Pick'"
        [listboxId]="inputId() + 'Pick-listbox'"
        [placeholder]="availablePlaceholder()"
        [openOnFocus]="true"
        [query]="pickQuery()"
        (queryChange)="onPickQuery($event)"
        [open]="pickOpen()"
        (openChange)="pickOpen.set($event)"
        (cleared)="pickQuery.set('')"
        data-testid="serial-pick"
      >
        <div fpcTypeaheadSuggestions>
          @if (remaining().length === 0) {
            <span class="dropdown-item-text text-body-secondary small">
              @if ((available() ?? []).length === 0) {
                <ng-container i18n="@@featureInventorySerials-noneAvailable">No units available here.</ng-container>
              } @else {
                <ng-container i18n="@@featureInventorySerials-allEntered"
                  >All available units are entered.</ng-container
                >
              }
            </span>
          } @else {
            @if (pickQuery().trim() && pickMatches().length > 1) {
              <button
                type="button"
                class="dropdown-item py-2 text-start"
                (mousedown)="pickMany(pickMatches(), $event)"
                data-testid="serial-pick-all-matching"
              >
                <span class="d-block small fw-medium"
                  ><i class="bi bi-plus-circle me-1" aria-hidden="true"></i
                  ><ng-container i18n="@@featureInventorySerials-allMatching"
                    >All matching ({{ pickMatches().length }})</ng-container
                  ></span
                >
              </button>
            }
            <button
              type="button"
              class="dropdown-item py-2 text-start"
              (mousedown)="pickMany(remaining(), $event)"
              data-testid="serial-add-all"
            >
              <span class="d-block small fw-medium"
                ><i class="bi bi-plus-circle-fill me-1" aria-hidden="true"></i
                ><ng-container i18n="@@featureInventorySerials-allAvailable"
                  >All available ({{ remaining().length }})</ng-container
                ></span
              >
            </button>
            @for (serial of pickShown(); track $index) {
              <button
                type="button"
                class="dropdown-item py-2 text-start"
                (mousedown)="pickMany([serial], $event)"
                data-testid="serial-pick-option"
              >
                <span class="d-block small font-monospace">{{ serial }}</span>
              </button>
            } @empty {
              @if (pickQuery().trim()) {
                <span class="dropdown-item-text text-body-secondary small" i18n="@@featureInventorySerials-noMatch"
                  >No matching units.</span
                >
              }
            }
            @if (pickMatches().length > pickShown().length) {
              <span class="dropdown-item-text text-body-secondary small" i18n="@@featureInventorySerials-more"
                >{{ pickMatches().length - pickShown().length }} more, refine the search</span
              >
            }
          }
        </div>
      </fpc-typeahead-select>
    }
    <fpc-form-control
      controlType="textarea"
      [controlId]="inputId()"
      [rows]="4"
      controlClass="font-monospace"
      [placeholder]="placeholder"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
      [name]="inputId()"
      [attr.data-testid]="testId()"
    />
    <div class="d-flex flex-wrap align-items-center gap-2 mt-1 small">
      <fpc-badge [tone]="selection().valid && count() > 0 ? 'success' : 'neutral'" size="sm" data-testid="serial-count">
        {{ countLabel() }}
      </fpc-badge>
      @if (expected() !== null && count() !== expected()) {
        <span class="text-warning-emphasis" i18n="@@featureInventorySerials-expected">{{ expected() }} expected</span>
      }
    </div>
    @if (errors().length > 0) {
      <ul class="small text-danger mb-0 mt-1 ps-3" data-testid="serial-errors">
        @for (error of errors(); track error.token) {
          <li>
            <span class="font-monospace">{{ error.token }}</span
            >: {{ error.label }}
          </li>
        }
      </ul>
    }
    @if (missing().length > 0) {
      <div class="small text-danger mt-1" data-testid="serial-missing">
        <ng-container i18n="@@featureInventorySerials-notAvailable">Not available here:</ng-container>
        <span class="font-monospace ms-1">{{ missingLabel() }}</span>
      </div>
    }
  `,
})
export class InventorySerialInputComponent {
  readonly inputId = input('inventorySerialNumbers');
  readonly testId = input('inventory-serial-input');
  /** Units the entry must match (moves out of a compartment / returns); null accepts any (putaway). */
  readonly available = input<readonly string[] | null>(null);
  /** Placeholder of the picker over `available` (e.g. units in stock at the source, or on loan). */
  readonly availablePlaceholder = input(
    $localize`:@@featureInventorySerials-pickPlaceholder:Search units in stock here, or pick all`,
  );
  /** Expected count (e.g. requested quantity); shown when the entry differs. */
  readonly expected = input<number | null>(null);
  readonly value = model('');
  readonly selectionChange = output<InventorySerialSelection>();

  readonly placeholder = $localize`:@@featureInventorySerials-placeholder:One per line, or a range like SN-0001..SN-0050`;

  private readonly parsed = computed(() =>
    parseSerialNumberInput(this.value(), { max: INVENTORY_SERIALS_PER_MOVEMENT_MAX }),
  );
  readonly count = computed(() => this.parsed().serialNumbers.length);
  readonly errors = computed(() =>
    this.parsed()
      .errors.slice(0, 10)
      .map((error) => ({ token: error.token, label: ERROR_LABELS[error.code] })),
  );
  private readonly availableSet = computed(() => {
    const available = this.available();

    return available ? new Set(available) : null;
  });
  readonly missing = computed(() => {
    const available = this.availableSet();

    return available ? this.parsed().serialNumbers.filter((serial) => !available.has(serial)) : [];
  });
  readonly missingLabel = computed(() => {
    const tokens = compressSerialNumbers(this.missing());

    return tokens.length > 8 ? `${tokens.slice(0, 8).join(', ')}, …` : tokens.join(', ');
  });
  readonly selection = computed<InventorySerialSelection>(() => {
    const parsed = this.parsed();

    return {
      serialNumbers: parsed.serialNumbers,
      tokens: parsed.serialNumbers.length > 0 ? compressSerialNumbers(parsed.serialNumbers) : [],
      valid: parsed.errors.length === 0 && this.missing().length === 0,
    };
  });
  readonly countLabel = computed(() =>
    this.count() === 1
      ? $localize`:@@featureInventorySerials-countOne:1 serial number`
      : $localize`:@@featureInventorySerials-count:${this.count()}:count: serial numbers`,
  );

  /** Picker: available units not entered yet, and those matching the search. */
  readonly pickQuery = signal('');
  readonly pickOpen = signal(false);
  readonly remaining = computed(() => {
    const available = this.available() ?? [];
    const entered = new Set(this.parsed().serialNumbers);

    return available.filter((serial) => !entered.has(serial));
  });
  readonly pickMatches = computed(() => {
    const query = this.pickQuery().trim().toLowerCase();

    return query ? this.remaining().filter((serial) => serial.toLowerCase().includes(query)) : this.remaining();
  });
  readonly pickShown = computed(() => this.pickMatches().slice(0, PICK_SHOWN));

  constructor() {
    effect(() => this.selectionChange.emit(this.selection()));
  }

  onPickQuery(value: string): void {
    this.pickQuery.set(value);
    this.pickOpen.set(true);
  }

  /** Appends the picked units (consecutive runs as ranges) and closes the picker. */
  pickMany(serials: readonly string[], event: Event): void {
    event.preventDefault();

    for (const token of compressSerialNumbers(serials)) {
      this.add(token);
    }

    this.pickQuery.set('');
    this.pickOpen.set(false);
  }

  add(token: string): void {
    const current = this.value().trim();

    this.value.set(current ? `${current}\n${token}` : token);
  }
}
