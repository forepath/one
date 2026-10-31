import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcInputGroupComponent,
  FpcListEditorComponent,
  FpcListEditorItemDirective,
  type FpcListEditorLabels,
  FpcMapEditorComponent,
  type FpcMapEditorLabels,
  type FpcMapValue,
  FpcMultiSelectComponent,
  type FpcMultiSelectOption,
} from '@forepath/shared/frontend/ui-components';

import {
  asNode,
  enumLabel,
  enumOptions,
  fieldHint,
  fieldKind,
  fieldLabel,
  initialValue,
  inputTypeOf,
  itemNoun,
  itemTitle,
  properties,
  quantityUnits,
  readableMessage,
  readableValue,
  requiredKeys,
  sectionSeed,
  type SchemaFieldKind,
  type SchemaNode,
  splitDuration,
  splitQuantity,
  unitLabel,
  unitOf,
  variantIndex,
  variantSeed,
  variantsOf,
  withProperty,
} from './schema-form';
import { LoadweaverReferenceFieldComponent } from './reference-field.component';
import { REF_TEXT, referenceOf } from './reference-fields';
import { LoadweaverReferenceSource } from './reference-source';
import { SCHEMA_TEXT } from './schema-form-labels';
import { fieldChange, type SpecChange } from './spec-diff';

/** A schema problem below `spec` (path relative to `spec`), for the field it belongs to. */
export interface SchemaFieldIssue {
  path: readonly (string | number)[];
  message: string;
}

/** What the generated form can ask its host for: "Edit in YAML" of a field the form can't show. */
export interface SchemaFormHost {
  openYaml(): void;
}

export const SCHEMA_FORM_HOST = new InjectionToken<SchemaFormHost>('SCHEMA_FORM_HOST');

const SCALARS = new Set<SchemaFieldKind>([
  'text',
  'number',
  'decimal',
  'boolean',
  'enum',
  'quantity',
  'duration',
  'time',
  'portRange',
]);

