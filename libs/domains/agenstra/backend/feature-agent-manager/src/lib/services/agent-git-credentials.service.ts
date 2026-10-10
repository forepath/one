import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as sshpk from 'sshpk';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';

import { DockerService } from './docker.service';

/** Container env keys whose values end up in the Git credential files (`~/.ssh`, `~/.netrc`). */
export const GIT_CREDENTIAL_ENV_KEYS: readonly string[] = [
  'GIT_REPOSITORY_URL',
  'GIT_USERNAME',
  'GIT_TOKEN',
  'GIT_PASSWORD',
  'GIT_PRIVATE_KEY',
];

/** Whether an environment change touches any value that is materialized into the Git credential files. */
export function touchesGitCredentialEnvironment(env: Record<string, string | undefined>): boolean {
  return GIT_CREDENTIAL_ENV_KEYS.some((key) => key in env);
}

export interface NetrcCredentials {
  username?: string;
  token?: string;
}

export type GitCredentialsRestoreResult = 'ssh' | 'netrc' | 'skipped';

const LEGACY_ENV_ESCAPES: Record<string, string> = { '\\': '\\', n: '\n', r: '\r', t: '\t', '"': '"' };
const MAX_LEGACY_ENV_ENCODING_LAYERS = 3;

/**
 * Reverses one layer of the encoding legacy agent managers applied to `Config.Env` values (escape `\`,
 * newline, CR and tab; wrap values with whitespace or quotes in `"…"` with `\"` escapes). Containers
 * that were updated repeatedly carry several layers; their values survive the env-mount migration as-is.
 */
