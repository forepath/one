import {
  applySecretsPatch,
  assertNoCredentialKeysInConfig,
  assertNoV1RootKeys,
  assertOverlayRespectsHeredity,
  composeLayerOverlay,
  computeHeredityMetadata,
  extractMcpEnvSecrets,
  extractNetworkSecrets,
  injectMcpSecretsIntoWire,
  isPemCertificateMaterial,
  materializeModelAllowDeny,
  mergeConfigs,
  migrateConfigV1ToV2,
  OpencodeConfigValidationError,
  prepareConfigForSync,
  resolveProviderAuthSecrets,
  envNameToAuthMetadataKey,
  extractProviderEnvSecrets,
  validateOverlayAgainstHeredity,
} from './agenstra-shared-util-opencode-config';

describe('migrateConfigV1ToV2', () => {
  it('renames singular roots to plural V2 keys', () => {
    const migrated = migrateConfigV1ToV2({
      provider: { openai: { name: 'OpenAI' } },
      permission: [{ action: 'shell', resource: '*', effect: 'ask' }],
      agent: { build: { description: 'build' } },
      plugin: ['pkg'],
      snapshot: true,
      autoshare: true,
      tools: { bash: false },
      mode: { build: {} },
    });

    expect(migrated.providers).toEqual({ openai: { name: 'OpenAI' } });
    expect(migrated.permissions).toEqual([{ action: 'shell', resource: '*', effect: 'ask' }]);
    expect(migrated.agents).toEqual({ build: { description: 'build' } });
    expect(migrated.plugins).toEqual(['pkg']);
    expect(migrated.snapshots).toBe(true);
    expect(migrated.share).toBe('auto');
    expect(migrated).not.toHaveProperty('provider');
    expect(migrated).not.toHaveProperty('tools');
    expect(migrated).not.toHaveProperty('mode');
    expect(migrated).not.toHaveProperty('autoshare');
  });

  it('nests flat MCP servers under mcp.servers and normalizes OAuth', () => {
    const migrated = migrateConfigV1ToV2({
      mcp: {
        docs: {
          type: 'remote',
          url: 'https://example.com/mcp',
          enabled: false,
          oauth: { clientId: 'id', clientSecret: 'secret' },
        },
        timeout: { catalog: 1000 },
      },
    });

    expect(migrated.mcp).toEqual({
      timeout: { request: 1000 },
      servers: {
        docs: {
          type: 'remote',
          url: 'https://example.com/mcp',
          disabled: true,
          oauth: { client_id: 'id', client_secret: 'secret' },
        },
      },
    });
  });
});

describe('assertNoV1RootKeys', () => {
  it('rejects forbidden roots', () => {
    expect(() => assertNoV1RootKeys({ provider: {} })).toThrow(OpencodeConfigValidationError);
  });

  it('allows V2 roots', () => {
    expect(() => assertNoV1RootKeys({ providers: {} })).not.toThrow();
  });
});

describe('mergeConfigs', () => {
  it('concatenates skills and deep-merges MCP servers', () => {
    const merged = mergeConfigs(
      { skills: ['./a'], mcp: { servers: { a: { type: 'local', command: ['a'] } } } },
      { skills: ['./b'], mcp: { servers: { b: { type: 'remote', url: 'https://b' } } } },
      { skills: ['./c'] },
    );

    expect(merged.skills).toEqual(['./a', './b', './c']);
    expect(merged.mcp).toEqual({
      servers: {
        a: { type: 'local', command: ['a'] },
        b: { type: 'remote', url: 'https://b' },
      },
    });
  });

  it('lets later permissions replace earlier ones', () => {
    const merged = mergeConfigs(
      { permissions: [{ action: 'shell', resource: '*', effect: 'ask' }] },
      { permissions: [{ action: 'shell', resource: '*', effect: 'deny' }] },
    );

    expect(merged.permissions).toEqual([{ action: 'shell', resource: '*', effect: 'deny' }]);
  });
});

describe('composeLayerOverlay', () => {
  it('lets overrides win over structured config within a layer', () => {
    const composed = composeLayerOverlay({ shell: '/bin/sh', model: 'openai/gpt-4' }, { shell: '/bin/bash' });

    expect(composed).toEqual({ shell: '/bin/bash', model: 'openai/gpt-4' });
  });

  it('treats empty overlays as no-ops', () => {
    expect(composeLayerOverlay({ shell: '/bin/sh' }, {})).toEqual({ shell: '/bin/sh' });
    expect(composeLayerOverlay(null, { shell: '/bin/bash' })).toEqual({ shell: '/bin/bash' });
  });
});

