import { FORBIDDEN_V1_ROOT_KEYS, OpencodeConfigValidationError, type JsonObject } from './types';

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function renameRootKey(config: JsonObject, from: string, to: string): void {
  if (!(from in config)) {
    return;
  }

  const incoming = config[from];
  delete config[from];

  if (!(to in config)) {
    config[to] = incoming;
    return;
  }

  const existing = config[to];

  if (isPlainObject(existing) && isPlainObject(incoming)) {
    config[to] = { ...incoming, ...existing };
    return;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    config[to] = [...incoming, ...existing];
  }
}

function migrateMcp(config: JsonObject): void {
  const mcp = config['mcp'];

  if (!isPlainObject(mcp)) {
    return;
  }

  if (isPlainObject(mcp['servers'])) {
    migrateMcpServers(mcp['servers']);
    migrateMcpTimeout(mcp);
    return;
  }

  const servers: JsonObject = {};

  for (const [key, value] of Object.entries(mcp)) {
    if (key === 'timeout' || key === 'servers') {
      continue;
    }

    if (
      isPlainObject(value) &&
      (value['type'] === 'local' || value['type'] === 'remote' || 'command' in value || 'url' in value)
    ) {
      servers[key] = value;
      delete mcp[key];
    }
  }

  if (Object.keys(servers).length > 0) {
    mcp['servers'] = servers;
    migrateMcpServers(servers);
  }

  migrateMcpTimeout(mcp);
}

function migrateMcpTimeout(mcp: JsonObject): void {
  const timeout = mcp['timeout'];

  if (!isPlainObject(timeout)) {
    return;
  }

  if ('catalog' in timeout && !('request' in timeout)) {
    timeout['request'] = timeout['catalog'];
    delete timeout['catalog'];
  }

  if ('execution' in timeout && !('request' in timeout)) {
    timeout['request'] = timeout['execution'];
    delete timeout['execution'];
  }
}

function migrateMcpServers(servers: JsonObject): void {
  for (const server of Object.values(servers)) {
    if (!isPlainObject(server)) {
      continue;
    }

    if (server['enabled'] === false && server['disabled'] === undefined) {
      server['disabled'] = true;
    }

    delete server['enabled'];

    const oauth = server['oauth'];

    if (isPlainObject(oauth)) {
      renameOauthKeys(oauth);
    }

    const serverTimeout = server['timeout'];

    if (isPlainObject(serverTimeout)) {
      if ('catalog' in serverTimeout && !('request' in serverTimeout)) {
        serverTimeout['request'] = serverTimeout['catalog'];
        delete serverTimeout['catalog'];
      }

      if ('execution' in serverTimeout && !('request' in serverTimeout)) {
        serverTimeout['request'] = serverTimeout['execution'];
        delete serverTimeout['execution'];
      }
    }
  }
}

function renameOauthKeys(oauth: JsonObject): void {
  const map: Record<string, string> = {
    clientId: 'client_id',
    clientSecret: 'client_secret',
    callbackPort: 'callback_port',
    redirectUri: 'redirect_uri',
    authServerMetadataUrl: 'auth_server_metadata_url',
  };

  for (const [from, to] of Object.entries(map)) {
    if (from in oauth && !(to in oauth)) {
      oauth[to] = oauth[from];
      delete oauth[from];
    } else if (from in oauth) {
      delete oauth[from];
    }
  }
}

function migrateAgents(config: JsonObject): void {
  const agents = config['agents'];

  if (!isPlainObject(agents)) {
    return;
  }

  for (const agent of Object.values(agents)) {
    if (!isPlainObject(agent)) {
      continue;
    }

    if ('disable' in agent && !('disabled' in agent)) {
      agent['disabled'] = agent['disable'];
    }

    delete agent['disable'];

    if ('prompt' in agent && !('system' in agent)) {
      agent['system'] = agent['prompt'];
    }

    delete agent['prompt'];

    if ('permission' in agent && !('permissions' in agent)) {
      agent['permissions'] = agent['permission'];
    }

    delete agent['permission'];
    delete agent['tools'];
  }
}

function migrateCommands(config: JsonObject): void {
  const commands = config['commands'];

  if (!isPlainObject(commands)) {
    return;
  }

  for (const command of Object.values(commands)) {
    if (!isPlainObject(command)) {
      continue;
    }

    if ('subtask' in command && !('subagent' in command)) {
      command['subagent'] = command['subtask'];
    }

    delete command['subtask'];
  }
}

function migrateCompaction(config: JsonObject): void {
  const compaction = config['compaction'];

  if (!isPlainObject(compaction)) {
    return;
  }

  if (!isPlainObject(compaction['keep'])) {
    compaction['keep'] = {};
  }

  const keep = compaction['keep'] as JsonObject;

  if ('preserve_recent_tokens' in compaction && !('tokens' in keep)) {
    keep['tokens'] = compaction['preserve_recent_tokens'];
  }

  delete compaction['preserve_recent_tokens'];

  if ('reserved' in compaction && !('buffer' in compaction)) {
    compaction['buffer'] = compaction['reserved'];
  }

  delete compaction['reserved'];
}

function migrateMedia(config: JsonObject): void {
  if ('attachment' in config && !('media' in config)) {
    const attachment = config['attachment'];
    delete config['attachment'];

    if (isPlainObject(attachment)) {
      config['media'] = attachment;
    }
  }
}

/**
 * One-way display/sync migrator: rewrites known V1 shapes into V2.
 * Does not throw; callers that need strict V2 on write should use {@link assertNoV1RootKeys}.
 */
export function migrateConfigV1ToV2(input: JsonObject | null | undefined): JsonObject {
  const config: JsonObject = input ? structuredClone(input) : {};

  renameRootKey(config, 'provider', 'providers');
  renameRootKey(config, 'permission', 'permissions');
  renameRootKey(config, 'agent', 'agents');
  renameRootKey(config, 'plugin', 'plugins');
  renameRootKey(config, 'command', 'commands');
  renameRootKey(config, 'snapshot', 'snapshots');

  if ('autoshare' in config) {
    if (config['autoshare'] === true && !('share' in config)) {
      config['share'] = 'auto';
    }

    delete config['autoshare'];
  }

  delete config['mode'];
  delete config['tools'];

  migrateMcp(config);
  migrateAgents(config);
  migrateCommands(config);
  migrateCompaction(config);
  migrateMedia(config);

  return config;
}

export function findForbiddenV1RootKeys(config: JsonObject | null | undefined): string[] {
  if (!config) {
    return [];
  }

  return FORBIDDEN_V1_ROOT_KEYS.filter((key) => key in config);
}

export function assertNoV1RootKeys(config: JsonObject | null | undefined): void {
  const forbidden = findForbiddenV1RootKeys(config);

  if (forbidden.length === 0) {
    return;
  }

  throw new OpencodeConfigValidationError(
    `OpenCode config V1 keys are not allowed: ${forbidden.join(', ')}. Use V2 field names.`,
  );
}
