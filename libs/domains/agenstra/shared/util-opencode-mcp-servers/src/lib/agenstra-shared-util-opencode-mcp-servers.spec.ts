import {
  CUSTOM_MCP_ALLOW_DENY_TOKEN,
  builtinMcpServerLabel,
  filterBuiltinMcpServersByAllowDeny,
  getBuiltinMcpServer,
  isCustomMcpAllowed,
  isMcpServerAllowed,
  mcpOAuthClientSecretKey,
  mcpServerConfigKey,
  resolveMcpAllowDenyIdentity,
  seedMcpServerFromCatalog,
  selectPreferredPackage,
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

  it('resolveMcpAllowDenyIdentity_prefersRegistryThenKeyThenCustom', () => {
    expect(resolveMcpAllowDenyIdentity('ignored', { registry: 'io.modelcontextprotocol/filesystem' }, [], [])).toBe(
      'io.modelcontextprotocol/filesystem',
    );

    expect(
      resolveMcpAllowDenyIdentity(
        'io.modelcontextprotocol__filesystem',
        {},
        ['io.modelcontextprotocol/filesystem'],
        [],
      ),
    ).toBe('io.modelcontextprotocol/filesystem');

    expect(resolveMcpAllowDenyIdentity('my-custom', {}, [], [])).toBe(CUSTOM_MCP_ALLOW_DENY_TOKEN);
  });
});
