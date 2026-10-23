import type { GitConnection } from '../types/git.types';
import {
  authoritativeConnectionsOf,
  gitCarrierOf,
  gitCommitUrl,
  gitPullRequestUrl,
  gitRepoWebUrl,
  gitWebhookUrl,
  isValidGitBranch,
  isValidGitPath,
  parseGitRepoUrl,
  shortRef,
  shortSha,
  sopsEncryptCommand,
  sourceBypassesGit,
} from './git';

const connection = (overrides: Partial<GitConnection>): GitConnection =>
  ({
    id: 'c',
    project: null,
    provider: 'github',
    repoUrl: 'https://github.com/acme/infra.git',
    mode: 'bidirectional',
    ...overrides,
  }) as GitConnection;

describe('git utils', () => {
  it('accepts HTTPS and SSH repository URLs only, like the API', () => {
    expect(parseGitRepoUrl('https://github.com/acme/infra.git')).toMatchObject({
      transport: 'https',
      host: 'github.com',
    });
    expect(parseGitRepoUrl('ssh://git@gitlab.example:2222/team/infra.git')).toMatchObject({
      transport: 'ssh',
      port: 2222,
      user: 'git',
      path: 'team/infra.git',
    });
    expect(parseGitRepoUrl('git@github.com:acme/infra.git')).toMatchObject({
      transport: 'ssh',
      path: 'acme/infra.git',
    });

    for (const bad of [
      'http://github.com/acme/infra.git',
      'https://user:pw@github.com/acme/infra.git',
      'https://token@github.com/acme/infra.git',
      'file:///srv/repo',
      'git://github.com/acme/infra.git',
      'ext::sh -c touch',
      '/srv/repo',
      '-uhttps://x',
      'https://github.com/acme/infra.git?x=1',
      'https://github.com/',
      'https://github.com/acme /infra',
      '',
    ])
      expect(parseGitRepoUrl(bad)).toBeNull();
  });

  it('validates branches and paths', () => {
    expect(isValidGitBranch('main')).toBe(true);
    expect(isValidGitBranch('release/2026.10')).toBe(true);
    expect(isValidGitBranch('-x')).toBe(false);
    expect(isValidGitBranch('a..b')).toBe(false);
    expect(isValidGitBranch('x.lock')).toBe(false);
    expect(isValidGitPath('')).toBe(true);
    expect(isValidGitPath('clusters/prod')).toBe(true);
    expect(isValidGitPath('/abs')).toBe(false);
    expect(isValidGitPath('a/../b')).toBe(false);
    expect(isValidGitPath('.git/hooks')).toBe(false);
  });

  it('builds provider links for commits and pull requests', () => {
    expect(gitRepoWebUrl(connection({}))).toBe('https://github.com/acme/infra');
    expect(gitCommitUrl(connection({}), 'abcdef1234')).toBe('https://github.com/acme/infra/commit/abcdef1234');
    expect(gitCommitUrl(connection({ provider: 'gitlab', repoUrl: 'git@gitlab.com:team/infra.git' }), 'abcdef1')).toBe(
      'https://gitlab.com/team/infra/-/commit/abcdef1',
    );
    expect(gitPullRequestUrl(connection({}), 7)).toBe('https://github.com/acme/infra/pull/7');
    expect(gitPullRequestUrl(connection({ provider: 'gitlab' }), 7)).toBe(
      'https://github.com/acme/infra/-/merge_requests/7',
    );
    expect(gitPullRequestUrl(connection({ provider: 'gitea' }), 7)).toBe('https://github.com/acme/infra/pulls/7');
    expect(gitCommitUrl(connection({ provider: 'git' }), 'abcdef1')).toBeNull();
    expect(gitCommitUrl(connection({}), 'not-a-sha')).toBeNull();
    expect(shortSha('0123456789abcdef')).toBe('01234567');
    expect(shortRef('refs/heads/main')).toBe('main');
  });

  it('finds the carrying connection and the authoritative scopes a plan touches', () => {
    const cluster = connection({ id: 'cluster', project: null, mode: 'authoritative' });
    const shop = connection({ id: 'shop', project: 'shop', mode: 'bidirectional' });

    expect(gitCarrierOf('shop', [cluster, shop])?.id).toBe('shop');
    expect(gitCarrierOf('web', [cluster, shop])?.id).toBe('cluster');
    expect(gitCarrierOf(null, [shop])).toBeNull();
    expect(
      authoritativeConnectionsOf(
        [
          { action: 'update', project: 'shop' },
          { action: 'create', project: 'web' },
          { action: 'unchanged', project: null },
        ],
        [cluster, shop],
      ).map((c) => c.id),
    ).toEqual(['cluster']);
    expect(sourceBypassesGit({ kind: 'git' })).toBe(true);
    expect(sourceBypassesGit({ kind: 'ui' })).toBe(false);
    expect(sourceBypassesGit(null)).toBe(false);
  });

  it('builds the webhook URL and the SOPS command', () => {
    expect(gitWebhookUrl('https://lw.example/api', '/api/git/webhooks/x')).toBe(
      'https://lw.example/api/git/webhooks/x',
    );
    expect(gitWebhookUrl('/api/', '/api/git/webhooks/x', 'https://console.example/en/git')).toBe(
      'https://console.example/api/git/webhooks/x',
    );
    expect(sopsEncryptCommand('age1abc')).toBe('sops --encrypt --age age1abc --in-place secrets.yaml');
  });
});
