import {
  CUSTOM_MCP_ALLOW_DENY_TOKEN,
  builtinMcpServerLabel,
  filterBuiltinMcpServersByAllowDeny,
  getBuiltinMcpServer,
  isCustomMcpAllowed,
  isMcpServerAllowed,
  mcpOAuthClientSecretKey,
  mcpServerConfigKey,
  mcpServerMatchesCatalogServer,
  resolveMcpAllowDenyIdentity,
  seedMcpServerFromCatalog,
  selectPreferredPackage,
  stripUnverifiedMcpRegistryClaims,
  unusedBuiltinMcpServers,
} from './mcp-servers';
import type { OpencodeBuiltinMcpServer } from './types';

const SAMPLE: readonly OpencodeBuiltinMcpServer[] = [
  {
    name: 'io.modelcontextprotocol/filesystem',
    title: 'Filesystem',
    description: 'Filesystem operations',
    version: '1.0.2',
    status: 'active',
    packages: [
      {
        registryType: 'npm',
        identifier: '@modelcontextprotocol/server-filesystem',
        version: '1.0.2',
        runtimeHint: 'npx',
        transport: { type: 'stdio' },
        environmentVariables: [
          { name: 'LOG_LEVEL', default: 'info' },
          { name: 'API_TOKEN', isSecret: true, isRequired: true },
        ],
        packageArguments: [{ type: 'positional', valueHint: 'path', value: '/tmp' }],
      },
    ],
    remotes: [],
  },
  {
    name: 'com.example/remote-only',
    title: 'Remote Only',
    description: 'Remote MCP',
    version: '2.0.0',
    status: 'active',
    packages: [],
    remotes: [
      {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: [
          { name: 'X-Public', default: '1' },
          { name: 'Authorization', isSecret: true, isRequired: true },
        ],
      },
    ],
  },
  {
    name: 'com.example/deleted',
    title: 'Deleted',
    description: 'Gone',
    version: '0.0.1',
    status: 'deleted',
    packages: [],
    remotes: [],
  },
];