function samePath(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

/**
 * One field of the generated resource form (recursive): label, hint and inline error in the form's words; objects as
 * sections, lists in `fpc-list-editor` (rows of nested fields, add / remove / reorder), maps in `fpc-map-editor`,
 * unions as "Kind of entry" + the branch's fields, enums as selects with readable options, numbers with their units.
 * Emits the field's new value (`undefined` = unset); the parent puts it into its own value.
 */
@Component({
  selector: 'loadweaver-schema-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcInputGroupComponent,
    FpcListEditorComponent,
    FpcListEditorItemDirective,
    FpcMapEditorComponent,
    FpcMultiSelectComponent,
    LoadweaverReferenceFieldComponent,
  ],
  host: {
    class: 'lw-schema-field d-block',
    '[attr.data-field]': 'pathKey()',
    '[attr.data-kind]': 'kind()',
    '[attr.data-change]': 'change()',
    '[class.lw-spec-field--added]': "change() === 'added'",
    '[class.lw-spec-field--removed]': "change() === 'removed'",
    '[class.lw-spec-field--changed]': "change() === 'changed'",
  },
  styles: `
    :host(.lw-spec-field--added),
    :host(.lw-spec-field--removed),
    :host(.lw-spec-field--changed) {
      border-left: 3px solid var(--lw-spec-change);
      padding-left: 0.5rem;
    }
    :host(.lw-spec-field--added) {
      --lw-spec-change: var(--bs-success);
    }
    :host(.lw-spec-field--removed) {
      --lw-spec-change: var(--bs-danger);
    }
    :host(.lw-spec-field--changed) {
      --lw-spec-change: var(--bs-warning);
    }
    .lw-schema-field__section {
      padding: 1rem;
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--bs-border-radius);
      background-color: var(--bs-body-bg);
    }
    .lw-schema-field__nested {
      padding-left: 0.875rem;
      border-left: 2px solid var(--bs-border-color);
    }
    .lw-schema-field__legend {
      font-size: 0.9375rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .lw-schema-field__nested > .lw-schema-field__legend {
      font-size: 0.875rem;
    }
    .lw-schema-field__switch-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .lw-schema-field__unit {
      min-width: 6.5rem;
      flex: 0 0 auto;
    }
    .lw-schema-field__unit--wide {
      min-width: 8.5rem;
    }
  `,
  template: `
    @let id = fieldId();
    @if (change(); as c) {
      <!-- Draft vs live (edit): what the field was, and a revert. -->
      <div class="d-flex align-items-center gap-1 small mb-1" [title]="liveTitle()" data-testid="spec-field-change">
        <fpc-badge size="sm" [color]="changeColor(c)">{{ changeLabel(c) }}</fpc-badge>
        <span class="text-body-secondary text-truncate">{{ liveTitle() }}</span>
        @if (!disabled()) {
          <fpc-button
            class="ms-auto"
            variant="link"
            size="sm"
            [ariaLabel]="revertFieldLabel + ': ' + label()"
            (clicked)="emit(live())"
            data-testid="spec-field-revert"
          >
            <i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>{{ revertFieldLabel }}
          </fpc-button>
        }
      </div>
    }
    @switch (kind()) {
      @case ('object') {
        <div
          [class.lw-schema-field__section]="depth() === 0 && showLabel()"
          [class.lw-schema-field__nested]="depth() > 0 && showLabel()"
          role="group"
          [attr.aria-labelledby]="showLabel() ? id + '-legend' : null"
        >
          @if (showLabel()) {
            <div class="lw-schema-field__switch-head" [class.mb-0]="toggleable() && value() === undefined">
              <div
                class="lw-schema-field__legend"
                [class.mb-0]="toggleable() && value() === undefined"
                [id]="id + '-legend'"
              >
                {{ label() }}
                @if (required()) {
                  <span class="text-danger" aria-hidden="true">*</span>
                }
              </div>
              @if (toggleable()) {
                <fpc-form-switch
                  [switchId]="id + '-on'"
                  [label]="configureLabel()"
                  [checked]="value() !== undefined"
                  [disabled]="disabled()"
                  (checkedChange)="toggleSection($event)"
                />
              }
            </div>
            @if (hint() && (!toggleable() || value() !== undefined)) {
              <p class="form-text mt-n2 mb-2">{{ hint() }}</p>
            }
          }
          @if (!toggleable() || value() !== undefined) {
            <div class="row g-3">
              @for (child of children(); track child.key) {
                <div [class]="child.wide ? 'col-12' : 'col-12 col-md-6'">
                  <loadweaver-schema-field
                    [schema]="child.schema"
                    [value]="childValue(child.key)"
                    [path]="childPath(child.key)"
                    [kindName]="kindName()"
                    [required]="child.required"
                    [issues]="issues()"
                    [disabled]="disabled()"
                    [idPrefix]="idPrefix()"
                    [depth]="depth() + 1"
                    [compare]="compare()"
                    [live]="childLive(child.key)"
                    [fallback]="childFallback(child.key)"
                    (valueChange)="setChild(child.key, child.required, $event)"
                  />
                </div>
              }
            </div>
          }
          @for (message of ownErrors(); track $index) {
            <p class="invalid-feedback d-block mb-0 mt-2" role="alert">{{ message }}</p>
          }
        </div>
      }
      @case ('variants') {
        <div
          [class.lw-schema-field__section]="depth() === 0 && showLabel()"
          [class.lw-schema-field__nested]="depth() > 0 && showLabel()"
          role="group"
          [attr.aria-labelledby]="showLabel() ? id + '-legend' : null"
        >
          @if (showLabel()) {
            <div class="lw-schema-field__legend" [id]="id + '-legend'">{{ label() }}</div>
          }
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <fpc-form-field class="mb-0" [forId]="id + '-variant'" [label]="variantLabel" [required]="true">
                <fpc-form-control
                  controlType="select"
                  [controlId]="id + '-variant'"
                  [disabled]="disabled()"
                  [ngModel]="'' + variant()"
                  (ngModelChange)="chooseVariant(+$event)"
                  data-testid="schema-field-variant"
                >
                  @for (v of variants(); track v.index) {
                    <option [value]="'' + v.index">{{ v.label }}</option>
                  }
                </fpc-form-control>
              </fpc-form-field>
            </div>
            @for (child of variantChildren(); track child.key) {
              <div [class]="child.wide ? 'col-12' : 'col-12 col-md-6'">
                <loadweaver-schema-field
                  [schema]="child.schema"
                  [value]="childValue(child.key)"
                  [path]="childPath(child.key)"
                  [kindName]="kindName()"
                  [required]="child.required"
                  [issues]="issues()"
                  [disabled]="disabled()"
                  [idPrefix]="idPrefix()"
                  [depth]="depth() + 1"
                  [compare]="compare()"
                  [live]="childLive(child.key)"
                  [fallback]="childFallback(child.key)"
                  (valueChange)="setChild(child.key, child.required, $event)"
                />
              </div>
            }
          </div>
        </div>
      }
      @case ('list') {
        <fpc-list-editor
          [label]="showLabel() ? label() : null"
          [ariaLabel]="label()"
          [hint]="hint()"
          [required]="required()"
          [items]="listValue()"
          (itemsChange)="emit($event)"
          [newItem]="newItem"
          [itemLabel]="rowTitle"
          [addLabel]="addLabel()"
          [min]="minItems()"
          [max]="maxItems()"
          [layout]="itemsAreScalar() ? 'inline' : 'card'"
          [disabled]="disabled()"
          [labels]="listLabels"
          [attr.data-testid]="'schema-list-' + pathKey()"
        >
          <ng-template fpcListEditorItem let-item let-i="index">
            <loadweaver-schema-field
              [schema]="itemSchema()"
              [value]="item"
              [path]="childPath(i)"
              [kindName]="kindName()"
              [required]="true"
              [showLabel]="false"
              [rowLabel]="rowTitle(item, i)"
              [issues]="issues()"
              [disabled]="disabled()"
              [idPrefix]="idPrefix()"
              [depth]="depth() + 1"
              (valueChange)="setItem(i, $event)"
            />
          </ng-template>
        </fpc-list-editor>
        @for (message of ownErrors(); track $index) {
          <p class="invalid-feedback d-block mb-0" role="alert">{{ message }}</p>
        }
      }
      @case ('multiEnum') {
        <fpc-form-field
          class="mb-0"
          [forId]="id"
          [label]="label()"
          [required]="required()"
          [hint]="hint()"
          [error]="error()"
        >
          <fpc-multi-select
            [controlId]="id"
            [ariaLabel]="label()"
            [options]="multiOptions()"
            [value]="stringList()"
            (valueChange)="setMulti($event)"
            [disabled]="disabled()"
            [removeLabel]="removeOptionLabel"
          />
        </fpc-form-field>
      }
      @case ('map') {
        <fpc-map-editor
          [label]="label()"
          [hint]="hint()"
          [required]="required()"
          [value]="mapValue()"
          (valueChange)="emit($event)"
          [valueType]="mapValueType()"
          [keyPattern]="mapKeyPattern()"
          [valuePattern]="mapValuePattern()"
          [disabled]="disabled()"
          [labels]="mapLabels"
          [attr.data-testid]="'schema-map-' + pathKey()"
        />
        @for (message of ownErrors(); track $index) {
          <p class="invalid-feedback d-block mb-0" role="alert">{{ message }}</p>
        }
      }
      @case ('tuple') {
        <div role="group" [attr.aria-label]="label()">
          <div class="form-label">{{ label() }}</div>
          <div class="row g-2">
            @for (part of tupleParts(); track $index) {
              <div class="col-6">
                <fpc-form-field class="mb-0" [forId]="id + '-' + $index" [label]="$index === 0 ? rangeFrom : rangeTo">
                  <fpc-form-control
                    [controlId]="id + '-' + $index"
                    inputType="number"
                    [min]="part.min"
                    [max]="part.max"
                    [disabled]="disabled()"
                    [ngModel]="part.value"
                    [placeholder]="part.placeholder"
                    (ngModelChange)="setTuple($index, $event)"
                  />
                </fpc-form-field>
              </div>
            }
          </div>
          @if (error()) {
            <p class="invalid-feedback d-block mb-0" role="alert">{{ error() }}</p>
          }
        </div>
      }
      @case ('boolean') {
        <fpc-form-field class="mb-0" [hint]="hint()" [error]="error()">
          <fpc-form-switch
            [switchId]="id"
            [label]="label()"
            [checked]="value() === undefined ? defaultBoolean() : !!value()"
            [disabled]="disabled()"
            (checkedChange)="emit($event)"
          />
        </fpc-form-field>
      }
      @case ('unsupported') {
        <div class="small text-body-secondary" data-testid="schema-field-yaml-only">
          <span class="fw-semibold me-1">{{ label() }}:</span>{{ yamlOnlyLabel }}
          @if (host) {
            <fpc-button variant="link" size="sm" (clicked)="host.openYaml()">{{ openYamlLabel }}</fpc-button>
          }
        </div>
      }
      @default {
        <fpc-form-field
          class="mb-0"
          [forId]="id"
          [label]="showLabel() ? label() : null"
          [required]="required() && showLabel()"
          [hint]="showLabel() ? hint() : null"
          [error]="error()"
        >
          @switch (kind()) {
            @case ('enum') {
              <fpc-form-control
                controlType="select"
                [controlId]="id"
                [ariaLabel]="showLabel() ? null : label()"
                [disabled]="disabled()"
                [invalid]="!!error()"
                [ngModel]="enumIndex()"
                (ngModelChange)="setEnum($event)"
              >
                @if (!required() || enumIndex() === '') {
                  <option value="">{{ emptyOptionLabel() }}</option>
                }
                @for (option of options(); track $index) {
                  <option [value]="'' + $index">{{ optionLabel(option) }}</option>
                }
              </fpc-form-control>
            }
            @case ('textarea') {
              <fpc-form-control
                controlType="textarea"
                [controlId]="id"
                [ariaLabel]="showLabel() ? null : label()"
                [rows]="key() === 'description' ? 2 : 5"
                [disabled]="disabled()"
                [invalid]="!!error()"
                [controlClass]="key() === 'description' ? null : 'font-monospace small'"
                [ngModel]="textValue()"
                (ngModelChange)="setText($event)"
              />
            }
            @case ('code') {
              <fpc-code-editor
                [value]="textValue()"
                language="yaml"
                height="16rem"
                [readOnly]="disabled()"
                (valueChange)="setText($event)"
                [attr.aria-label]="label()"
              />
            }
            @case ('quantity') {
              @let q = quantity();
              <fpc-input-group>
                <fpc-form-control
                  [controlId]="id"
                  [ariaLabel]="showLabel() ? null : label()"
                  inputType="number"
                  min="0"
                  step="any"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  [ngModel]="q.amount"
                  [placeholder]="q.placeholder"
                  (ngModelChange)="setQuantity($event, q.suffix)"
                />
                <fpc-form-control
                  fpcInputGroupSuffix
                  class="lw-schema-field__unit"
                  controlType="select"
                  [controlId]="id + '-unit'"
                  [disabled]="disabled()"
                  [ngModel]="q.suffix"
                  (ngModelChange)="setQuantity(q.amount, $event)"
                  [attr.aria-label]="unitWord + ': ' + label()"
                >
                  @for (u of quantityUnitList(); track u.suffix) {
                    <option [value]="u.suffix">{{ u.label }}</option>
                  }
                </fpc-form-control>
              </fpc-input-group>
            }
            @case ('duration') {
              @let d = duration();
              <fpc-input-group>
                <fpc-form-control
                  [controlId]="id"
                  [ariaLabel]="showLabel() ? null : label()"
                  inputType="number"
                  min="0"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  [ngModel]="d.amount"
                  [placeholder]="durationDefault()"
                  (ngModelChange)="setDuration($event, d.unit)"
                />
                <fpc-form-control
                  fpcInputGroupSuffix
                  class="lw-schema-field__unit lw-schema-field__unit--wide"
                  controlType="select"
                  [controlId]="id + '-unit'"
                  [disabled]="disabled()"
                  [ngModel]="d.unit"
                  (ngModelChange)="setDuration(d.amount, $event)"
                  [attr.aria-label]="unitWord + ': ' + label()"
                >
                  @for (u of durationUnits; track u.unit) {
                    <option [value]="u.unit">{{ u.label }}</option>
                  }
                </fpc-form-control>
              </fpc-input-group>
            }
            @case ('time') {
              <fpc-form-control
                [controlId]="id"
                [ariaLabel]="showLabel() ? null : label()"
                inputType="time"
                [disabled]="disabled()"
                [invalid]="!!error()"
                [ngModel]="textValue()"
                (ngModelChange)="setText($event)"
              />
            }
            @case ('number') {
              @if (unit(); as u) {
                <fpc-input-group>
                  <fpc-form-control
                    [controlId]="id"
                    [ariaLabel]="showLabel() ? null : label()"
                    inputType="number"
                    [min]="minimum()"
                    [max]="maximum()"
                    [disabled]="disabled()"
                    [invalid]="!!error()"
                    [ngModel]="numberText()"
                    (ngModelChange)="setNumber($event)"
                    [placeholder]="defaultText()"
                  />
                  <span fpcInputGroupSuffix class="input-group-text">{{ u }}</span>
                </fpc-input-group>
              } @else {
                <fpc-form-control
                  [controlId]="id"
                  [ariaLabel]="showLabel() ? null : label()"
                  inputType="number"
                  [min]="minimum()"
                  [max]="maximum()"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  [ngModel]="numberText()"
                  (ngModelChange)="setNumber($event)"
                  [placeholder]="defaultText()"
                />
              }
            }
            @case ('decimal') {
              <fpc-input-group>
                <fpc-form-control
                  [controlId]="id"
                  [ariaLabel]="showLabel() ? null : label()"
                  inputType="number"
                  min="0"
                  step="0.05"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  [ngModel]="textValue()"
                  (ngModelChange)="setText($event === null || $event === undefined ? '' : '' + $event)"
                  [placeholder]="defaultText()"
                />
                <span fpcInputGroupSuffix class="input-group-text">{{ unit() }}</span>
              </fpc-input-group>
            }
            @case ('portRange') {
              <fpc-form-control
                [controlId]="id"
                [ariaLabel]="showLabel() ? null : label()"
                [disabled]="disabled()"
                [invalid]="!!error()"
                [placeholder]="'443 / 8000-8100'"
                [ngModel]="textValue()"
                (ngModelChange)="setPortRange($event)"
              />
            }
            @default {
              @if (reference(); as ref) {
                <!-- A reference to another object (2026-10-29): a typeahead over what the caller may see. -->
                <loadweaver-reference-field
                  [target]="ref"
                  [value]="value()"
                  [controlId]="id"
                  [ariaLabel]="label()"
                  [placeholder]="defaultText() || null"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  (valueChange)="setText($event)"
                />
              } @else {
                <fpc-form-control
                  [controlId]="id"
                  [ariaLabel]="showLabel() ? null : label()"
                  [inputType]="inputType()"
                  [disabled]="disabled()"
                  [invalid]="!!error()"
                  [placeholder]="defaultText()"
                  [ngModel]="textValue()"
                  (ngModelChange)="setText($event)"
                />
              }
            }
          }
        </fpc-form-field>
      }
    }
  `,
})
export class LoadweaverSchemaFieldComponent {
  protected readonly host = inject(SCHEMA_FORM_HOST, { optional: true });
  private readonly references = inject(LoadweaverReferenceSource, { optional: true });