describe('computeHeredityMetadata', () => {
  it('locks replace keys and tracks inherited MCP server names', () => {
    const meta = computeHeredityMetadata({
      permissions: [{ action: 'shell', resource: '*', effect: 'deny' }],
      skills: ['./parent'],
      mcp: { servers: { sentry: { type: 'remote', url: 'https://s' } } },
      providers: { openai: {} },
    });

    expect(meta.lockedPaths).toContain('/permissions');
    expect(meta.inheritedAdditive).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/skills', items: ['./parent'] }),
        expect.objectContaining({ path: '/mcp/servers', keys: ['sentry'] }),
        expect.objectContaining({ path: '/providers', keys: ['openai'] }),
      ]),
    );
  });

  it('locks model allow and deny lists when a parent sets them', () => {
    const meta = computeHeredityMetadata({
      model_allow: ['openai/gpt-4o'],
      model_deny: ['openai/gpt-3.5'],
    });

    expect(meta.lockedPaths).toEqual(expect.arrayContaining(['/model_allow', '/model_deny']));
  });
});

describe('assertOverlayRespectsHeredity', () => {
  it('rejects locked paths and inherited map keys', () => {
    expect(() => assertOverlayRespectsHeredity({ permissions: [] }, ['/permissions'], [])).toThrow(/locked/i);

    expect(() =>
      assertOverlayRespectsHeredity(
        { providers: { openai: { name: 'x' } } },
        [],
        [{ path: '/providers', keys: ['openai'] }],
      ),
    ).toThrow(/inherited/i);
  });

  it('allows disabled/hidden stubs on inherited map keys', () => {
    expect(() =>
      assertOverlayRespectsHeredity(
        { providers: { openai: { disabled: true } } },
        [],
        [{ path: '/providers', keys: ['openai'] }],
      ),
    ).not.toThrow();

    expect(() =>
      assertOverlayRespectsHeredity(
        { mcp: { servers: { docs: { disabled: true } } } },
        [],
        [{ path: '/mcp/servers', keys: ['docs'] }],
      ),
    ).not.toThrow();

    expect(() =>
      assertOverlayRespectsHeredity(
        { agents: { build: { hidden: true, disabled: true } } },
        [],
        [{ path: '/agents', keys: ['build'] }],
      ),
    ).not.toThrow();
  });

  it('rejects non-override fields on inherited map keys', () => {
    expect(() =>
      assertOverlayRespectsHeredity(
        { mcp: { servers: { docs: { disabled: true, url: 'https://evil.example' } } } },
        [],
        [{ path: '/mcp/servers', keys: ['docs'] }],
      ),
    ).toThrow(/disabled, hidden/i);
  });

  it('allows adding new map keys', () => {
    expect(() =>
      assertOverlayRespectsHeredity(
        { providers: { anthropic: { name: 'a' } } },
        [],
        [{ path: '/providers', keys: ['openai'] }],
      ),
    ).not.toThrow();
  });

  it('validateOverlayAgainstHeredity returns message instead of throwing', () => {
    expect(validateOverlayAgainstHeredity({ provider: {} }, [], [])).toMatch(/V1 keys/i);
    expect(validateOverlayAgainstHeredity({ model: 'x' }, [], [])).toBeNull();
  });
});

