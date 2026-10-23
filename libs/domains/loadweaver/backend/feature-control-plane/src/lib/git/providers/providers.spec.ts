import { EventEmitter } from 'node:events';

import { parseConnectionCredentials } from '../git-connections.service';
import { botAdapter, GitProviderError, providerAdapter, type GitBotProvider } from './index';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  ca?: string;
  body: unknown;
}

const calls: Call[] = [];
let responses: { status: number; body: unknown }[] = [];

jest.mock('node:https', () => ({
  ...jest.requireActual('node:https'),
  request: (
    url: URL,
    options: { method: string; headers: Record<string, string>; ca?: string },
    callback: (res: EventEmitter) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end: (payload?: Buffer) => void; destroy: () => void };

    req.destroy = () => undefined;
    req.end = (payload?: Buffer) => {
      calls.push({
        method: options.method,
        url: url.toString(),
        headers: options.headers,
        ca: options.ca,
        body: payload ? JSON.parse(payload.toString()) : undefined,
      });

      const next = responses.shift() ?? { status: 200, body: {} };
      const res = Object.assign(new EventEmitter(), { statusCode: next.status });

      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(next.body)));
      res.emit('end');
    };

    return req;
  },
}));

const ctx = (apiBase: string, repo: string) => ({ apiBase, repo, token: 'tok', caCertificate: 'PEM' });