  readonly schema = input<SchemaNode>({});
  readonly value = input<unknown>(undefined);
  /** The field's path below `spec` (labels, ids, its problems). */
  readonly path = input<readonly (string | number)[]>([]);
  /** The resource kind (per-kind labels). */
  readonly kindName = input('');
  readonly required = input(false);
  /** Field label shown (false: rows of a scalar list, the row is labelled by the list). */
  readonly showLabel = input(true);
  /** The accessible name of an unlabelled list row. */
  readonly rowLabel = input<string | null>(null);
  readonly issues = input<readonly SchemaFieldIssue[]>([]);
  readonly disabled = input(false);
  readonly idPrefix = input('lw-schema-');
  readonly depth = input(0);
  /** Edit: compare with the live value (per-field Draft vs live). */
  readonly compare = input(false);
  /** The live value of this field (with `compare`). */
  readonly live = input<unknown>(undefined);
  /** The default from the enclosing object's default (`check: {protocol: https}` → protocol's placeholder). */
  readonly fallback = input<unknown>(undefined);

  readonly valueChange = output<unknown>();

  readonly key = computed(() => {
    const path = this.path();

    for (let i = path.length - 1; i >= 0; i--) if (typeof path[i] === 'string') return path[i] as string;

    return '';
  });
  readonly kind = computed(() => fieldKind(this.schema(), this.key()));
  readonly pathKey = computed(() => this.path().join('.'));
  readonly fieldId = computed(() => `${this.idPrefix()}${this.path().join('-') || 'spec'}`);
  readonly label = computed(() => this.rowLabel() ?? fieldLabel(this.path(), this.kindName()));
  /** The object this field names, when it is a reference (only inside a form that provides the suggestions). */
  readonly reference = computed(() =>
    this.references ? referenceOf(this.kindName(), this.path(), this.schema()) : null,
  );
  readonly hint = computed(() =>
    this.reference()?.type === 'secret' ? REF_TEXT.secretHint : fieldHint(this.key(), this.schema()),
  );

