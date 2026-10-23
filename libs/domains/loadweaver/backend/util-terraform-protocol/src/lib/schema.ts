import { ctyTypeJson, type CtyType } from './cty';

/** One attribute of a provider, resource or data source schema (flat attributes only; no nested blocks). */
export interface AttributeSchema {
  name: string;
  type: CtyType;
  description: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
}

export interface BlockSchema {
  /** State schema version; bumped with an upgrade in `UpgradeResourceState`. All Loadweaver schemas are at 0. */
  version: number;
  description: string;
  attributes: AttributeSchema[];
}

const MARKDOWN = 1;

/** The object type of a block's values (what `DynamicValue`s of this schema decode to). */
export function blockType(block: BlockSchema): CtyType {
  return ['object', Object.fromEntries(block.attributes.map((a) => [a.name, a.type]))];
}

/** A `tfplugin6.Schema` message (plain object for the protobuf encoder). */
export function toProtoSchema(block: BlockSchema): Record<string, unknown> {
  for (const a of block.attributes) {
    const modes = [a.required, a.optional || a.computed].filter(Boolean).length;

    if (modes !== 1) throw new Error(`attribute ${a.name}: exactly one of required or optional / computed`);
  }

  return {
    version: block.version,
    block: {
      version: block.version,
      description: block.description,
      description_kind: MARKDOWN,
      attributes: block.attributes.map((a) => ({
        name: a.name,
        type: ctyTypeJson(a.type),
        description: a.description,
        description_kind: MARKDOWN,
        required: !!a.required,
        optional: !!a.optional,
        computed: !!a.computed,
        sensitive: !!a.sensitive,
      })),
    },
  };
}
