import { createServer } from 'node:http';

import {
  blockType,
  createPluginLogger,
  decodeDynamicValue,
  encodeDynamicValue,
  roundTrip,
  UNKNOWN,
  type ProviderRequest,
  type ProviderResponse,
  type TfObject,
} from '@forepath/loadweaver/backend/util-terraform-protocol';

import { LoadweaverClient, nodeHttpTransport } from './api-client';
import { DATA_SOURCE_DEFINITIONS } from './data-sources';
import { createLoadweaverProvider } from './provider';
import { PROVIDER_SCHEMA, parseDuration, resolveProviderSettings, validateProviderConfig } from './provider-config';
import { RESOURCE_DEFINITIONS, resourceSchema } from './resources';
import { FakeControlPlane } from './testing/fake-control-plane';

const PROVIDER_TYPE = blockType(PROVIDER_SCHEMA);

function provider(fake = new FakeControlPlane()) {
  const p = createLoadweaverProvider({
    version: '1.2.3',
    logger: createPluginLogger('test', () => undefined),
    env: {},
    transport: () => fake.transport(),
    sleep: async () => undefined,
  });

  return { fake, h: p.handlers as Record<string, (r: ProviderRequest) => Promise<ProviderResponse>> };
}

const providerConfig = (values: TfObject) =>
  encodeDynamicValue(PROVIDER_TYPE, {
    ...Object.fromEntries(PROVIDER_SCHEMA.attributes.map((a) => [a.name, null])),
    ...values,
  });

function resourceValue(typeName: string, values: TfObject | null) {
  const def = RESOURCE_DEFINITIONS.find((d) => d.typeName === typeName)!;
  const type = blockType(resourceSchema(def));

  return {
    type,
    encode: (v: TfObject | null) =>
      encodeDynamicValue(
        type,
        v && { ...Object.fromEntries(resourceSchema(def).attributes.map((a) => [a.name, null])), ...v },
      ),
    value: values,
  };
}