  /** Problems at this field (and "missing" reports of it at its parent). */
  readonly errors = computed(() => {
    const path = this.path();
    const parent = path.slice(0, -1);
    const key = path.at(-1);

    return this.issues()
      .filter(
        (issue) =>
          samePath(issue.path, path) ||
          (typeof key === 'string' && samePath(issue.path, parent) && issue.message === `missing property "${key}"`),
      )
      .map((issue) => {
        const value = this.value();

        // An empty required field is "Required", whatever pattern it misses.
        return this.required() && (value === '' || value === undefined)
          ? SCHEMA_TEXT.errRequired
          : readableMessage(issue.message);
      });
  });
  readonly error = computed(() => this.errors()[0] ?? null);
  /** Draft vs live of leaves, lists and maps (sections show it at their fields). */
  readonly change = computed<SpecChange | null>(() =>
    this.compare() && this.kind() !== 'object' && this.kind() !== 'variants'
      ? fieldChange(this.live(), this.value())
      : null,
  );
  readonly liveTitle = computed(() => {
    const live = this.live();

    return `${this.liveValueLabel}: ${live === undefined ? this.notSetLiveLabel : readableValue(this.schema(), live, this.key())}`;
  });
  readonly revertFieldLabel = $localize`:@@lwConsoleSpecDiff-revertField:Revert field`;
  readonly liveValueLabel = $localize`:@@lwConsoleSpecDiff-liveValue:Live`;
  readonly notSetLiveLabel = $localize`:@@lwConsoleSpecDiff-notSet:(not set)`;
  private readonly changeLabels: Record<SpecChange, string> = {
    added: $localize`:@@lwConsoleSpecDiff-added:Added`,
    removed: $localize`:@@lwConsoleSpecDiff-removed:Removed`,
    changed: $localize`:@@lwConsoleSpecDiff-changed:Changed`,
  };
  /** Own problems of containers (objects / lists / maps): missing children show at the child instead. */
  readonly ownErrors = computed(() => {
    const path = this.path();

    return this.issues()
      .filter((issue) => samePath(issue.path, path) && !issue.message.startsWith('missing property'))
      .map((issue) => readableMessage(issue.message));
  });

