import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as sshpk from 'sshpk';

import {
  AgentGitCredentialsService,
  decodeLegacyEnvironmentValue,
  GIT_CREDENTIAL_ENV_KEYS,
  resolveLegacyEncodedPrivateKey,
  touchesGitCredentialEnvironment,
} from './agent-git-credentials.service';
import { DockerService } from './docker.service';

describe('AgentGitCredentialsService', () => {
  let service: AgentGitCredentialsService;
  const dockerService = {
    sendCommandToContainer: jest.fn(),
    getContainerHomeDirectory: jest.fn(),
    getContainerEnvironmentMap: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    dockerService.sendCommandToContainer.mockResolvedValue('');
    dockerService.getContainerHomeDirectory.mockResolvedValue('/home/agenstra');

    const module = await Test.createTestingModule({
      providers: [AgentGitCredentialsService, { provide: DockerService, useValue: dockerService }],
    }).compile();

    service = module.get(AgentGitCredentialsService);
  });

  afterEach(() => {
    delete process.env.GIT_USERNAME;
    delete process.env.GIT_TOKEN;
    delete process.env.GIT_REPOSITORY_URL;
  });

  describe('extractGitDomain', () => {
    beforeEach(() => {
      process.env.GIT_USERNAME = 'testuser';
      process.env.GIT_TOKEN = 'test-token';
      process.env.GIT_REPOSITORY_URL = 'https://github.com/user/repo.git';
    });

    it('should extract domain from https URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://github.com/user/repo.git');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from http URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('http://gitlab.com/user/repo.git');

      expect(domain).toBe('gitlab.com');
    });

    it('should extract domain from git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('git@github.com:user/repo.git');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from URL with port', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://git.example.com:8443/user/repo.git');

      expect(domain).toBe('git.example.com');
    });

    it('should return default github.com for invalid URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('invalid-url');

      expect(domain).toBe('github.com');
    });

    it('should extract domain from URL with path', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const domain = (service as any).extractGitDomain('https://bitbucket.org/workspace/repo.git');

      expect(domain).toBe('bitbucket.org');
    });
  });

  describe('isSshRepository', () => {
    it('should return true for git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('git@github.com:user/repo.git');

      expect(result).toBe(true);
    });

    it('should return true for ssh:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('ssh://git@github.com/user/repo.git');

      expect(result).toBe(true);
    });

    it('should return false for https:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('https://github.com/user/repo.git');

      expect(result).toBe(false);
    });

    it('should return false for http:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('http://github.com/user/repo.git');

      expect(result).toBe(false);
    });

    it('should return false for undefined URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository(undefined);

      expect(result).toBe(false);
    });

    it('should return false for empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).isSshRepository('');

      expect(result).toBe(false);
    });
  });

  describe('getSshHostInfo', () => {
    it('should extract host from ssh:// URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('ssh://git@github.com:22/user/repo.git');

      expect(result).toEqual({ host: 'github.com', port: 22 });
    });

    it('should extract host from ssh:// URL without port', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('ssh://git@github.com/user/repo.git');

      expect(result).toEqual({ host: 'github.com' });
    });

    it('should extract host from git@ URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('git@github.com:user/repo.git');

      expect(result).toEqual({ host: 'github.com' });
    });

    it('should fallback to extractGitDomain for other formats', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshHostInfo('https://gitlab.com/user/repo.git');

      expect(result).toEqual({ host: 'gitlab.com' });
    });
  });

  describe('getSshKeyFilename', () => {
    it('should return id_rsa for RSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('rsa');

      expect(result).toBe('id_rsa');
    });

    it('should return id_ed25519 for Ed25519 keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('ed25519');

      expect(result).toBe('id_ed25519');
    });

    it('should return id_ecdsa for ECDSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('ecdsa');

      expect(result).toBe('id_ecdsa');
    });

    it('should return id_dsa for DSA keys', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('dsa');

      expect(result).toBe('id_dsa');
    });

    it('should handle uppercase key types', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('RSA');

      expect(result).toBe('id_rsa');
    });

    it('should default to id_rsa for unknown key types', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).getSshKeyFilename('unknown');

      expect(result).toBe('id_rsa');
    });
  });

  describe('prepareSshKeyPair', () => {
    it('should parse valid Ed25519 private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(privateKeyPem);

      expect(result.privateKey).toContain('BEGIN');
      expect(result.privateKey).toContain('END');
      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
      expect(result.generated).toBe(false);
    });

    it('should parse valid Ed25519 private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(privateKeyPem);

      expect(result.privateKey).toContain('BEGIN');
      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
      expect(result.generated).toBe(false);
    });

    it('should throw BadRequestException for invalid private key', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('invalid-key')).toThrow(BadRequestException);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('invalid-key')).toThrow(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    });

    it('should throw BadRequestException when private key is undefined', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair(undefined)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when private key is empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).prepareSshKeyPair('')).toThrow(BadRequestException);
    });

    it('should trim whitespace from private key', () => {
      const key = sshpk.generatePrivateKey('ed25519');
      const privateKeyPem = key.toString('openssh');
      const publicKey = key.toPublic().toString('ssh');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).prepareSshKeyPair(`  ${privateKeyPem}  `);

      // Compare public keys by extracting the key part (before any comment)
      expect(result.publicKey.split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '));
      expect(result.keyFilename).toBe('id_ed25519');
    });
  });

  describe('writeFileToContainer', () => {
    it('should write file content to container using base64 encoding', async () => {
      const containerId = 'container-id-123';
      const filePath = '/home/agenstra/.ssh/id_rsa';
      const contents = 'test file content\nwith newlines';

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).writeFileToContainer(containerId, filePath, contents);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(1);
      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];

      expect(callArgs[0]).toBe(containerId);
      expect(callArgs[1]).toEqual(['sh', '-c', expect.stringContaining('base64 -d')]);
      const script = (callArgs[1] as string[])[2];

      expect(script).toContain(filePath);
      expect(callArgs.slice(2)).toEqual([undefined, true, { user: 'agenstra' }]);
      // Verify base64 encoding
      const base64Content = Buffer.from(contents, 'utf-8').toString('base64');

      expect(script).toContain(base64Content);
    });

    it('should escape base64 content for shell', async () => {
      const containerId = 'container-id-123';
      const filePath = '/home/agenstra/test';
      const contents = "content with 'quotes'";

      dockerService.sendCommandToContainer.mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).writeFileToContainer(containerId, filePath, contents);

      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];

      // Base64 content should be escaped
      expect(callArgs[1]).toEqual(['sh', '-c', expect.stringMatching(/printf '%s' '.*' \| base64 -d >/)]);
    });
  });

  describe('touchesGitCredentialEnvironment', () => {
    it.each(GIT_CREDENTIAL_ENV_KEYS)('detects changes to %s (including removals)', (key) => {
      expect(touchesGitCredentialEnvironment({ [key]: undefined })).toBe(true);
    });

    it('ignores unrelated variables', () => {
      expect(touchesGitCredentialEnvironment({ OPENAI_API_KEY: 'x', GIT_REPOSITORY_SETUP_MODE: 'clone' })).toBe(false);
    });
  });

  describe('configureSshAccess known_hosts', () => {
    it('only scans the host key when it is not yet known and guards the host argument', async () => {
      const privateKey = sshpk.generatePrivateKey('ed25519').toString('openssh');

      await service.configureSshAccess('c1', 'ssh://git@git.example.com:2222/org/repo.git', privateKey);

      const script = (dockerService.sendCommandToContainer.mock.calls[4][1] as string[])[2];

      expect(script).toBe(
        "ssh-keygen -F '[git.example.com]:2222' -f '/home/agenstra/.ssh/known_hosts' >/dev/null 2>&1 || " +
          "ssh-keyscan -p 2222 -- 'git.example.com' >> '/home/agenstra/.ssh/known_hosts'",
      );
    });
  });

  describe('writeNetrcFile', () => {
    it('writes the given credentials as agenstra', async () => {
      await service.writeNetrcFile('c1', 'https://git.example.com/org/repo.git', { username: 'u', token: 't' });

      const [containerId, command, input, checkExitCode, options] = dockerService.sendCommandToContainer.mock.calls[0];

      expect(containerId).toBe('c1');
      expect(command).toBe(`sh -c "base64 -d > '/home/agenstra/.netrc'"`);
      expect(Buffer.from(input as string, 'base64').toString('utf-8')).toBe(
        'machine git.example.com\n  login u\n  password t\n',
      );
      expect(checkExitCode).toBe(true);
      expect(options).toEqual({ user: 'agenstra' });
    });

    it('rejects missing credentials', async () => {
      await expect(service.writeNetrcFile('c1', 'https://x/y.git', { username: 'u' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });
  });

  describe('restoreFromContainerEnvironment', () => {
    it('re-provisions the SSH key from the container environment', async () => {
      const privateKey = sshpk.generatePrivateKey('ed25519').toString('openssh');

      dockerService.getContainerEnvironmentMap.mockResolvedValue({
        GIT_REPOSITORY_URL: 'git@github.com:org/repo.git',
        GIT_PRIVATE_KEY: privateKey,
      });

      await expect(service.restoreFromContainerEnvironment('c1')).resolves.toBe('ssh');
      expect(dockerService.getContainerEnvironmentMap).toHaveBeenCalledWith('c1');
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        'c1',
        ['sh', '-c', expect.stringMatching(/base64 -d > '\/home\/agenstra\/\.ssh\/id_ed25519'$/)],
        undefined,
        true,
        { user: 'agenstra' },
      );
    });

    it('re-provisions .netrc for HTTPS repositories (GIT_PASSWORD fallback)', async () => {
      dockerService.getContainerEnvironmentMap.mockResolvedValue({
        GIT_REPOSITORY_URL: 'https://github.com/org/repo.git',
        GIT_USERNAME: 'user',
        GIT_PASSWORD: 'rotated',
      });

      await expect(service.restoreFromContainerEnvironment('c1')).resolves.toBe('netrc');

      const input = dockerService.sendCommandToContainer.mock.calls[0][2] as string;

      expect(Buffer.from(input, 'base64').toString('utf-8')).toContain('password rotated');
    });

    it.each([
      ['empty setup mode', { GIT_REPOSITORY_SETUP_MODE: 'empty', GIT_REPOSITORY_URL: 'https://x/y.git' }],
      ['no repository', { GIT_USERNAME: 'u', GIT_TOKEN: 't' }],
      ['SSH repository without key', { GIT_REPOSITORY_URL: 'git@github.com:o/r.git' }],
      ['HTTPS repository without token', { GIT_REPOSITORY_URL: 'https://x/y.git', GIT_USERNAME: 'u' }],
    ])('skips when there is nothing to provision (%s)', async (_label, env) => {
      dockerService.getContainerEnvironmentMap.mockResolvedValue(env);

      await expect(service.restoreFromContainerEnvironment('c1')).resolves.toBe('skipped');
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('rejects an invalid SSH key without writing anything', async () => {
      dockerService.getContainerEnvironmentMap.mockResolvedValue({
        GIT_REPOSITORY_URL: 'git@github.com:o/r.git',
        GIT_PRIVATE_KEY: 'not-a-key',
      });

      await expect(service.restoreFromContainerEnvironment('c1')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it.each([1, 2])(
      're-provisions an SSH key carried over with %i layer(s) of legacy Config.Env encoding',
      async (layers) => {
        const key = sshpk.generatePrivateKey('ed25519');
        let encoded = key.toString('openssh');

        for (let i = 0; i < layers; i++) {
          encoded = legacyEncodeEnvironmentValue(encoded);
        }

        dockerService.getContainerEnvironmentMap.mockResolvedValue({
          GIT_REPOSITORY_URL: 'git@github.com:org/repo.git',
          GIT_PRIVATE_KEY: encoded,
        });

        await expect(service.restoreFromContainerEnvironment('c1')).resolves.toBe('ssh');

        const keyWrite = dockerService.sendCommandToContainer.mock.calls
          .map(([, command]) => command)
          .find((command) => Array.isArray(command) && /\.ssh\/id_ed25519'$/.test(command[2])) as string[];
        const base64 = /printf '%s' '([^']+)'/.exec(keyWrite[2])?.[1] ?? '';
        const written = Buffer.from(base64, 'base64').toString('utf-8');

        expect(sshpk.parsePrivateKey(written, 'auto').fingerprint('sha256').toString()).toBe(
          key.fingerprint('sha256').toString(),
        );
      },
    );
  });

  describe('decodeLegacyEnvironmentValue', () => {
    it.each([
      ['plain', 'abc'],
      ['spaces', 'a b'],
      ['quotes and backslashes', 'say "hi" \\o/ \\"x\\"'],
      ['control characters', 'line1\nline2\r\n\ttab'],
    ])('reverses one layer of legacy encoding (%s)', (_label, value) => {
      expect(decodeLegacyEnvironmentValue(legacyEncodeEnvironmentValue(value))).toBe(value);
      expect(
        decodeLegacyEnvironmentValue(
          decodeLegacyEnvironmentValue(legacyEncodeEnvironmentValue(legacyEncodeEnvironmentValue(value))),
        ),
      ).toBe(value);
    });
  });

  describe('resolveLegacyEncodedPrivateKey', () => {
    it('returns valid keys and unparseable values unchanged', () => {
      const key = sshpk.generatePrivateKey('ed25519').toString('openssh');

      expect(resolveLegacyEncodedPrivateKey(key)).toBe(key);
      expect(resolveLegacyEncodedPrivateKey('"not \\"a\\" key"')).toBe('"not \\"a\\" key"');
    });
  });
});

/** Replica of the encoding legacy agent managers applied to `Config.Env` values. */
function legacyEncodeEnvironmentValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

  return /\s|"|'/u.test(escaped) ? `"${escaped.replace(/"/g, '\\"')}"` : escaped;
}