describe('provider handlers', () => {
  it('describes every resource and data source; schemas survive protobuf encoding', async () => {
    const { h } = provider();
    const metadata = await h.GetMetadata({});

    expect((metadata['resources'] as { type_name: string }[]).map((r) => r.type_name)).toEqual([
      'loadweaver_project',
      'loadweaver_deployment',
      'loadweaver_workload_group',
      'loadweaver_node_group',
      'loadweaver_client_group',
      'loadweaver_policy',
      'loadweaver_dns_zone',
      'loadweaver_dns_record',
      'loadweaver_alert_rule',
      'loadweaver_backup_policy',
      'loadweaver_resource',
    ]);
    expect((metadata['data_sources'] as { type_name: string }[]).map((r) => r.type_name)).toEqual(
      DATA_SOURCE_DEFINITIONS.map((d) => d.typeName),
    );

    const schema = roundTrip('tfplugin6.GetProviderSchema.Response', await h.GetProviderSchema({})) as {
      provider: { block: { attributes: { name: string; sensitive?: boolean }[] } };
      resource_schemas: Record<string, { version?: number; block: { attributes: { name: string }[] } }>;
      server_capabilities: { plan_destroy: boolean };
    };

    expect(schema.provider.block.attributes.find((a) => a.name === 'token')?.sensitive).toBe(true);
    expect(Object.keys(schema.resource_schemas)).toHaveLength(11);
    expect(schema.resource_schemas['loadweaver_project'].block.attributes.map((a) => a.name)).not.toContain('project');
    expect(schema.resource_schemas['loadweaver_deployment'].block.attributes.map((a) => a.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'project', 'labels', 'compose', 'variables', 'last_plan_id']),
    );
    expect(schema.server_capabilities.plan_destroy).toBe(true);
  });

  it('refuses to configure without endpoint / token and with unknown values', async () => {
    const { h } = provider();
    const missing = await h.ConfigureProvider({ config: providerConfig({}) });

    expect((missing['diagnostics'] as { summary: string }[]).map((d) => d.summary)).toEqual([
      'Missing endpoint',
      'Missing token',
    ]);

    const unknown = await h.ConfigureProvider({ config: providerConfig({ endpoint: UNKNOWN, token: 't' }) });

    expect((unknown['diagnostics'] as { summary: string }[])[0].summary).toBe('Provider configuration not known yet');

    const read = await h.ReadResource({
      type_name: 'loadweaver_project',
      current_state: { msgpack: Buffer.from([0xc0]) },
    });

    expect((read['diagnostics'] as { summary: string }[])[0].summary).toBe('Provider not configured');
  });

  it('plans and applies over msgpack DynamicValues', async () => {
    const { fake, h } = provider();

    await h.ConfigureProvider({
      config: providerConfig({ endpoint: 'https://cp.test', token: 'test-token', project: 'shop' }),
      terraform_version: '1.16.4',
    });

    const r = resourceValue('loadweaver_project', null);
    const cfg = r.encode({ name: 'shop', description: 'Shop' });
    const plan = await h.PlanResourceChange({
      type_name: 'loadweaver_project',
      prior_state: r.encode(null),
      proposed_new_state: cfg,
      config: cfg,
    });
    const planned = decodeDynamicValue(r.type, plan['planned_state'] as never) as TfObject;

    expect(plan['diagnostics']).toEqual([]);
    expect(planned).toMatchObject({ id: 'Project/shop', last_plan_id: UNKNOWN, default_cpu: UNKNOWN });

    const applied = await h.ApplyResourceChange({
      type_name: 'loadweaver_project',
      prior_state: r.encode(null),
      planned_state: plan['planned_state'],
      config: cfg,
    });

    expect(decodeDynamicValue(r.type, applied['new_state'] as never)).toMatchObject({
      id: 'Project/shop',
      description: 'Shop',
      default_cpu: '0.25',
    });
    expect(fake.resources.has('Project/shop')).toBe(true);
    expect(fake.requests.every((q) => q.method === 'GET' || q.path.startsWith('/plans'))).toBe(true);
  });

  it('upgrades version-0 JSON state and refuses newer versions', async () => {
    const { h } = provider();
    const r = resourceValue('loadweaver_project', null);
    const upgraded = await h.UpgradeResourceState({
      type_name: 'loadweaver_project',
      version: 0,
      raw_state: { json: Buffer.from(JSON.stringify({ id: 'Project/shop', name: 'shop', removed_attribute: 1 })) },
    });

    expect(decodeDynamicValue(r.type, upgraded['upgraded_state'] as never)).toMatchObject({
      id: 'Project/shop',
      name: 'shop',
      description: null,
    });

    const newer = await h.UpgradeResourceState({
      type_name: 'loadweaver_project',
      version: 1,
      raw_state: { json: Buffer.from('{}') },
    });

    expect((newer['diagnostics'] as { summary: string }[])[0].summary).toBe('State from a newer provider');
  });

  it('imports into a state Terraform then reads', async () => {
    const { h } = provider();
    const r = resourceValue('loadweaver_deployment', null);
    const imported = await h.ImportResourceState({ type_name: 'loadweaver_deployment', id: 'shop/site' });
    const [first] = imported['imported_resources'] as { type_name: string; state: never }[];

    expect(first.type_name).toBe('loadweaver_deployment');
    expect(decodeDynamicValue(r.type, first.state)).toMatchObject({
      id: 'Deployment/shop/site',
      project: 'shop',
      compose: null,
    });
  });

  it('reads data sources', async () => {
    const { fake, h } = provider();

    await h.ConfigureProvider({
      config: providerConfig({ endpoint: 'https://cp.test', token: 'test-token', project: 'shop' }),
    });
    fake.seed({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Deployment',
      metadata: { name: 'site', project: 'shop' },
      spec: { compose: 'x' },
    } as never);
    fake.seed({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Project',
      metadata: { name: 'shop' },
      spec: { description: 'S', quota: { ports: 4 } },
    } as never);

    const status = DATA_SOURCE_DEFINITIONS.find((d) => d.typeName === 'loadweaver_deployment_status')!;
    const statusType = blockType(status.schema);
    const read = await h.ReadDataSource({
      type_name: 'loadweaver_deployment_status',
      config: encodeDynamicValue(statusType, { name: 'site', project: null, id: null, replicas: null, services: null }),
    });

    expect(decodeDynamicValue(statusType, read['state'] as never)).toMatchObject({
      project: 'shop',
      replicas: [{ service: 'web', node: 'node-1', addresses: ['10.64.0.5'] }],
      services: [{ name: 'web', address_v4: '10.96.0.10', address_v6: null }],
    });

    const project = DATA_SOURCE_DEFINITIONS.find((d) => d.typeName === 'loadweaver_project')!;
    const projectType = blockType(project.schema);
    const projectRead = await h.ReadDataSource({
      type_name: 'loadweaver_project',
      config: encodeDynamicValue(projectType, { name: 'shop' }),
    });

    expect(decodeDynamicValue(projectType, projectRead['state'] as never)).toMatchObject({
      description: 'S',
      quota_ports: 4,
      quota_cpu: null,
    });

    const generic = DATA_SOURCE_DEFINITIONS.find((d) => d.typeName === 'loadweaver_resource')!;
    const genericType = blockType(generic.schema);
    const missing = await h.ReadDataSource({
      type_name: 'loadweaver_resource',
      config: encodeDynamicValue(genericType, { kind: 'Policy', name: 'nope' }),
    });

    expect((missing['diagnostics'] as { summary: string }[])[0].summary).toBe('Resource not found');
  });

  it('answers unknown types with a diagnostic', async () => {
    const { h } = provider();

    expect(
      ((await h.PlanResourceChange({ type_name: 'loadweaver_nope' }))['diagnostics'] as { summary: string }[])[0]
        .summary,
    ).toBe('Unknown resource type');
  });
});

