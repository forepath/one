import { EGRESS_GIT_SSH_DEFAULT_HOSTS, resolveEgressGitSshHosts } from './egress-guard.constants';

describe('resolveEgressGitSshHosts', () => {
  it('includes the curated Git hosting providers by default', () => {
    const hosts = resolveEgressGitSshHosts({});

    expect(hosts).toEqual(expect.arrayContaining(['github.com', 'gitlab.com', 'bitbucket.org', 'ssh.dev.azure.com']));
    expect(hosts).toHaveLength(EGRESS_GIT_SSH_DEFAULT_HOSTS.length);
  });

  it('adds valid self-hosted Git servers and ignores unsafe entries', () => {
    const hosts = resolveEgressGitSshHosts({
      AGENT_EGRESS_GIT_SSH_HOSTS:
        'Git.Example.ORG, gitlab.internal.example.com  bad/host,10.0.0.1,*.evil.com,x\nserver=/#/',
    });

    expect(hosts).toEqual(expect.arrayContaining(['git.example.org', 'gitlab.internal.example.com']));
    expect(hosts).not.toEqual(expect.arrayContaining(['bad/host', '10.0.0.1', '*.evil.com']));
    expect(hosts.some((host) => host.includes('/') || host.includes('='))).toBe(false);
  });

  it('can be disabled', () => {
    expect(resolveEgressGitSshHosts({ AGENT_EGRESS_GIT_SSH_ENABLED: 'false' })).toEqual([]);
  });
});
