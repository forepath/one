import { ctyTypeJson, type CtyType } from './cty';

/**
 * One attribute of a provider, resource or data source schema. Attributes are flat or **nested attributes**
 * (tfplugin6 `nested_type`, Terraform ≥ 1.0): an object (`single`) or a list of objects (`list`) whose own attributes
 * can be required / optional, written as `disks = [{ name = "root", size = "20Gi" }]`. Nested blocks are not used.
 */
export interface AttributeSchema {
  name: string;
  /** The value type; for nested attributes the type {@link nestedAttribute} derives (checked by `toProtoSchema`). */
  type: CtyType;
  description: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
  nested?: { nesting: 'single' | 'list'; attributes: AttributeSchema[] };
}

export interface BlockSchema {
  /** State schema version; bumped with an upgrade in `UpgradeResourceState`. All Loadweaver schemas are at 0. */
  version: number;
  description: string;
  attributes: AttributeSchema[];
}

const MARKDOWN = 1;
/** `tfplugin6.Schema.Object.NestingMode`. */
const NESTING = { single: 1, list: 2 } as const;

/** The value type of nested attributes: an object of their types, or a list of such objects. */
export function nestedType(nesting: 'single' | 'list', attributes: AttributeSchema[]): CtyType {
  const object: CtyType = ['object', Object.fromEntries(attributes.map((a) => [a.name, a.type]))];

  return nesting === 'list' ? ['list', object] : object;
}

/** A nested attribute with its derived type. */
export function nestedAttribute(
  attribute: Omit<AttributeSchema, 'type' | 'nested'>,
  nesting: 'single' | 'list',
  attributes: AttributeSchema[],
): AttributeSchema {
  return { ...attribute, type: nestedType(nesting, attributes), nested: { nesting, attributes } };
}

/** The object type of a block's values (what `DynamicValue`s of this schema decode to). */
export function blockType(block: BlockSchema): CtyType {
  return ['object', Object.fromEntries(block.attributes.map((a) => [a.name, a.type]))];
}

function protoAttribute(a: AttributeSchema, path: string): Record<string, unknown> {
  const modes = [a.required, a.optional || a.computed].filter(Boolean).length;

  if (modes !== 1) throw new Error(`attribute ${path}${a.name}: exactly one of required or optional / computed`);

  const common = {
    name: a.name,
    description: a.description,
    description_kind: MARKDOWN,
    required: !!a.required,
    optional: !!a.optional,
    computed: !!a.computed,
    sensitive: !!a.sensitive,
  };

  if (!a.nested) return { ...common, type: ctyTypeJson(a.type) };

  if (JSON.stringify(a.type) !== JSON.stringify(nestedType(a.nested.nesting, a.nested.attributes)))
    throw new Error(`attribute ${path}${a.name}: type does not match its nested attributes`);

  return {
    ...common,
    nested_type: {
      attributes: a.nested.attributes.map((n) => protoAttribute(n, `${path}${a.name}.`)),
      nesting: NESTING[a.nested.nesting],
    },
  };
}

/** A `tfplugin6.Schema` message (plain object for the protobuf encoder). */
export function toProtoSchema(block: BlockSchema): Record<string, unknown> {
  const attributes = block.attributes.map((a) => protoAttribute(a, ''));

  return {
    version: block.version,
    block: {
      version: block.version,
      description: block.description,
      description_kind: MARKDOWN,
      attributes,
    },
  };
}
