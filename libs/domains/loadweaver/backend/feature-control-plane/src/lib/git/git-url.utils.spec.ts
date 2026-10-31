import {
  assertBranch,
  defaultResourcePath,
  GitUrlError,
  kindFileName,
  normalizeRepoDir,
  parseRepoUrl,
  providerApiBase,
  repoSlug,
  underPath,
} from './git-url.utils';

describe('git URL utils', () => {
  it('accepts https, ssh:// and scp-style URLs', () => {
    expect(parseRepoUrl('https://github.com/acme/infra.git')).toEqual({
      transport: 'https',
      host: 'github.com',
      port: null,
      user: null,
      path: 'acme/infra.git',
    });
    expect(parseRepoUrl('ssh://git@gitea.example.com:2222/acme/infra.git')).toEqual({
      transport: 'ssh',
      host: 'gitea.example.com',
      port: 2222,
      user: 'git',
      path: 'acme/infra.git',
    });
    expect(parseRepoUrl('git@gitlab.com:group/sub/project.git')).toMatchObject({
      transport: 'ssh',
      host: 'gitlab.com',
      user: 'git',
      path: 'group/sub/project.git',
    });
    expect(parseRepoUrl('https://127.0.0.1:3443/lw/repo')).toMatchObject({ host: '127.0.0.1', port: 3443 });
  });

  it.each([
    'file:///srv/repo.git',
    '/srv/repo.git',
    './repo',
    '../repo',
    'ext::sh -c touch% /tmp/pwned',
    'git://example.com/repo.git',
    'http://example.com/repo.git',
    '--upload-pack=touch /tmp/pwned',
    '-oProxyCommand=evil',
    'ssh://-oProxyCommand=evil/repo',
    'https://user:token@github.com/acme/repo.git',
    'https://token@github.com/acme/repo.git',
    'https://github.com/acme/repo.git?x=1',
    'https://github.com/acme/repo.git#frag',
    'https://github.com/acme/repo .git',
    'https://github.com/acme/repo.git\n',
    'https://github.com/',
    'git@-host:repo.git',
    'git@host:-repo.git',
    'host:repo.git',
    '',
  ])('rejects %j', (url) => {
    expect(() => parseRepoUrl(url)).toThrow(GitUrlError);
  });

  it('validates branch names like check-ref-format, without option-looking names', () => {
    for (const ok of ['main', 'release/1.2', 'feature_x-1', 'loadweaver/plan-0b0e']) expect(assertBranch(ok)).toBe(ok);

    for (const bad of [
      '-main',
      '--upload-pack=x',
      'a..b',
      'a//b',
      '/main',
      'main/',
      'x.lock',
      'a@{1}',
      '.hidden',
      'a/.b',
      'main ',
      'a:b',
      'ref~1',
      '',
    ])
      expect(() => assertBranch(bad)).toThrow(GitUrlError);
  });

  it('normalizes repository directories and refuses escapes', () => {
    expect(normalizeRepoDir('')).toBe('');
    expect(normalizeRepoDir(undefined)).toBe('');
    expect(normalizeRepoDir('./clusters/prod/')).toBe('clusters/prod');
    expect(normalizeRepoDir('a//b')).toBe('a/b');

    for (const bad of ['/etc', '../x', 'a/../../b', '.git', 'a/.git/hooks', 'a b', '-x'])
      expect(() => normalizeRepoDir(bad)).toThrow(GitUrlError);
  });

  it('derives provider API bases and slugs', () => {
    const gh = parseRepoUrl('git@github.com:acme/infra.git');
    const ghe = parseRepoUrl('https://git.corp.example/acme/infra.git');
    const gitea = parseRepoUrl('https://127.0.0.1:3443/lw/repo.git');

    expect(providerApiBase('github', gh)).toBe('https://api.github.com');
    expect(providerApiBase('github', ghe)).toBe('https://git.corp.example/api/v3');
    expect(providerApiBase('gitlab', ghe)).toBe('https://git.corp.example/api/v4');
    expect(providerApiBase('gitea', gitea)).toBe('https://127.0.0.1:3443/api/v1');
    expect(providerApiBase('git', gh)).toBeNull();
    expect(providerApiBase('gitlab', ghe, 'https://gitlab.corp.example/api/v4/')).toBe(
      'https://gitlab.corp.example/api/v4',
    );
    expect(() => providerApiBase('gitlab', ghe, 'http://gitlab.corp.example/api/v4')).toThrow(GitUrlError);
    expect(() => providerApiBase('gitlab', ghe, 'https://u:p@gitlab.corp.example/api/v4')).toThrow(GitUrlError);
    expect(repoSlug(gh)).toBe('acme/infra');
    expect(repoSlug(parseRepoUrl('https://gitlab.com/group/sub/project'))).toBe('group/sub/project');
  });

  it('places resources without a synced file under <path>/<project|cluster>/<kind>-<name>.yaml', () => {
    expect(kindFileName('DnsRecord')).toBe('dns-record');
    expect(defaultResourcePath('clusters/prod', 'Deployment', 'web', 'shop')).toBe(
      'clusters/prod/shop/deployment-web.yaml',
    );
    expect(defaultResourcePath('', 'Site', 'fra', null)).toBe('cluster/site-fra.yaml');
    expect(underPath('a/b.yaml', '')).toBe(true);
    expect(underPath('a/b.yaml', 'a')).toBe(true);
    expect(underPath('ab/c.yaml', 'a')).toBe(false);
  });
});
