import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  basicAuthHeader,
  classifyGitError,
  GitClient,
  GitError,
  gitEnvironment,
  gitIdentityFromEnv,
  scrubGitOutput,
  sweepStaleTempDirs,
  treeSize,
} from './git-client';
import { GitUrlError } from './git-url.utils';

const identity = { name: 'Loadweaver', email: 'loadweaver@localhost' };

describe('git client', () => {
  describe('environment', () => {
    it('isolates git: no user / system config, no prompts, only https and ssh, token as header', () => {
      const env = gitEnvironment({
        home: '/tmp/x/home',
        identity,
        auth: { kind: 'token', username: 'x-access-token', token: 'tok-123' },
        caFile: '/tmp/x/ca.pem',
      });
      const config = Object.fromEntries(
        Array.from({ length: Number(env['GIT_CONFIG_COUNT']) }, (_, i) => [
          env[`GIT_CONFIG_KEY_${i}`],
          env[`GIT_CONFIG_VALUE_${i}`],
        ]),
      );

      expect(env).toMatchObject({
        HOME: '/tmp/x/home',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ALLOW_PROTOCOL: 'https:ssh',
      });
      expect(config).toMatchObject({
        'protocol.allow': 'never',
        'protocol.https.allow': 'always',
        'protocol.ssh.allow': 'always',
        'http.followRedirects': 'false',
        'core.hooksPath': '/dev/null',
        'core.symlinks': 'false',
        'http.sslCAInfo': '/tmp/x/ca.pem',
        'http.extraHeader': `Authorization: Basic ${Buffer.from('x-access-token:tok-123').toString('base64')}`,
      });
      // Nothing of the parent environment leaks in (e.g. SSH agents, credentials helpers).
      expect(Object.keys(env).some((k) => k.startsWith('SSH_AUTH') || k === 'GIT_DIR')).toBe(false);
    });

    it('pins the host key once known (accept-new only on first contact) and uses only the deploy key', () => {
      const first = gitEnvironment({
        home: '/h',
        identity,
        auth: { kind: 'ssh', privateKey: 'k' },
        keyFile: "/tmp/it's/key",
        knownHostsFile: '/tmp/kh',
        pinned: false,
      });
      const later = gitEnvironment({
        home: '/h',
        identity,
        auth: { kind: 'ssh', privateKey: 'k' },
        keyFile: '/k',
        knownHostsFile: '/kh',
        pinned: true,
      });

      expect(first['GIT_SSH_COMMAND']).toContain("-i '/tmp/it'\\''s/key' -o IdentitiesOnly=yes");
      expect(first['GIT_SSH_COMMAND']).toContain('StrictHostKeyChecking=accept-new');
      expect(first['GIT_SSH_COMMAND']).toContain("UserKnownHostsFile='/tmp/kh'");
      expect(first['GIT_SSH_COMMAND']).toContain('BatchMode=yes');
      expect(later['GIT_SSH_COMMAND']).toContain('StrictHostKeyChecking=yes');
    });

    it('reads the commit identity from the environment, without control characters', () => {
      expect(gitIdentityFromEnv({})).toEqual(identity);
      expect(
        gitIdentityFromEnv({ LOADWEAVER_GIT_AUTHOR_NAME: 'Ops\nBot', LOADWEAVER_GIT_AUTHOR_EMAIL: '<a@b.c>' }),
      ).toEqual({
        name: 'OpsBot',
        email: 'a@b.c',
      });
    });
  });

  it('scrubs tokens, headers, URL credentials, private keys and temp paths from output', () => {
    const token = 'ghs_secretvalue123';
    const header = basicAuthHeader('x-access-token', token);
    const text = [
      `fatal: unable to access 'https://x-access-token:${token}@github.com/a/b.git/': 403`,
      `> ${header}`,
      `error: ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      'PRIVATE-TOKEN: glpat-xyz',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----',
      'cannot open /tmp/lw-git-abc/repo/x',
    ].join('\n');
    const out = scrubGitOutput(
      text,
      [token, Buffer.from(`x-access-token:${token}`).toString('base64')],
      '/tmp/lw-git-abc',
    );

    expect(out).not.toContain(token);
    expect(out).not.toContain('glpat-xyz');
    expect(out).not.toContain('AAAA');
    expect(out).not.toContain('/tmp/lw-git-abc');
    expect(out).toContain('<tmp>/repo/x');
  });

  it('classifies failures', () => {
    expect(classifyGitError('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@', true)).toBe('host-key-changed');
    expect(classifyGitError('Host key verification failed.', false)).toBe('auth');
    expect(classifyGitError('git@host: Permission denied (publickey).', false)).toBe('auth');
    expect(classifyGitError("fatal: Authentication failed for 'https://x/'", false)).toBe('auth');
    expect(classifyGitError(' ! [rejected]        HEAD -> main (fetch first)', false)).toBe('rejected');
    expect(classifyGitError('fatal: Remote branch nope not found in upstream origin', false)).toBe('not-found');
    expect(classifyGitError('fatal: unable to connect', false)).toBe('failed');
  });

  describe('work trees', () => {
    let dir: string;
    let fakeGit: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'lw-git-spec-'));
      fakeGit = join(dir, 'git');
      // The remote is never reached: ls-remote reports an empty repository, everything else is real git.
      writeFileSync(fakeGit, `#!/bin/sh\nif [ "$1" = "ls-remote" ]; then exit 0; fi\nexec git "$@"\n`);
      chmodSync(fakeGit, 0o755);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const client = () =>
      new GitClient({ identity, binary: fakeGit, timeoutMs: 20_000, maxFileBytes: 64, maxFiles: 10 });
    const remote = {
      url: 'https://127.0.0.1:1/acme/repo.git',
      auth: { kind: 'token' as const, username: 'u', token: 'tok-secret-1' },
    };

    it('refuses invalid URLs and branches before running anything', async () => {
      await expect(client().open({ ...remote, url: 'file:///etc' }, 'main')).rejects.toThrow(GitUrlError);
      await expect(client().open(remote, '--upload-pack=x')).rejects.toThrow(GitUrlError);
    });

    it('starts an empty branch, reads / writes files below the root only, commits as Loadweaver', async () => {
      await expect(client().open(remote, 'main')).rejects.toMatchObject({ code: 'not-found' });

      const tree = await client().open(remote, 'main', { allowMissing: true });

      try {
        expect(await tree.head()).toBeNull();
        await tree.writeFile('clusters/prod/shop/a.yaml', 'a: 1\n');
        await tree.writeFile('clusters/prod/b.yml', 'b: 1\n');
        await tree.writeFile('other/c.yaml', 'c: 1\n');
        expect(await tree.listFiles('clusters/prod')).toEqual(['clusters/prod/b.yml', 'clusters/prod/shop/a.yaml']);
        expect((await tree.readFile('clusters/prod/shop/a.yaml')).toString()).toBe('a: 1\n');
        await expect(tree.readFile('../../etc/passwd')).rejects.toThrow(GitError);
        await expect(tree.writeFile('.git/hooks/pre-commit', 'x')).rejects.toThrow(GitError);
        await tree.writeFile('big.yaml', 'x'.repeat(100));
        await expect(tree.readFile('big.yaml')).rejects.toThrow(/larger than 64 bytes/);

        symlinkSync('/etc/passwd', join(tree.dir, 'link.yaml'));
        expect(await tree.listFiles()).not.toContain('link.yaml');
        await expect(tree.readFile('link.yaml')).rejects.toThrow(/not a regular file/);
        await tree.removeFile('link.yaml');
        await tree.removeFile('big.yaml');

        const sha = await tree.commit('Loadweaver plan 1 by alice');

        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(await tree.head()).toEqual({
          sha,
          authorName: 'Loadweaver',
          authorEmail: 'loadweaver@localhost',
          subject: 'Loadweaver plan 1 by alice',
        });
        expect(await tree.commit('nothing')).toBeNull();
        expect(await tree.exists('other/c.yaml')).toBe(true);
        await tree.removeFile('other/c.yaml');
        expect(await tree.commit('remove')).toMatch(/^[0-9a-f]{40}$/);
        expect(
          execFileSync('git', ['-C', tree.dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n'),
        ).toEqual(['remove', 'Loadweaver plan 1 by alice']);

        for (let i = 0; i < 11; i++) await tree.writeFile(`many/${i}.yaml`, 'x: 1\n');

        await expect(tree.listFiles('many')).rejects.toThrow(/more than 10 YAML files/);

        // Only YAML files count toward the limit.
        for (let i = 0; i < 11; i++) await tree.writeFile(`assets/${i}.png`, 'x');

        expect(await tree.listFiles('assets')).toHaveLength(11);
        // Every file written through the tree is known (the secret scan before commits reads them).
        expect((await tree.writtenFiles()).map((f) => f.path)).toEqual(
          expect.arrayContaining(['clusters/prod/shop/a.yaml', 'many/0.yaml', 'assets/3.png']),
        );
        expect((await tree.writtenFiles()).map((f) => f.path)).not.toContain('big.yaml');

        // The push fails (nothing listens), with a scrubbed message.
        const failure = (await tree.push().then(
          () => null,
          (e: unknown) => e,
        )) as GitError;

        expect(failure).toBeInstanceOf(GitError);
        expect(failure.message).not.toContain('tok-secret-1');
        expect(failure.message).not.toContain(Buffer.from('u:tok-secret-1').toString('base64'));
      } finally {
        await tree.dispose();
      }

      expect(existsSync(tree.dir)).toBe(false);
    });
  });

  it('caps the bytes read from one checkout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-git-spec-'));
    const fakeGit = join(dir, 'git');

    writeFileSync(fakeGit, `#!/bin/sh\nif [ "$1" = "ls-remote" ]; then exit 0; fi\nexec git "$@"\n`);
    chmodSync(fakeGit, 0o755);

    const client = new GitClient({ identity, binary: fakeGit, maxReadBytes: 10 });
    const tree = await client.open({ url: 'https://127.0.0.1:1/a/b.git', auth: { kind: 'none' } }, 'main', {
      allowMissing: true,
    });

    try {
      await tree.writeFile('a.yaml', '123456');
      await tree.writeFile('b.yaml', '123456');
      expect((await tree.readFile('a.yaml')).toString()).toBe('123456');
      await expect(tree.readFile('b.yaml')).rejects.toThrow(/more than 10 bytes read/);
    } finally {
      await tree.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills the whole process group on timeout (helpers git started included)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-git-spec-'));
    const fakeGit = join(dir, 'git');
    const pidFile = join(dir, 'child.pid');

    // A "git" whose helper (like ssh) would outlive it.
    writeFileSync(fakeGit, `#!/bin/sh\nsleep 30 &\necho $! > ${pidFile}\nwait\n`);
    chmodSync(fakeGit, 0o755);

    const client = new GitClient({ identity, binary: fakeGit, timeoutMs: 500 });

    try {
      await expect(
        client.lsRemote({ url: 'https://127.0.0.1:1/a/b.git', auth: { kind: 'none' } }, 'main'),
      ).rejects.toMatchObject({
        code: 'timeout',
      });

      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      const alive = () => {
        try {
          process.kill(pid, 0);

          return true;
        } catch {
          return false;
        }
      };

      for (let i = 0; i < 20 && alive(); i++) await new Promise((r) => setTimeout(r, 50));

      expect(alive()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('measures trees and sweeps stale temp dirs of killed processes', async () => {
    const base = mkdtempSync(join(tmpdir(), 'lw-sweep-spec-'));
    const stale = join(base, 'lw-git-old');
    const fresh = join(base, 'lw-git-new');
    const other = join(base, 'unrelated');

    for (const d of [stale, fresh, other]) mkdirSync(d);

    writeFileSync(join(fresh, 'f'), 'x'.repeat(100));
    utimesSync(stale, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    utimesSync(other, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));

    try {
      expect(await treeSize(fresh)).toBe(100);
      expect(await sweepStaleTempDirs(15 * 60_000, base)).toBe(1);
      expect([existsSync(stale), existsSync(fresh), existsSync(other)]).toEqual([false, true, true]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('only fetches pull / merge request heads as refs for the plan bot', async () => {
    const client = new GitClient({ identity });
    const remote = { url: 'https://example.invalid/a/b.git', auth: { kind: 'none' as const }, knownHosts: null };

    for (const ref of [
      'refs/heads/main',
      'refs/pull/0/head',
      'refs/pull/1/merge',
      '--upload-pack=x',
      'refs/pull/1/head;x',
    ])
      await expect(client.openRef(remote, ref)).rejects.toThrow(`invalid pull request ref ${ref}`);
  });
});