  // Objects ---------------------------------------------------------------------------------------------------
  readonly children = computed(() => this.childrenOf(this.schema()));
  /** An optional section with required fields: a switch adds it (prefilled) or removes it. */
  readonly toggleable = computed(() => !this.required() && this.depth() >= 0 && requiredKeys(this.schema()).length > 0);
  readonly configureLabel = computed(() => SCHEMA_TEXT.configure.replace('{label}', this.label()));

  // Unions ----------------------------------------------------------------------------------------------------
  readonly variants = computed(() => variantsOf(this.schema()));
  readonly variant = computed(() => variantIndex(this.schema(), this.value()));
  readonly variantChildren = computed(() => {
    const branch = this.variants()[this.variant()];

    // The discriminant (`type: s3`) is the select itself.
    return branch ? this.childrenOf(branch.schema).filter((c) => c.schema['const'] === undefined) : [];
  });

  // Lists -----------------------------------------------------------------------------------------------------
  readonly itemSchema = computed(() => asNode(this.schema()['items']));
  readonly itemsAreScalar = computed(
    () =>
      SCALARS.has(fieldKind(this.itemSchema(), this.key())) || fieldKind(this.itemSchema(), this.key()) === 'textarea',
  );
  readonly listValue = computed(() => (Array.isArray(this.value()) ? (this.value() as unknown[]) : []));
  readonly minItems = computed(() =>
    typeof this.schema()['minItems'] === 'number' ? (this.schema()['minItems'] as number) : 0,
  );
  readonly maxItems = computed(() =>
    typeof this.schema()['maxItems'] === 'number' ? (this.schema()['maxItems'] as number) : null,
  );
  readonly addLabel = computed(() => SCHEMA_TEXT.add.replace('{label}', itemNoun(this.key())));
  readonly newItem = () => initialValue(this.itemSchema(), this.key()) ?? '';
  readonly rowTitle = (item: unknown, index: number): string => {
    const title = itemTitle(item);

    return `${itemNoun(this.key())} ${index + 1}${title ? ' · ' + title : ''}`;
  };
  readonly listLabels: Partial<FpcListEditorLabels> = {
    remove: SCHEMA_TEXT.remove,
    moveUp: SCHEMA_TEXT.moveUp,
    moveDown: SCHEMA_TEXT.moveDown,
    empty: SCHEMA_TEXT.empty,
    added: SCHEMA_TEXT.added,
    removed: SCHEMA_TEXT.removed,
    moved: SCHEMA_TEXT.moved,
  };