describe('assertNoCredentialKeysInConfig', () => {
  it('rejects credential-like keys', () => {
    expect(() => assertNoCredentialKeysInConfig({ api_key: 'x' })).toThrow(OpencodeConfigValidationError);
  });

  it('allows MCP secretEnv and secretHeaders name lists', () => {
    expect(() =>
      assertNoCredentialKeysInConfig({
        mcp: {
          servers: {
            docs: {
              type: 'local',
              command: ['npx', '-y', 'pkg'],
              secretEnv: ['API_TOKEN'],
              secretHeaders: ['Authorization'],
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it('still rejects credential-like keys nested under MCP servers', () => {
    expect(() =>
      assertNoCredentialKeysInConfig({
        mcp: {
          servers: {
            docs: {
              type: 'local',
              command: ['npx'],
              environment: { API_TOKEN: 'leaked' },
            },
          },
        },
      }),
    ).toThrow(OpencodeConfigValidationError);
  });
});

describe('applySecretsPatch', () => {
  it('returns undefined when patch is omitted', () => {
    expect(applySecretsPatch({ A: '1' }, undefined)).toBeUndefined();
  });

  it('clears all secrets when patch is null', () => {
    expect(applySecretsPatch({ A: '1' }, null)).toEqual({});
  });

  it('sets and clears keys by empty string', () => {
    expect(applySecretsPatch({ KEEP: '1', DROP: '2' }, { DROP: '', NEW: '3' })).toEqual({
      KEEP: '1',
      NEW: '3',
    });
  });
});

describe('resolveProviderAuthSecrets', () => {
  it('skips network keys and maps env names to provider ids', () => {
    const auth = resolveProviderAuthSecrets(
      {
        HTTP_PROXY: 'proxy',
        ANTHROPIC_API_KEY: 'sk-ant',
        anthropic: 'legacy-key',
        openai: 'sk-openai',
      },
      {
        providers: {
          anthropic: { env: ['ANTHROPIC_API_KEY'] },
          openai: { env: ['OPENAI_API_KEY'] },
        },
      },
    );

    expect(auth).toEqual({
      anthropic: { key: 'legacy-key' },
      openai: { key: 'sk-openai' },
    });
  });

  it('uses env-keyed secret when provider id is absent', () => {
    const auth = resolveProviderAuthSecrets(
      { ANTHROPIC_API_KEY: 'sk-ant' },
      { providers: { anthropic: { env: ['ANTHROPIC_API_KEY'] } } },
    );

    expect(auth).toEqual({ anthropic: { key: 'sk-ant' } });
  });

  it('reads OpenCode wire provider singular root after prepareConfigForSync', () => {
    const auth = resolveProviderAuthSecrets(
      { AZURE_API_KEY: 'az-key', AZURE_RESOURCE_NAME: 'my-models' },
      {
        provider: {
          azure: { env: ['AZURE_RESOURCE_NAME', 'AZURE_API_KEY'] },
        },
      },
    );

    expect(auth).toEqual({
      azure: { key: 'az-key', metadata: { resourceName: 'my-models' } },
    });
  });

  it('maps non-key azure env into auth metadata', () => {
    const auth = resolveProviderAuthSecrets(
      { AZURE_API_KEY: 'az-key', AZURE_RESOURCE_NAME: 'my-models' },
      {
        providers: {
          azure: { env: ['AZURE_RESOURCE_NAME', 'AZURE_API_KEY'] },
        },
      },
    );

    expect(auth).toEqual({
      azure: { key: 'az-key', metadata: { resourceName: 'my-models' } },
    });
  });
});

describe('extractProviderEnvSecrets', () => {
  it('collects provider env secrets for Docker Env from wire provider root', () => {
    const result = extractProviderEnvSecrets(
      {
        AZURE_API_KEY: 'az-key',
        AZURE_RESOURCE_NAME: 'my-models',
        OPENAI_API_KEY: 'sk',
        HTTP_PROXY: 'ignored-here',
      },
      {
        provider: {
          azure: { env: ['AZURE_RESOURCE_NAME', 'AZURE_API_KEY'] },
          openai: { env: ['OPENAI_API_KEY'] },
        },
      },
    );

    expect(result.managedKeys).toEqual(['AZURE_API_KEY', 'AZURE_RESOURCE_NAME', 'OPENAI_API_KEY']);
    expect(result.values).toEqual({
      AZURE_API_KEY: 'az-key',
      AZURE_RESOURCE_NAME: 'my-models',
      OPENAI_API_KEY: 'sk',
    });
  });
});

describe('extractMcpEnvSecrets', () => {
  it('collects MCP secretEnv names from wire mcp root', () => {
    const result = extractMcpEnvSecrets(
      { API_TOKEN: 'tok', OTHER: 'x' },
      {
        mcp: {
          docs: { type: 'local', command: ['npx'], secretEnv: ['API_TOKEN'] },
        },
      },
    );

    expect(result.managedKeys).toEqual(['API_TOKEN']);
    expect(result.values).toEqual({ API_TOKEN: 'tok' });
  });
});

describe('injectMcpSecretsIntoWire', () => {
  it('merges secret env headers and oauth then allowlists OpenCode fields', () => {
    const wire = injectMcpSecretsIntoWire(
      {
        mcp: {
          github: {
            type: 'remote',
            url: 'https://mcp.example/mcp',
            headers: { 'X-Public': '1' },
            secretEnv: [],
            secretHeaders: ['Authorization'],
            oauth: { client_id: 'cid', callback_port: 8080 },
            auth_server_metadata_url: 'https://evil.example',
          },
        },
      },
      {
        Authorization: 'Bearer secret',
        'mcp.github.oauth.client_secret': 'oauth-secret',
      },
    );

    expect(wire.mcp).toEqual({
      github: {
        type: 'remote',
        url: 'https://mcp.example/mcp',
        headers: { 'X-Public': '1', Authorization: 'Bearer secret' },
        oauth: { clientId: 'cid', clientSecret: 'oauth-secret', callbackPort: 8080 },
      },
    });
  });

  it('sanitizes local marketplace seeds with secretEnv lists', () => {
    const wire = injectMcpSecretsIntoWire(
      {
        mcp: {
          fs: {
            type: 'local',
            command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2'],
            environment: { LOG_LEVEL: 'info' },
            secretEnv: ['API_TOKEN'],
            secretHeaders: [],
            disabled: true,
          },
        },
      },
      { API_TOKEN: 'tok' },
    );

    // Flat wire from prepareConfigForSync already has enabled; inject still strips secret lists.
    expect(wire.mcp).toEqual({
      fs: {
        type: 'local',
        command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2'],
        environment: { LOG_LEVEL: 'info', API_TOKEN: 'tok' },
      },
    });
  });
});

describe('envNameToAuthMetadataKey', () => {
  it('strips provider prefix and camelCases the rest', () => {
    expect(envNameToAuthMetadataKey('AZURE_RESOURCE_NAME', 'azure')).toBe('resourceName');
    expect(envNameToAuthMetadataKey('OPENAI_ORG_ID', 'openai')).toBe('orgId');
  });
});

describe('extractNetworkSecrets', () => {
  it('returns only reserved network keys with non-empty values', () => {
    expect(
      extractNetworkSecrets({
        HTTP_PROXY: 'http://proxy:8080',
        HTTPS_PROXY: '',
        NO_PROXY: 'localhost',
        openai: 'sk',
      }),
    ).toEqual({
      HTTP_PROXY: 'http://proxy:8080',
      NO_PROXY: 'localhost',
    });
  });

  it('detects inline PEM for NODE_EXTRA_CA_CERTS', () => {
    expect(isPemCertificateMaterial('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----')).toBe(true);
    expect(isPemCertificateMaterial('/etc/ssl/certs/ca.pem')).toBe(false);
  });
});

describe('materializeModelAllowDeny', () => {
  it('applies deny over allow via blacklist/whitelist and strips platform keys', () => {
    const result = materializeModelAllowDeny({
      model_allow: ['openai/gpt-4o', 'anthropic/claude'],
      model_deny: ['openai/gpt-4o'],
      disabled_providers: ['openai'],
      enabled_providers: ['openai', 'anthropic'],
    });

    expect(result).not.toHaveProperty('model_allow');
    expect(result).not.toHaveProperty('model_deny');
    expect(result.enabled_providers).toEqual(['anthropic']);
    expect(result.disabled_providers).toEqual(['openai']);
    expect((result.providers as Record<string, unknown>).openai).toEqual({
      blacklist: ['gpt-4o'],
    });
    expect((result.providers as Record<string, unknown>).anthropic).toEqual({
      whitelist: ['claude'],
    });
  });

  it('prepareConfigForSync migrates then emits singular OpenCode provider wire', () => {
    const prepared = prepareConfigForSync({
      provider: { acme: {} },
      model_deny: ['acme/coder'],
    });

    expect(prepared).not.toHaveProperty('providers');
    expect(prepared.provider).toEqual({
      acme: { blacklist: ['coder'] },
    });
  });

  it('prepareConfigForSync converts skills arrays and flattens mcp.servers for OpenCode wire', () => {
    const prepared = prepareConfigForSync({
      skills: ['/opt/skills/local', 'https://example.com/skill'],
      mcp: {
        timeout: { startup: 1000, request: 2000 },
        servers: {
          docs: { type: 'local', command: ['echo'], timeout: { request: 1500 }, disabled: true },
          remote: {
            type: 'remote',
            url: 'https://mcp.example/mcp',
            oauth: { client_id: 'cid', client_secret: 'should-strip', callback_port: 9 },
            secretEnv: ['TOKEN'],
          },
        },
      },
    });

    expect(prepared.skills).toEqual({
      paths: ['/opt/skills/local'],
      urls: ['https://example.com/skill'],
    });
    expect(prepared.mcp).toEqual({
      docs: { type: 'local', command: ['echo'], timeout: 1500, enabled: false },
      remote: {
        type: 'remote',
        url: 'https://mcp.example/mcp',
        oauth: { clientId: 'cid', callbackPort: 9 },
        secretEnv: ['TOKEN'],
      },
    });
    expect((prepared.experimental as { mcp_timeout?: number }).mcp_timeout).toBe(2000);
  });

  it('prepareConfigForSync maps UI plurals and aliases to OpenCode Config wire', () => {
    const prepared = prepareConfigForSync({
      snapshots: true,
      update: 'notify',
      media: { image: { auto_resize: true, max_width: 1024 } },
      compaction: { auto: true, keep: { tokens: 2000 }, buffer: 500 },
      plugins: ['@pkg/a'],
      agents: {
        build: { description: 'Build', system: 'You build', disabled: true, mode: 'primary' },
      },
      commands: {
        hello: { template: 'hi', subagent: true },
      },
      permissions: [
        { action: 'bash', resource: '*', effect: 'deny' },
        { action: 'edit', resource: '*.ts', effect: 'allow' },
        { action: 'read', resource: '*', effect: 'ask' },
      ],
      providers: {
        openai: { env: ['OPENAI_API_KEY'], models: ['gpt-4o'], disabled: true },
        azure: { models: { 'gpt-5': { disabled: true } } },
      },
      worktree: { directory: '/tmp' },
      warming: { prompt: 'hi' },
      websearch: { provider: 'exa' },
    });

    expect(prepared.snapshot).toBe(true);
    expect(prepared.autoupdate).toBe('notify');
    expect(prepared.attachment).toEqual({ image: { auto_resize: true, max_width: 1024 } });
    expect(prepared.compaction).toEqual({
      auto: true,
      preserve_recent_tokens: 2000,
      reserved: 500,
    });
    expect(prepared.plugin).toEqual(['@pkg/a']);
    expect(prepared.agent).toEqual({
      build: { description: 'Build', prompt: 'You build', disable: true, mode: 'primary' },
    });
    expect(prepared.command).toEqual({
      hello: { template: 'hi', subtask: true },
    });
    expect(prepared.permission).toEqual({
      bash: 'deny',
      edit: { '*.ts': 'allow' },
      read: 'ask',
    });
    expect(prepared.provider).toEqual({
      openai: { env: ['OPENAI_API_KEY'], whitelist: ['gpt-4o'] },
      azure: { blacklist: ['gpt-5'] },
    });
    expect(prepared.disabled_providers).toEqual(['openai']);
    expect(prepared).not.toHaveProperty('worktree');
    expect(prepared).not.toHaveProperty('warming');
    expect(prepared).not.toHaveProperty('websearch');
    expect(prepared).not.toHaveProperty('providers');
    expect(prepared).not.toHaveProperty('agents');
    expect(prepared).not.toHaveProperty('commands');
    expect(prepared).not.toHaveProperty('plugins');
    expect(prepared).not.toHaveProperty('permissions');
    expect(prepared).not.toHaveProperty('snapshots');
    expect(prepared).not.toHaveProperty('media');
    expect(prepared).not.toHaveProperty('update');
  });
});

describe('formatter heredity', () => {
  it('locks formatter only when parent disables it; object maps stay additive', () => {
    expect(computeHeredityMetadata({ formatter: false }).lockedPaths).toContain('/formatter');
    expect(computeHeredityMetadata({ formatter: { prettier: {} } }).lockedPaths).not.toContain('/formatter');
    expect(computeHeredityMetadata({ formatter: { prettier: {} } }).inheritedAdditive).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/formatter', keys: ['prettier'] })]),
    );
  });
});
