import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model } from '@angular/core';
import type { JsonSchema } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcAlertComponent } from '@forepath/shared/frontend/ui-components';

import { documentProject } from './reference-fields';
import { LoadweaverReferenceSource } from './reference-source';
import { LoadweaverSchemaFieldComponent, type SchemaFieldIssue } from './schema-field.component';
import {
  fieldKind,
  formSpec,
  properties,
  requiredKeys,
  type SchemaNode,
  specSchema,
  withFormSpec,
  withProperty,
} from './schema-form';
import { SCHEMA_TEXT } from './schema-form-labels';

/** A step's part of a spec schema: only `keys` (a union at the spec root stays whole). */
export function stepSchema(spec: SchemaNode, keys: readonly string[]): SchemaNode {
  if (fieldKind(spec) === 'variants') return spec;

  const props = properties(spec);
  const own = keys.filter((k) => k in props);

  return {
    type: 'object',
    properties: Object.fromEntries(own.map((k) => [k, props[k]])),
    required: requiredKeys(spec).filter((k) => own.includes(k)),
  };
}

/**
 * The generated form of one wizard step (2026-10-29): the step's spec fields from the kind's JSON Schema, edited in
 * place in the YAML text (`[(text)]`, a minimal patch — comments and other fields stay). Problems of the document
 * (`issues`, paths below `spec`) show at their fields.
 */
@Component({
  selector: 'loadweaver-schema-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcAlertComponent, LoadweaverSchemaFieldComponent],
  // Reference fields (2026-10-29) suggest the objects of the edited resource's project.
  providers: [LoadweaverReferenceSource],
  template: `
    @if (spec() === null) {
      <fpc-alert variant="warning" [message]="brokenLabel" data-testid="schema-form-broken" />
    } @else if (schemaNode(); as node) {
      <loadweaver-schema-field
        [schema]="node"
        [value]="spec()"
        [path]="[]"
        [kindName]="kindName()"
        [required]="true"
        [showLabel]="false"
        [issues]="issues()"
        [disabled]="disabled()"
        [idPrefix]="idPrefix()"
        [depth]="-1"
        [compare]="liveSpec() !== null"
        [live]="liveSpec()"
        (valueChange)="apply($event)"
        data-testid="schema-form"
      />
    }
  `,
})
export class LoadweaverSchemaFormComponent {
  /** The YAML document (two-way). */
  readonly text = model('');
  /** The kind's envelope schema (`GET /schemas/{kind}`). */
  readonly schema = input<JsonSchema | null>(null);
  /** The spec keys of this step. */
  readonly keys = input<readonly string[]>([]);
  readonly kindName = input('');
  readonly issues = input<readonly SchemaFieldIssue[]>([]);
  readonly disabled = input(false);
  readonly idPrefix = input('lw-schema-');
  /** The live document (edit: per-field Draft vs live); null = a new resource. */
  readonly live = input<string | null>(null);

  private readonly references = inject(LoadweaverReferenceSource);
  /** `metadata.project` of the document: reference suggestions of project-scoped kinds come from it. */
  readonly project = computed(() => documentProject(this.text()));

  constructor() {
    effect(() => this.references.project.set(this.project()));
  }

  readonly brokenLabel = SCHEMA_TEXT.yamlBroken;
  readonly spec = computed(() => formSpec(this.text()));
  readonly liveSpec = computed(() => {
    const live = this.live();

    return live === null ? null : formSpec(live);
  });
  readonly schemaNode = computed(() => {
    const spec = specSchema(this.schema());

    return spec ? stepSchema(spec, this.keys()) : null;
  });

  /** A step's new value into the spec (only this step's keys change) and the spec into the YAML text. */
  apply(stepValue: unknown): void {
    const spec = specSchema(this.schema());
    const current = this.spec();

    if (!spec || current === null) return;

    let next: unknown;

    if (fieldKind(spec) === 'variants') {
      next = stepValue ?? {};
    } else {
      const own = (stepValue ?? {}) as Record<string, unknown>;
      const required = requiredKeys(spec);

      next = this.keys().reduce<Record<string, unknown>>(
        (acc, key) => withProperty(acc, key, own[key], required.includes(key)),
        { ...(current as Record<string, unknown>) },
      );
    }

    this.text.set(withFormSpec(this.text(), next));
  }
}