  // Enums / multi-enums ---------------------------------------------------------------------------------------
  readonly options = computed(() => enumOptions(this.schema()));
  readonly enumIndex = computed(() => {
    const value = this.value();
    const index = value === undefined ? -1 : this.options().findIndex((o) => o === value);

    return index >= 0 ? String(index) : '';
  });
  readonly multiOptions = computed<FpcMultiSelectOption[]>(() =>
    enumOptions(this.itemSchema()).map((o) => ({ value: String(o), label: enumLabel(o) })),
  );
  readonly stringList = computed(() => this.listValue().map(String));

  // Maps ------------------------------------------------------------------------------------------------------
  readonly mapValue = computed(() => {
    const value = this.value();

    return (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as FpcMapValue;
  });
  readonly mapValueType = computed(() => {
    const kind = asNode(this.schema()['additionalProperties'])['type'];

    return kind === 'integer' || kind === 'number' ? 'number' : 'text';
  });
  readonly mapKeyPattern = computed(
    () => (asNode(this.schema()['propertyNames'])['pattern'] as string | undefined) ?? null,
  );
  readonly mapValuePattern = computed(
    () => (asNode(this.schema()['additionalProperties'])['pattern'] as string | undefined) ?? null,
  );
  readonly mapLabels: Partial<FpcMapEditorLabels> = {
    key: SCHEMA_TEXT.mapKey,
    value: SCHEMA_TEXT.mapValue,
    add: SCHEMA_TEXT.mapAdd,
    remove: SCHEMA_TEXT.mapRemove,
    empty: SCHEMA_TEXT.empty,
    duplicate: SCHEMA_TEXT.mapDuplicate,
    invalidKey: SCHEMA_TEXT.mapInvalidKey,
    invalidValue: SCHEMA_TEXT.mapInvalidValue,
    requiredKey: SCHEMA_TEXT.mapRequiredKey,
  };

  // Tuples ----------------------------------------------------------------------------------------------------
  readonly tupleParts = computed(() => {
    const parts = (this.schema()['prefixItems'] as unknown[] | undefined) ?? [];
    const value = this.listValue();

    return parts.map((p, index) => ({
      min: (asNode(p)['minimum'] as number | undefined) ?? null,
      max: (asNode(p)['maximum'] as number | undefined) ?? null,
      value: value[index] ?? '',
      placeholder: Array.isArray(this.effectiveDefault())
        ? String((this.effectiveDefault() as unknown[])[index] ?? '')
        : '',
    }));
  });

  // Scalars ---------------------------------------------------------------------------------------------------
  readonly unit = computed(() => {
    const unit = unitOf(this.key(), this.kind());

    return unit ? unitLabel(unit) : null;
  });
  readonly minimum = computed(() => (this.schema()['minimum'] as number | undefined) ?? null);
  readonly maximum = computed(() => {
    const max = this.schema()['maximum'];

    return typeof max === 'number' && max < Number.MAX_SAFE_INTEGER ? max : null;
  });
  /** The default that applies while unset: the schema's, else the one of the enclosing object's default. */
  readonly effectiveDefault = computed(() => this.schema()['default'] ?? this.fallback());
  readonly emptyOptionLabel = computed(() => {
    const d = this.effectiveDefault();

    if (d !== undefined) return SCHEMA_TEXT.defaultOption.replace('{value}', enumLabel(d));

    return this.required() ? this.chooseLabel : this.notSetLabel;
  });
  readonly defaultText = computed(() => {
    const d = this.effectiveDefault();

    return d === undefined || typeof d === 'object' ? '' : String(d);
  });
  readonly defaultBoolean = computed(() => this.effectiveDefault() === true);
  readonly textValue = computed(() => {
    const value = this.value();

    return value === undefined || value === null ? '' : String(value);
  });
  readonly numberText = computed(() => {
    const value = this.value();

    return typeof value === 'number' ? value : '';
  });
  readonly inputType = computed(() => inputTypeOf(this.schema()));
  readonly quantityUnitList = computed(() => quantityUnits(this.schema()));
  readonly quantity = computed(() => {
    const value = this.value();
    const { amount, suffix } = splitQuantity(value === undefined ? this.effectiveDefault() : value);
    const units = this.quantityUnitList();

    return {
      amount: value === undefined ? '' : amount,
      placeholder: value === undefined ? amount : '',
      suffix: units.some((u) => u.suffix === suffix) ? suffix : (units[1] ?? units[0]).suffix,
    };
  });
  readonly duration = computed(() => {
    const value = this.value();

    // Unset: the unit of the default (`5m` → minutes).
    return value === undefined
      ? { amount: '', unit: splitDuration(this.effectiveDefault()).unit }
      : splitDuration(value);
  });
  readonly durationDefault = computed(() => splitDuration(this.effectiveDefault()).amount);
  readonly durationUnits = [
    { unit: 's', label: SCHEMA_TEXT.unitDurS },
    { unit: 'm', label: SCHEMA_TEXT.unitDurM },
    { unit: 'h', label: SCHEMA_TEXT.unitDurH },
    { unit: 'd', label: SCHEMA_TEXT.unitDurD },
  ];

  readonly variantLabel = SCHEMA_TEXT.variant;
  readonly chooseLabel = SCHEMA_TEXT.choose;
  readonly notSetLabel = SCHEMA_TEXT.notSet;
  readonly yamlOnlyLabel = SCHEMA_TEXT.yamlOnly;
  readonly openYamlLabel = SCHEMA_TEXT.openYaml;
  readonly rangeFrom = SCHEMA_TEXT.rangeFrom;
  readonly rangeTo = SCHEMA_TEXT.rangeTo;
  readonly unitWord = SCHEMA_TEXT.unitLabel;
  readonly removeOptionLabel = SCHEMA_TEXT.remove;

  private childrenOf(schema: SchemaNode): { key: string; schema: SchemaNode; required: boolean; wide: boolean }[] {
    const required = requiredKeys(schema);

    return Object.entries(properties(schema)).map(([key, child]) => {
      const kind = fieldKind(child, key);

      // Secret references are two inputs (project + name): a full row.
      const secret = referenceOf(this.kindName(), this.childPath(key), child)?.type === 'secret';

      return { key, schema: child, required: required.includes(key), wide: !SCALARS.has(kind) || secret };
    });
  }

  childValue(key: string): unknown {
    const value = this.value();

    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }

  /** A child's default from this object's own default (only while this object's value doesn't set it). */
  childFallback(key: string): unknown {
    const d = this.effectiveDefault();

    return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>)[key] : undefined;
  }