describe('util-opencode-mcp-servers', () => {
  it('getBuiltinMcpServer_returnsMatchFromCatalog', () => {
    expect(getBuiltinMcpServer(SAMPLE, 'io.modelcontextprotocol/filesystem')).toEqual(
      expect.objectContaining({
        name: 'io.modelcontextprotocol/filesystem',
        title: 'Filesystem',
      }),
    );
  });

  it('getBuiltinMcpServer_returnsUndefinedForUnknown', () => {
    expect(getBuiltinMcpServer(SAMPLE, 'not-a-real-server')).toBeUndefined();
    expect(getBuiltinMcpServer(SAMPLE, '')).toBeUndefined();
  });

  it('unusedBuiltinMcpServers_filtersExistingAndDeleted', () => {
    const unused = unusedBuiltinMcpServers(SAMPLE, ['io.modelcontextprotocol/filesystem']);

    expect(unused.find((server) => server.name === 'io.modelcontextprotocol/filesystem')).toBeUndefined();
    expect(unused.find((server) => server.name === 'com.example/remote-only')).toBeDefined();
    expect(unused.find((server) => server.name === 'com.example/deleted')).toBeUndefined();
  });

  it('builtinMcpServerLabel_prefersTitle', () => {
    expect(builtinMcpServerLabel(SAMPLE[0]!)).toBe('Filesystem');
    expect(builtinMcpServerLabel({ ...SAMPLE[0]!, title: '' })).toBe('io.modelcontextprotocol/filesystem');
  });

  it('mcpServerConfigKey_replacesSlash', () => {
    expect(mcpServerConfigKey('io.modelcontextprotocol/filesystem')).toBe('io.modelcontextprotocol__filesystem');
  });

  it('mcpOAuthClientSecretKey_namespacesByServer', () => {
    expect(mcpOAuthClientSecretKey('my-server')).toBe('mcp.my-server.oauth.client_secret');
  });

  it('selectPreferredPackage_prefersNpmStdio', () => {
    const preferred = selectPreferredPackage([
      {
        registryType: 'pypi',
        identifier: 'other',
        runtimeHint: 'uvx',
        transport: { type: 'stdio' },
      },
      {
        registryType: 'npm',
        identifier: '@scope/pkg',
        version: '1.0.0',
        transport: { type: 'stdio' },
      },
    ]);

    expect(preferred?.identifier).toBe('@scope/pkg');
  });

  it('seedMcpServerFromCatalog_buildsNpxCommandAndSplitsSecrets', () => {
    const seed = seedMcpServerFromCatalog(SAMPLE[0]!);

    expect(seed).toEqual({
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2', '/tmp'],
      environment: { LOG_LEVEL: 'info' },
      secretEnv: ['API_TOKEN'],
      secretHeaders: [],
      registry: 'io.modelcontextprotocol/filesystem',
    });
  });

  it('seedMcpServerFromCatalog_usesRemoteWhenNoPackage', () => {
    const seed = seedMcpServerFromCatalog(SAMPLE[1]!);

    expect(seed).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Public': '1' },
      secretEnv: [],
      secretHeaders: ['Authorization'],
      registry: 'com.example/remote-only',
    });
  });

  it('filterBuiltinMcpServersByAllowDeny_emptyListsUnrestricted', () => {
    const filtered = filterBuiltinMcpServersByAllowDeny(SAMPLE, [], []);

    expect(filtered.map((server) => server.name)).toEqual([
      'io.modelcontextprotocol/filesystem',
      'com.example/remote-only',
    ]);
  });

  it('filterBuiltinMcpServersByAllowDeny_allowAndDenyWins', () => {
    const filtered = filterBuiltinMcpServersByAllowDeny(
      SAMPLE,
      ['io.modelcontextprotocol/filesystem', 'com.example/remote-only'],
      ['com.example/remote-only'],
    );

    expect(filtered.map((server) => server.name)).toEqual(['io.modelcontextprotocol/filesystem']);
  });

  it('isMcpServerAllowed_denyWinsOverAllow', () => {
    expect(isMcpServerAllowed('a', ['a'], ['a'])).toBe(false);
    expect(isCustomMcpAllowed(['custom'], ['custom'])).toBe(false);
    expect(isCustomMcpAllowed(['io.modelcontextprotocol/filesystem'], [])).toBe(false);
    expect(isCustomMcpAllowed([], [])).toBe(true);
  });

  it('resolveMcpAllowDenyIdentity_requiresRegistryMatchingConfigKey', () => {
    const key = mcpServerConfigKey('io.modelcontextprotocol/filesystem');

    expect(resolveMcpAllowDenyIdentity(key, { registry: 'io.modelcontextprotocol/filesystem' }, [], [])).toBe(
      'io.modelcontextprotocol/filesystem',
    );

    // Spoofed registry on a mismatched key must not claim catalog identity.
    expect(resolveMcpAllowDenyIdentity('ignored', { registry: 'io.modelcontextprotocol/filesystem' }, [], [])).toBe(
      CUSTOM_MCP_ALLOW_DENY_TOKEN,
    );

    // Key-only / allow-list inference must not grant catalog identity (bypass vector).
    expect(
      resolveMcpAllowDenyIdentity(
        key,
        { type: 'local', command: ['npx', '-y', 'malicious'] },
        ['io.modelcontextprotocol/filesystem'],
        [],
      ),
    ).toBe(CUSTOM_MCP_ALLOW_DENY_TOKEN);

    // `__` → `/` reversal must not grant catalog identity without a verified registry claim.
    expect(
      resolveMcpAllowDenyIdentity(
        'io.modelcontextprotocol__filesystem',
        {},
        ['io.modelcontextprotocol/filesystem'],
        [],
      ),
    ).toBe(CUSTOM_MCP_ALLOW_DENY_TOKEN);

    expect(resolveMcpAllowDenyIdentity('my-custom', {}, [], [])).toBe(CUSTOM_MCP_ALLOW_DENY_TOKEN);
  });

  it('resolveMcpAllowDenyIdentity_withCatalogRequiresTransportMatch', () => {
    const catalogServer = SAMPLE[0]!;
    const key = mcpServerConfigKey(catalogServer.name);
    const seed = seedMcpServerFromCatalog(catalogServer)!;
    const catalogByName = { [catalogServer.name]: catalogServer };

    expect(
      resolveMcpAllowDenyIdentity(
        key,
        { type: seed.type, command: seed.command, registry: catalogServer.name },
        [],
        [],
        [],
        catalogByName,
      ),
    ).toBe(catalogServer.name);

    expect(
      resolveMcpAllowDenyIdentity(
        key,
        { type: 'local', command: ['npx', '-y', 'malicious-package'], registry: catalogServer.name },
        [],
        [],
        [],
        catalogByName,
      ),
    ).toBe(CUSTOM_MCP_ALLOW_DENY_TOKEN);
  });

  it('stripUnverifiedMcpRegistryClaims_removesSpoofedRegistry', () => {
    const catalogServer = SAMPLE[0]!;
    const key = mcpServerConfigKey(catalogServer.name);
    const seed = seedMcpServerFromCatalog(catalogServer)!;
    const catalogByName = { [catalogServer.name]: catalogServer };

    const stripped = stripUnverifiedMcpRegistryClaims(
      {
        mcp: {
          servers: {
            [key]: {
              type: 'local',
              command: ['npx', '-y', 'malicious-package'],
              registry: catalogServer.name,
            },
            wrong_key: {
              type: seed.type,
              command: seed.command,
              registry: catalogServer.name,
            },
          },
        },
      },
      catalogByName,
    );

    const servers = (stripped['mcp'] as { servers: Record<string, Record<string, unknown>> }).servers;

    expect(servers[key]).not.toHaveProperty('registry');
    expect(servers['wrong_key']).not.toHaveProperty('registry');
    expect(mcpServerMatchesCatalogServer({ type: seed.type, command: seed.command }, catalogServer)).toBe(true);

    const honestStripped = stripUnverifiedMcpRegistryClaims(
      {
        mcp: {
          servers: {
            [key]: {
              type: seed.type,
              command: seed.command,
              registry: catalogServer.name,
              secretEnv: ['API_TOKEN'],
            },
          },
        },
      },
      catalogByName,
    );

    expect((honestStripped['mcp'] as { servers: Record<string, Record<string, unknown>> }).servers[key]).toEqual(
      expect.objectContaining({
        registry: catalogServer.name,
        command: seed.command,
      }),
    );
  });
});
