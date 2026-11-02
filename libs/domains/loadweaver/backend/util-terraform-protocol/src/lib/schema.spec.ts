import { blockType, nestedAttribute, toProtoSchema, type BlockSchema } from './schema';
import { protocolRoot, roundTrip, serviceDefinition } from './protos';

const BLOCK: BlockSchema = {
  version: 0,
  description: 'A thing',
  attributes: [
    { name: 'id', type: 'string', computed: true, description: 'ID' },
    { name: 'name', type: 'string', required: true, description: 'Name' },
    { name: 'labels', type: ['map', 'string'], optional: true, description: 'Labels' },
    { name: 'token', type: 'string', optional: true, sensitive: true, description: 'Secret' },
  ],
};

describe('schema conversion', () => {
  it('derives the object type of a block', () => {
    expect(blockType(BLOCK)).toEqual([
      'object',
      { id: 'string', name: 'string', labels: ['map', 'string'], token: 'string' },
    ]);
  });

  it('builds tfplugin6 schemas that survive the protobuf encoding', () => {
    const schema = toProtoSchema(BLOCK);
    const decoded = roundTrip('tfplugin6.GetProviderSchema.Response', {
      provider: schema,
      resource_schemas: { thing: schema },
      server_capabilities: { plan_destroy: true },
    }) as { provider: { block: { attributes: Record<string, unknown>[] } }; resource_schemas: Record<string, unknown> };
    const attributes = decoded.provider.block.attributes;

    expect(attributes.map((a) => a['name'])).toEqual(['id', 'name', 'labels', 'token']);
    expect(Buffer.from(attributes[2]['type'] as Uint8Array).toString()).toBe('["map","string"]');
    expect(attributes[0]).toMatchObject({ computed: true });
    expect(attributes[1]).toMatchObject({ required: true });
    expect(attributes[3]).toMatchObject({ optional: true, sensitive: true });
    expect(Object.keys(decoded.resource_schemas)).toEqual(['thing']);
  });

  it('refuses attributes that are neither required nor optional / computed (or both)', () => {
    expect(() => toProtoSchema({ ...BLOCK, attributes: [{ name: 'x', type: 'string', description: '' }] })).toThrow(
      'exactly one',
    );
    expect(() =>
      toProtoSchema({
        ...BLOCK,
        attributes: [{ name: 'x', type: 'string', required: true, optional: true, description: '' }],
      }),
    ).toThrow('exactly one');
  });
});

describe('nested attributes', () => {
  const disks = nestedAttribute({ name: 'disks', required: true, description: 'Disks' }, 'list', [
    { name: 'name', type: 'string', required: true, description: 'Name' },
    { name: 'replicas', type: 'number', optional: true, description: 'Copies' },
  ]);
  const cloudInit = nestedAttribute({ name: 'cloud_init', optional: true, description: 'Seed' }, 'single', [
    { name: 'keys', type: ['list', 'string'], optional: true, description: 'Keys' },
  ]);

  it('derive their value type (list of objects / object)', () => {
    expect(disks.type).toEqual(['list', ['object', { name: 'string', replicas: 'number' }]]);
    expect(blockType({ ...BLOCK, attributes: [disks, cloudInit] })).toEqual([
      'object',
      {
        disks: ['list', ['object', { name: 'string', replicas: 'number' }]],
        cloud_init: ['object', { keys: ['list', 'string'] }],
      },
    ]);
  });

  it('become nested_type attributes that survive the protobuf encoding', () => {
    const decoded = roundTrip('tfplugin6.Schema', toProtoSchema({ ...BLOCK, attributes: [disks, cloudInit] })) as {
      block: { attributes: Record<string, unknown>[] };
    };
    const [list, single] = decoded.block.attributes;

    expect(list['type']).toBeUndefined();
    expect(list).toMatchObject({ name: 'disks', required: true, nested_type: { nesting: 2 } });
    expect((list['nested_type'] as { attributes: Record<string, unknown>[] }).attributes).toMatchObject([
      { name: 'name', required: true },
      { name: 'replicas', optional: true },
    ]);
    expect(single).toMatchObject({ name: 'cloud_init', optional: true, nested_type: { nesting: 1 } });
  });

  it('refuse a type that does not match and invalid modes inside', () => {
    expect(() => toProtoSchema({ ...BLOCK, attributes: [{ ...disks, type: 'string' }] })).toThrow('does not match');
    expect(() =>
      toProtoSchema({
        ...BLOCK,
        attributes: [
          nestedAttribute({ name: 'n', optional: true, description: '' }, 'single', [
            { name: 'x', type: 'string', description: '' },
          ]),
        ],
      }),
    ).toThrow('n.x: exactly one');
  });
});

describe('vendored protocol definitions', () => {
  it('load tfplugin6 and the go-plugin services', () => {
    expect(
      protocolRoot()
        .lookupType('tfplugin6.DynamicValue')
        .fieldsArray.map((f) => f.name),
    ).toEqual(['msgpack', 'json']);

    const provider = serviceDefinition('tfplugin6.Provider');

    expect(provider['PlanResourceChange'].path).toBe('/tfplugin6.Provider/PlanResourceChange');
    expect(provider['ListResource'].responseStream).toBe(true);
    expect(serviceDefinition('plugin.GRPCStdio')['StreamStdio'].responseStream).toBe(true);
    expect(serviceDefinition('plugin.GRPCBroker')['StartStream'].requestStream).toBe(true);
    expect(serviceDefinition('plugin.GRPCController')['Shutdown'].path).toBe('/plugin.GRPCController/Shutdown');
    expect(serviceDefinition('grpc.health.v1.Health')['Check'].path).toBe('/grpc.health.v1.Health/Check');
  });

  it('keep proto field names and bytes', () => {
    expect(
      roundTrip('tfplugin6.PlanResourceChange.Response', {
        planned_state: { msgpack: Buffer.from([0xc0]) },
        requires_replace: [{ steps: [{ attribute_name: 'name' }] }],
        diagnostics: [{ severity: 2, summary: 's' }],
      }),
    ).toEqual({
      planned_state: { msgpack: Buffer.from([0xc0]) },
      requires_replace: [{ steps: [{ attribute_name: 'name', selector: 'attribute_name' }] }],
      diagnostics: [{ severity: 2, summary: 's' }],
    });
  });
});