  childLive(key: string): unknown {
    const live = this.live();

    return typeof live === 'object' && live !== null && !Array.isArray(live)
      ? (live as Record<string, unknown>)[key]
      : undefined;
  }

  changeLabel(change: SpecChange): string {
    return this.changeLabels[change];
  }

  changeColor(change: SpecChange): 'success' | 'danger' | 'warning' {
    return change === 'added' ? 'success' : change === 'removed' ? 'danger' : 'warning';
  }

  childPath(part: string | number): (string | number)[] {
    return [...this.path(), part];
  }

  optionLabel(option: unknown): string {
    return enumLabel(option);
  }

  emit(value: unknown): void {
    this.valueChange.emit(value);
  }

  setChild(key: string, required: boolean, value: unknown): void {
    this.emit(withProperty(this.value(), key, value, required));
  }

  /**
   * "Set up …" on an optional section: its start value with every required key present (an empty text where it has no
   * other start), so the section stays in the document and its fields show "Required" until filled — an all-text
   * section (remote access, ingress) would otherwise start as `{}`, count as unset and vanish again (2026-10-29).
   */
  toggleSection(on: boolean): void {
    this.emit(on ? sectionSeed(this.schema(), this.key()) : undefined);
  }

  chooseVariant(index: number): void {
    const branch = this.variants()[index];

    if (branch) this.emit(variantSeed(branch.schema, this.key()));
  }