export function decodeLegacyEnvironmentValue(value: string): string {
  const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  const inner = quoted ? value.slice(1, -1) : value;

  return inner.replace(/\\([\\nrt"])/g, (match, escaped: string) =>
    escaped === '"' && !quoted ? match : LEGACY_ENV_ESCAPES[escaped],
  );
}

/**
 * Returns the first parseable SSH private key among the value and its legacy-decoded forms, or the
 * value unchanged when none parses (so the regular validation reports the error).
 */
export function resolveLegacyEncodedPrivateKey(value: string): string {
  let candidate = value;

  for (let layer = 0; layer <= MAX_LEGACY_ENV_ENCODING_LAYERS; layer++) {
    try {
      sshpk.parsePrivateKey(candidate.trim(), 'auto');

      return candidate;
    } catch {
      const decoded = decodeLegacyEnvironmentValue(candidate.trim());

      if (decoded === candidate.trim()) {
        break;
      }

      candidate = decoded;
    }
  }

  return value;
}

/**
 * Writes the Git credential files (SSH key + known_hosts, or `.netrc`) into an agent container.
 * The files live in the container's writable layer, so they are provisioned at agent creation and
 * re-provisioned from the container environment after environment updates (restart / recreate).
 */
@Injectable()
export class AgentGitCredentialsService {
  static readonly CONTAINER_RUNTIME_USER = 'agenstra';

  private readonly logger = new Logger(AgentGitCredentialsService.name);

  constructor(private readonly dockerService: DockerService) {}

  /**
   * Determine whether the configured git repository uses SSH.
   */
  isSshRepository(url?: string): boolean {
    if (!url) {
      return false;
    }

    return url.startsWith('git@') || url.startsWith('ssh://');
  }

  /**
   * Extract the domain from a git repository URL.
   * @param url - The git repository URL (e.g., https://github.com/user/repo.git)
   * @returns The domain (e.g., github.com)
   */
  extractGitDomain(url: string): string {
    try {
      const urlObj = new URL(url);

      return urlObj.hostname;
    } catch {
      // Fallback: try to extract domain from common git URL patterns
      const match = url.match(/@([^/:]+)|:\/\/([^/:]+)/);

      return match ? match[1] || match[2] : 'github.com';
    }
  }

  /**
   * Configure SSH credentials inside the container and return key metadata for the API response.
   * Idempotent: the key file is overwritten and the host key is only scanned when not yet known.
   */
  async configureSshAccess(
    containerId: string,
    repositoryUrl: string,
    providedPrivateKey?: string,
  ): Promise<{ publicKey: string; privateKey?: string }> {
    const keyPair = this.prepareSshKeyPair(providedPrivateKey);
    const { host, port } = this.getSshHostInfo(repositoryUrl);
    const home = await this.dockerService.getContainerHomeDirectory(containerId);
    const sshDir = `${home}/.ssh`;
    const keyPath = `${sshDir}/${keyPair.keyFilename}`;
    const escapedSshDir = this.escapeForShell(sshDir);
    const escapedKeyPath = this.escapeForShell(keyPath);
    const escapedKnownHosts = this.escapeForShell(`${sshDir}/known_hosts`);
    const runAsAgent = { user: AgentGitCredentialsService.CONTAINER_RUNTIME_USER };

    await this.dockerService.sendCommandToContainer(
      containerId,
      `mkdir -p ${escapedSshDir}`,
      undefined,
      true,
      runAsAgent,
    );
    await this.dockerService.sendCommandToContainer(
      containerId,
      `chmod 700 ${escapedSshDir}`,
      undefined,
      true,
      runAsAgent,
    );
    await this.writeFileToContainer(containerId, keyPath, keyPair.privateKey);
    await this.dockerService.sendCommandToContainer(
      containerId,
      `chmod 600 ${escapedKeyPath}`,
      undefined,
      true,
      runAsAgent,
    );

    const knownHostSpec = port ? `[${host}]:${port}` : host;
    const sshKeyscanCommand = [
      `ssh-keygen -F ${this.escapeForShell(knownHostSpec)} -f ${escapedKnownHosts} >/dev/null 2>&1 ||`,
      'ssh-keyscan',
      port ? `-p ${port}` : '',
      '--',
      this.escapeForShell(host),
      `>> ${escapedKnownHosts}`,
    ]
      .filter(Boolean)
      .join(' ');

    await this.dockerService.sendCommandToContainer(
      containerId,
      ['sh', '-c', sshKeyscanCommand],
      undefined,
      true,
      runAsAgent,
    );
    await this.dockerService.sendCommandToContainer(
      containerId,
      `chmod 600 ${escapedKnownHosts}`,
      undefined,
      true,
      runAsAgent,
    );

    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.generated ? keyPair.privateKey : undefined,
    };
  }

  /**
   * Write the `.netrc` file used for HTTPS git authentication (replaces an existing file).
   * @throws BadRequestException if git credentials are not configured
   */
  async writeNetrcFile(
    containerId: string,
    repositoryUrl: string | undefined,
    credentials: NetrcCredentials,
  ): Promise<void> {
    const { username, token } = credentials;

    if (!username || !token || !repositoryUrl) {
      throw new BadRequestException(
        'Git credentials not configured. Please set GIT_USERNAME, GIT_TOKEN (or GIT_PASSWORD), and provide a repositoryUrl in the createNetrcFile.',
      );
    }

    const gitDomain = this.extractGitDomain(repositoryUrl);
    const netrcContent = `machine ${gitDomain}
  login ${username}
  password ${token}
`;
    const base64Content = Buffer.from(netrcContent, 'utf-8').toString('base64');
    const home = await this.dockerService.getContainerHomeDirectory(containerId);
    const escapedPath = this.escapeForShell(`${home}/.netrc`);
    const runAsAgent = { user: AgentGitCredentialsService.CONTAINER_RUNTIME_USER };

    // The base64 content is sent to stdin, which base64 -d reads and decodes
    await this.dockerService.sendCommandToContainer(
      containerId,
      `sh -c "base64 -d > ${escapedPath}"`,
      base64Content,
      true,
      runAsAgent,
    );
    await this.dockerService.sendCommandToContainer(
      containerId,
      `chmod 600 ${escapedPath}`,
      undefined,
      true,
      runAsAgent,
    );
  }

  /**
   * Re-provision the Git credential files from the container's current (effective) environment,
   * e.g. after a rotated SSH key / token was applied or a container recreate dropped the writable layer.
   * Agents without a remote repository, or without credentials for it, are skipped.
   */
  async restoreFromContainerEnvironment(containerId: string): Promise<GitCredentialsRestoreResult> {
    const env = await this.dockerService.getContainerEnvironmentMap(containerId);
    const repositoryUrl = env['GIT_REPOSITORY_URL']?.trim();

    if (env['GIT_REPOSITORY_SETUP_MODE'] === GitRepositorySetupMode.EMPTY || !repositoryUrl) {
      return 'skipped';
    }

    if (this.isSshRepository(repositoryUrl)) {
      if (!env['GIT_PRIVATE_KEY']?.trim()) {
        return 'skipped';
      }

      await this.configureSshAccess(containerId, repositoryUrl, resolveLegacyEncodedPrivateKey(env['GIT_PRIVATE_KEY']));

      return 'ssh';
    }

    const username = env['GIT_USERNAME'];
    const token = env['GIT_TOKEN'] || env['GIT_PASSWORD'];

    if (!username || !token) {
      return 'skipped';
    }

    await this.writeNetrcFile(containerId, repositoryUrl, { username, token });

    return 'netrc';
  }

  /**
   * Resolve SSH host information from repository URL.
   */
  private getSshHostInfo(url: string): { host: string; port?: number } {
    if (url.startsWith('ssh://')) {
      const parsed = new URL(url);

      return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : undefined };
    }

    const scpLikeMatch = url.match(/^[^@]+@([^:]+):/);

    if (scpLikeMatch?.[1]) {
      return { host: scpLikeMatch[1] };
    }

    return { host: this.extractGitDomain(url) };
  }

  /**
   * Get the SSH key filename based on key type.
   * Maps key algorithm to standard SSH key filenames.
   */
  private getSshKeyFilename(keyType: string): string {
    const typeMap: Record<string, string> = {
      rsa: 'id_rsa',
      ed25519: 'id_ed25519',
      ecdsa: 'id_ecdsa',
      dsa: 'id_dsa',
    };

    return typeMap[keyType.toLowerCase()] || 'id_rsa';
  }

  /**
   * Prepare SSH key pair information.
   * Returns the private key contents to place inside the container, the public key to share, and the key filename.
   */
  private prepareSshKeyPair(providedPrivateKey?: string): {
    privateKey: string;
    publicKey: string;
    keyFilename: string;
    generated: boolean;
  } {
    let key: sshpk.PrivateKey;

    if (providedPrivateKey?.trim()) {
      try {
        key = sshpk.parsePrivateKey(providedPrivateKey.trim(), 'auto');
      } catch (error) {
        this.logger.debug(`Invalid SSH private key provided: ${(error as Error).message}`);
        throw new BadRequestException(
          'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
        );
      }
    } else {
      throw new BadRequestException(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    }

    const privateKey = key.toString('openssh').trimEnd() + '\n';
    const publicKey = key.toPublic().toString('ssh');
    const keyFilename = this.getSshKeyFilename(key.type || 'rsa');

    return { privateKey, publicKey, keyFilename, generated: false };
  }

  /**
   * Helper to write multi-line content into the agent container via base64 encoding.
   */
  private async writeFileToContainer(containerId: string, filePath: string, contents: string): Promise<void> {
    const escapedBase64 = this.escapeForShell(Buffer.from(contents, 'utf-8').toString('base64'));

    await this.dockerService.sendCommandToContainer(
      containerId,
      ['sh', '-c', `printf '%s' ${escapedBase64} | base64 -d > ${this.escapeForShell(filePath)}`],
      undefined,
      true,
      { user: AgentGitCredentialsService.CONTAINER_RUNTIME_USER },
    );
  }

  private escapeForShell(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}