describe('git providers', () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
  });

  it('GitHub: statuses, pull requests (reusing an open one), default branch', async () => {
    const github = providerAdapter('github');

    await github.setCommitStatus(ctx('https://api.github.com', 'acme/infra'), {
      sha: 'abc',
      state: 'pending',
      description: 'plan waits',
      context: 'loadweaver/plan',
      targetUrl: 'https://lw.example/plans/1',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/infra/statuses/abc',
      headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      ca: 'PEM',
      body: {
        state: 'pending',
        description: 'plan waits',
        context: 'loadweaver/plan',
        target_url: 'https://lw.example/plans/1',
      },
    });

    responses = [{ status: 201, body: { number: 7, html_url: 'https://github.com/acme/infra/pull/7' } }];
    expect(
      await github.createPullRequest(ctx('https://api.github.com', 'acme/infra'), {
        head: 'lw/p',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).toEqual({ number: 7, url: 'https://github.com/acme/infra/pull/7' });
    expect(calls[1].body).toEqual({ title: 't', head: 'lw/p', base: 'main', body: 'b' });

    responses = [
      { status: 422, body: { message: 'A pull request already exists' } },
      { status: 200, body: [{ number: 8, html_url: 'u8', head: { ref: 'lw/p' } }] },
    ];
    expect(
      await github.createPullRequest(ctx('https://api.github.com', 'acme/infra'), {
        head: 'lw/p',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).toEqual({ number: 8, url: 'u8' });

    responses = [{ status: 200, body: { default_branch: 'trunk' } }];
    expect(await github.getDefaultBranch(ctx('https://api.github.com', 'acme/infra'))).toBe('trunk');

    responses = [{ status: 403, body: { message: 'Resource not accessible by integration' } }];
    await expect(
      github.setCommitStatus(ctx('https://api.github.com', 'acme/infra'), {
        sha: 'a',
        state: 'success',
        description: 'd',
        context: 'c',
      }),
    ).rejects.toThrow(new GitProviderError(403, 'commit status: HTTP 403 (Resource not accessible by integration)'));
    await expect(github.getDefaultBranch(ctx('https://api.github.com', 'a/b/c'))).rejects.toThrow(/invalid repository/);
  });

  it('Gitea: GitHub-shaped API with token auth', async () => {
    const gitea = providerAdapter('gitea');

    responses = [{ status: 201, body: { number: 2, html_url: 'https://gitea/pulls/2' } }];
    await gitea.createPullRequest(ctx('https://gitea.example/api/v1', 'lw/repo'), {
      head: 'h',
      base: 'main',
      title: 't',
      body: 'b',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://gitea.example/api/v1/repos/lw/repo/pulls',
      headers: expect.objectContaining({ authorization: 'token tok' }),
    });
  });

  it('GitLab: statuses (failed / canceled names, same-state transitions tolerated), merge requests', async () => {
    const gitlab = providerAdapter('gitlab');

    await gitlab.setCommitStatus(ctx('https://gitlab.com/api/v4', 'group/sub/project'), {
      sha: 'abc',
      state: 'failure',
      description: 'rejected',
      context: 'loadweaver/plan',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://gitlab.com/api/v4/projects/group%2Fsub%2Fproject/statuses/abc',
      headers: expect.objectContaining({ 'private-token': 'tok' }),
      body: { state: 'failed', name: 'loadweaver/plan', description: 'rejected' },
    });

    responses = [{ status: 400, body: { message: 'Cannot transition status via :run from :running' } }];
    await expect(
      gitlab.setCommitStatus(ctx('https://gitlab.com/api/v4', 'g/p'), {
        sha: 'a',
        state: 'pending',
        description: 'd',
        context: 'c',
      }),
    ).resolves.toBeUndefined();

    responses = [
      { status: 409, body: { message: ['Another open merge request already exists'] } },
      { status: 200, body: [{ iid: 4, web_url: 'https://gitlab.com/g/p/-/merge_requests/4' }] },
    ];
    expect(
      await gitlab.createPullRequest(ctx('https://gitlab.com/api/v4', 'g/p'), {
        head: 'h',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).toEqual({
      number: 4,
      url: 'https://gitlab.com/g/p/-/merge_requests/4',
    });
    expect(calls.at(-1)?.url).toBe(
      'https://gitlab.com/api/v4/projects/g%2Fp/merge_requests?state=opened&source_branch=h',
    );
  });

  it('plain Git has no API', async () => {
    const git = providerAdapter('git');

    expect(git.hasApi).toBe(false);
    const c = ctx('https://x', 'a/b');

    await git.setCommitStatus(c, { sha: 'a', state: 'pending', description: 'd', context: 'c' });
    expect(await git.createPullRequest(c, { head: 'h', base: 'main', title: 't', body: 'b' })).toBeNull();
    expect(await git.getDefaultBranch(c)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reads connection credentials: token, SSH key, or JSON with both', () => {
    expect(parseConnectionCredentials({ apiToken: 'tok' })).toEqual({
      token: 'tok',
      username: null,
      sshPrivateKey: null,
    });
    expect(parseConnectionCredentials({ apiToken: '-----BEGIN OPENSSH PRIVATE KEY-----\nx' })).toEqual({
      token: null,
      username: null,
      sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx',
    });
    expect(parseConnectionCredentials({ token: 't', username: 'bot', sshPrivateKey: 'k' })).toEqual({
      token: 't',
      username: 'bot',
      sshPrivateKey: 'k',
    });
  });

  describe('plan bot (3.30)', () => {
    const pr = {
      number: 7,
      state: 'open' as const,
      draft: false,
      title: 't',
      url: 'u',
      author: 'dev',
      authorId: '42',
      headSha: 'abc',
      headRef: 'feature',
      baseRef: 'main',
      fork: false,
    };

    it('GitHub: PR heads, sticky comments, reactions, mergeability, reviews on the head, merge', async () => {
      const github = botAdapter('github') as GitBotProvider;
      const c = ctx('https://api.github.com', 'acme/infra');

      expect(github.pullRequestRef(7)).toBe('refs/pull/7/head');

      responses = [
        {
          status: 200,
          body: {
            number: 7,
            state: 'closed',
            merged: true,
            title: 'x',
            html_url: 'u',
            user: { login: 'd', id: 42 },
            head: { sha: 's', ref: 'f', repo: { full_name: 'acme/infra' } },
            base: { ref: 'main', repo: { full_name: 'acme/infra' } },
          },
        },
      ];
      expect(await github.getPullRequest(c, 7)).toMatchObject({
        state: 'merged',
        headSha: 's',
        baseRef: 'main',
        author: 'd',
        authorId: '42',
        fork: false,
      });

      // A deleted fork (`head.repo: null`) is a fork.
      responses = [
        {
          status: 200,
          body: {
            number: 7,
            state: 'open',
            head: { sha: 's', ref: 'f', repo: null },
            base: { ref: 'main', repo: { full_name: 'acme/infra' } },
          },
        },
      ];
      expect((await github.getPullRequest(c, 7)).fork).toBe(true);

      // Comments are read back from the API: author id, body and time are the provider's, not the payload's.
      responses = [
        {
          status: 200,
          body: {
            id: 55,
            body: 'loadweaver apply',
            user: { id: 4242, login: 'octo', type: 'User' },
            created_at: '2026-01-02T03:04:05Z',
            issue_url: 'https://api.github.com/repos/acme/infra/issues/7',
          },
        },
      ];
      expect(await github.getComment(c, 7, '55')).toEqual({
        id: '55',
        body: 'loadweaver apply',
        userId: '4242',
        login: 'octo',
        isBot: false,
        createdAt: new Date('2026-01-02T03:04:05Z'),
      });
      expect(calls.at(-1)?.url).toBe('https://api.github.com/repos/acme/infra/issues/comments/55');
      // A comment of another pull request / issue, a missing one, or a non-numeric id is no comment of this PR.
      responses = [
        {
          status: 200,
          body: { id: 55, body: 'x', user: { id: 1 }, created_at: '2026-01-02T03:04:05Z', issue_url: '.../issues/8' },
        },
      ];
      expect(await github.getComment(c, 7, '55')).toBeNull();
      responses = [{ status: 404, body: {} }];
      expect(await github.getComment(c, 7, '56')).toBeNull();
      expect(await github.getComment(c, 7, '../x')).toBeNull();

      responses = [{ status: 201, body: { id: 123 } }];
      expect(await github.createComment(c, 7, 'hello')).toBe('123');
      expect(calls.at(-1)).toMatchObject({
        method: 'POST',
        url: 'https://api.github.com/repos/acme/infra/issues/7/comments',
        body: { body: 'hello' },
      });

      responses = [{ status: 404, body: {} }];
      expect(await github.updateComment(c, 7, '123', 'x')).toBe(false);
      expect(calls.at(-1)).toMatchObject({
        method: 'PATCH',
        url: 'https://api.github.com/repos/acme/infra/issues/comments/123',
      });

      responses = [
        {
          status: 200,
          body: [
            { id: 1, body: 'x' },
            { id: 2, body: '<!-- m -->' },
          ],
        },
      ];
      expect(await github.findComment(c, 7, '<!-- m -->')).toBe('2');

      responses = [{ status: 201, body: {} }];
      await github.react(c, 7, '5', 'eyes');
      expect(calls.at(-1)).toMatchObject({
        url: 'https://api.github.com/repos/acme/infra/issues/comments/5/reactions',
        body: { content: 'eyes' },
      });

      responses = [
        { status: 200, body: { state: 'open', mergeable: true, mergeable_state: 'blocked', head: { sha: 'abc' } } },
        {
          status: 200,
          body: {
            statuses: [
              { context: 'loadweaver/plan', state: 'pending' },
              { context: 'ci', state: 'success' },
            ],
          },
        },
        { status: 403, body: { message: 'Resource not accessible by integration' } },
        { status: 200, body: { data: { repository: { pullRequest: { reviewDecision: 'APPROVED' } } } } },
      ];
      expect(await github.mergeability(c, pr, 'loadweaver/plan')).toEqual({
        mergeable: true,
        pending: false,
        reasons: [],
      });
      expect(calls.at(-1)).toMatchObject({
        method: 'POST',
        url: 'https://api.github.com/graphql',
        body: { variables: { owner: 'acme', name: 'infra', number: 7 } },
      });

      // Required reviews (branch protection / code owners) block like GitLab's `not_approved` (M2).
      for (const [decision, reason] of [
        ['REVIEW_REQUIRED', 'it needs the reviews GitHub requires'],
        ['CHANGES_REQUESTED', 'a reviewer requested changes'],
      ]) {
        responses = [
          { status: 200, body: { state: 'open', mergeable: true, mergeable_state: 'blocked', head: { sha: 'abc' } } },
          { status: 200, body: { statuses: [] } },
          { status: 200, body: { check_runs: [] } },
          { status: 200, body: { data: { repository: { pullRequest: { reviewDecision: decision } } } } },
        ];
        expect(await github.mergeability(c, pr, 'loadweaver/plan')).toEqual({
          mergeable: false,
          pending: false,
          reasons: [reason],
        });
      }

      // No answer about reviews: not mergeable yet (fail closed).
      responses = [
        { status: 200, body: { state: 'open', mergeable: true, head: { sha: 'abc' } } },
        { status: 200, body: { statuses: [] } },
        { status: 200, body: { check_runs: [] } },
        { status: 502, body: {} },
      ];
      expect(await github.mergeability(c, pr, 'loadweaver/plan')).toMatchObject({ mergeable: false, pending: true });

      responses = [
        {
          status: 200,
          body: [
            { user: { id: 1, login: 'a' }, state: 'APPROVED', commit_id: 'abc' },
            { user: { id: 2, login: 'b' }, state: 'APPROVED', commit_id: 'old' },
            { user: { id: 3, login: 'c' }, state: 'APPROVED', commit_id: 'abc' },
            { user: { id: 3, login: 'c' }, state: 'CHANGES_REQUESTED', commit_id: 'abc' },
            { user: { id: 4, login: 'd' }, state: 'COMMENTED', commit_id: 'abc' },
          ],
        },
      ];
      expect(await github.approvals(c, pr)).toEqual({ approvals: [{ userId: '1', login: 'a' }], ignored: null });

      // Exactly the applied commit is merged (M1).
      responses = [{ status: 200, body: { merged: true } }];
      await github.merge(c, 7, 'applied-sha', 'Merge');
      expect(calls.at(-1)).toMatchObject({
        method: 'PUT',
        url: 'https://api.github.com/repos/acme/infra/pulls/7/merge',
        body: { sha: 'applied-sha', merge_method: 'merge', commit_title: 'Merge' },
      });

      responses = [{ status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } }];
      await expect(github.merge(c, 7, 'applied-sha', 'Merge')).rejects.toThrow('merge: HTTP 409');
    });

    it('GitLab: MR heads, notes, award emoji, mergeability, approvals, merge', async () => {
      const gitlab = botAdapter('gitlab') as GitBotProvider;
      const c = ctx('https://gitlab.com/api/v4', 'g/p');

      expect(gitlab.pullRequestRef(3)).toBe('refs/merge-requests/3/head');

      responses = [
        {
          status: 200,
          body: {
            iid: 3,
            state: 'opened',
            sha: 'def',
            source_branch: 'f',
            target_branch: 'main',
            web_url: 'w',
            author: { username: 'd' },
          },
        },
      ];
      expect(await gitlab.getPullRequest(c, 3)).toMatchObject({ number: 3, state: 'open', headSha: 'def', url: 'w' });
      expect(calls.at(-1)?.url).toBe('https://gitlab.com/api/v4/projects/g%2Fp/merge_requests/3');

      responses = [
        {
          status: 200,
          body: {
            id: 77,
            body: 'loadweaver approve',
            author: { id: 9, username: 'ops' },
            created_at: '2026-01-02T03:04:05.123Z',
            system: false,
            noteable_iid: 3,
          },
        },
      ];
      expect(await gitlab.getComment(c, 3, '77')).toMatchObject({ userId: '9', login: 'ops', isBot: false });
      expect(calls.at(-1)?.url).toBe('https://gitlab.com/api/v4/projects/g%2Fp/merge_requests/3/notes/77');
      responses = [{ status: 200, body: { id: 77, body: 'x', system: true, created_at: '2026-01-02T03:04:05Z' } }];
      expect(await gitlab.getComment(c, 3, '77')).toBeNull();
      responses = [
        {
          status: 200,
          body: { id: 77, body: 'x', noteable_iid: 4, author: { id: 9 }, created_at: '2026-01-02T03:04:05Z' },
        },
      ];
      expect(await gitlab.getComment(c, 3, '77')).toBeNull();

      responses = [{ status: 201, body: { id: 77 } }];
      expect(await gitlab.createComment(c, 3, 'hi')).toBe('77');

      responses = [{ status: 200, body: {} }];
      expect(await gitlab.updateComment(c, 3, '77', 'x')).toBe(true);
      expect(calls.at(-1)).toMatchObject({
        method: 'PUT',
        url: 'https://gitlab.com/api/v4/projects/g%2Fp/merge_requests/3/notes/77',
      });

      responses = [{ status: 201, body: {} }];
      await gitlab.react(c, 3, '77', '+1');
      expect(calls.at(-1)?.body).toEqual({ name: 'thumbsup' });

      responses = [
        { status: 200, body: { state: 'opened', detailed_merge_status: 'ci_still_running', sha: 'def' } },
        { status: 200, body: [{ id: 1, name: 'loadweaver/plan', status: 'pending' }] },
      ];
      expect((await gitlab.mergeability(c, { ...pr, number: 3 }, 'loadweaver/plan')).mergeable).toBe(true);

      // Approvals count when the project resets them on push (H3) ...
      responses = [
        { status: 200, body: { approved_by: [{ user: { id: 9, username: 'ops' } }] } },
        { status: 200, body: { reset_approvals_on_push: true } },
      ];
      expect(await gitlab.approvals(c, { ...pr, number: 3 })).toEqual({
        approvals: [{ userId: '9', login: 'ops' }],
        ignored: null,
      });
      expect(calls.at(-1)?.url).toBe('https://gitlab.com/api/v4/projects/g%2Fp/approvals');

      // ... otherwise only if given after the current head was pushed.
      const approvalState = (approvedAt: string) => [
        {
          status: 200,
          body: {
            approved_by: [{ user: { id: 9, username: 'ops' } }, { user: { id: 10, username: 'lead' } }],
          },
        },
        { status: 200, body: { reset_approvals_on_push: false } },
        {
          status: 200,
          body: [
            { head_commit_sha: 'abc', created_at: '2026-01-02T10:00:00Z' },
            { head_commit_sha: 'old', created_at: '2026-01-02T09:00:00Z' },
          ],
        },
        {
          status: 200,
          body: [
            {
              system: true,
              body: 'approved this merge request',
              author: { id: 10 },
              created_at: '2026-01-02T10:05:00Z',
            },
            { system: true, body: 'approved this merge request', author: { id: 9 }, created_at: approvedAt },
          ],
        },
      ];

      responses = approvalState('2026-01-02T09:30:00Z');
      expect(await gitlab.approvals(c, { ...pr, number: 3 })).toEqual({
        approvals: [{ userId: '10', login: 'lead' }],
        ignored: expect.stringContaining('1 GitLab approval(s) ignored'),
      });

      responses = approvalState('2026-01-02T10:01:00Z');
      expect((await gitlab.approvals(c, { ...pr, number: 3 })).approvals).toHaveLength(2);

      // The head's push time unknown (Community Edition without the version): every approval is ignored.
      responses = [
        { status: 200, body: { approved_by: [{ user: { id: 9, username: 'ops' } }] } },
        { status: 404, body: {} },
        { status: 200, body: [] },
        { status: 200, body: [] },
      ];
      expect(await gitlab.approvals(c, { ...pr, number: 3 })).toEqual({
        approvals: [],
        ignored: expect.stringContaining('ignored'),
      });

      responses = [{ status: 200, body: {} }];
      await gitlab.merge(c, 3, 'abc', 'Merge');
      expect(calls.at(-1)).toMatchObject({
        method: 'PUT',
        url: 'https://gitlab.com/api/v4/projects/g%2Fp/merge_requests/3/merge',
        body: { sha: 'abc' },
      });
    });

    it('has no bot for Gitea and plain Git', () => {
      expect(botAdapter('gitea')).toBeNull();
      expect(botAdapter('git')).toBeNull();
    });
  });
});