  setItem(index: number, value: unknown): void {
    const next = [...this.listValue()];

    next[index] = value === undefined ? (initialValue(this.itemSchema(), this.key()) ?? '') : value;
    this.emit(next);
  }

  setMulti(values: readonly string[]): void {
    const options = enumOptions(this.itemSchema());

    this.emit(options.filter((o) => values.includes(String(o))));
  }

  setTuple(index: number, raw: unknown): void {
    const next = [...this.listValue()];

    next[index] = raw === '' || raw === null || raw === undefined ? undefined : Number(raw);
    this.emit(next.every((v) => v === undefined) ? undefined : next);
  }

  setEnum(index: string): void {
    this.emit(index === '' ? undefined : this.options()[Number(index)]);
  }

  setText(text: unknown): void {
    const value = text === null || text === undefined ? '' : String(text);

    this.emit(value === '' ? undefined : value);
  }

  setNumber(raw: unknown): void {
    if (raw === '' || raw === null || raw === undefined) {
      this.emit(undefined);

      return;
    }

    const number = Number(raw);

    this.emit(Number.isFinite(number) ? number : undefined);
  }

  setQuantity(amount: unknown, suffix: string): void {
    const text = amount === null || amount === undefined ? '' : String(amount).trim();

    this.emit(text === '' ? undefined : `${text}${suffix}`);
  }

  setDuration(amount: unknown, unit: string): void {
    const text = amount === null || amount === undefined ? '' : String(amount).trim();

    this.emit(text === '' ? undefined : `${Math.max(0, Math.round(Number(text)))}${unit}`);
  }

  setPortRange(text: unknown): void {
    const value = String(text ?? '').trim();

    this.emit(value === '' ? undefined : /^\d+$/.test(value) ? Number(value) : value);
  }
}