describe('provider configuration', () => {
  it('parses durations', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('0')).toBe(0);
    expect(parseDuration('5 minutes')).toBeNull();
  });

  it('falls back to the environment and applies defaults', () => {
    const { settings } = resolveProviderSettings(null, {
      LOADWEAVER_URL: 'https://cp.example.com',
      LOADWEAVER_TOKEN: 'pat',
      LOADWEAVER_PROJECT: 'shop',
      LOADWEAVER_CA_CERT: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
    });

    expect(settings).toMatchObject({
      endpoint: 'https://cp.example.com',
      token: 'pat',
      project: 'shop',
      approvalTimeoutMs: 1_800_000,
      applyTimeoutMs: 900_000,
      pollIntervalMs: 5_000,
      confirmPins: false,
      dryRun: true,
    });
    expect(settings?.caCertificate).toContain('BEGIN CERTIFICATE');
  });

  it('reports invalid values with their attribute', () => {
    const { settings, diagnostics } = resolveProviderSettings(
      { endpoint: 'cp.example.com', token: 't', approval_timeout: 'soon', ca_certificate: '/nonexistent/ca.pem' },
      {},
    );

    expect(settings).toBeNull();
    expect(diagnostics.map((d) => d.attribute?.steps[0].attribute_name)).toEqual([
      'approval_timeout',
      'endpoint',
      'endpoint',
      'ca_certificate',
    ]);
  });

  it('refuses plain http:// endpoints unless insecure_http is set', () => {
    const attr = resolveProviderSettings({ endpoint: 'http://cp.example.com', token: 't' }, {});

    expect(attr.settings).toBeNull();
    expect(attr.diagnostics).toEqual([
      expect.objectContaining({
        severity: 1,
        summary: 'Insecure endpoint',
        attribute: { steps: [{ attribute_name: 'endpoint' }] },
      }),
    ]);
    expect(validateProviderConfig({ endpoint: 'http://cp.example.com', insecure_http: false })).toHaveLength(1);
    expect(validateProviderConfig({ endpoint: 'http://cp.example.com', insecure_http: UNKNOWN })).toEqual([]);

    const fromEnv = resolveProviderSettings(null, { LOADWEAVER_URL: 'HTTP://cp.example.com', LOADWEAVER_TOKEN: 't' });

    expect(fromEnv.settings).toBeNull();
    expect(fromEnv.diagnostics).toHaveLength(1);
    expect(fromEnv.diagnostics[0]).toMatchObject({ severity: 1, summary: 'Insecure endpoint' });
    expect(fromEnv.diagnostics[0].detail).toContain('LOADWEAVER_URL');

    const allowed = resolveProviderSettings(
      { insecure_http: true },
      { LOADWEAVER_URL: 'http://127.0.0.1:8080', LOADWEAVER_TOKEN: 't' },
    );

    expect(allowed.settings?.endpoint).toBe('http://127.0.0.1:8080');
    expect(allowed.diagnostics).toEqual([
      expect.objectContaining({
        severity: 2,
        summary: 'Insecure endpoint',
        attribute: { steps: [{ attribute_name: 'insecure_http' }] },
      }),
    ]);
    expect(
      resolveProviderSettings({ endpoint: 'https://cp.example.com', token: 't', insecure_http: true }, {}).diagnostics,
    ).toEqual([]);
  });
});

describe('HTTP client', () => {
  it('sends the token and parses errors', async () => {
    const seen: Record<string, string | undefined> = {};
    const server = createServer((req, res) => {
      seen['authorization'] = req.headers['authorization'];
      seen['agent'] = req.headers['user-agent'];
      res.writeHead(req.url === '/api/resources/Project/shop' ? 404 : 409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'plan is applied' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    const client = new LoadweaverClient(
      `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`,
      'pat',
      nodeHttpTransport(),
      'terraform-provider-loadweaver/1.2.3',
    );

    try {
      await expect(client.getResource({ kind: 'Project', name: 'shop' })).resolves.toBeNull();
      await expect(client.applyPlan('p1', false)).rejects.toMatchObject({
        status: 409,
        message: 'HTTP 409: plan is applied',
      });
      expect(seen).toEqual({ authorization: 'Bearer pat', agent: 'terraform-provider-loadweaver/1.2.3' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('aborts responses beyond the size cap', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/declared') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' });
        res.end('x'.repeat(4096));

        return;
      }

      // Chunked, no content-length: the cap applies while streaming.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('x'.repeat(1024));
      res.write('x'.repeat(1024));
      res.end('x'.repeat(1024));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const transport = nodeHttpTransport({ maxResponseBytes: 2048 });

    try {
      await expect(transport({ method: 'GET', url: `${base}/declared`, headers: {} })).rejects.toThrow(
        /exceeds the provider's limit of 2048 bytes/,
      );
      await expect(transport({ method: 'GET', url: `${base}/chunked`, headers: {} })).rejects.toThrow(
        /exceeds the provider's limit of 2048 bytes/,
      );
      await expect(
        nodeHttpTransport({ maxResponseBytes: 4096 })({ method: 'GET', url: `${base}/chunked`, headers: {} }),
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
