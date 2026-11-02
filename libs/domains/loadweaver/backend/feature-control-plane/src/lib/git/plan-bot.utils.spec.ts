import {
  githubMergeability,
  gitlabMergeability,
  isFork,
  newOAuthNonce,
  OAUTH_STATE_TTL_MS,
  parseBotCommand,
  parseBotEvent,
  signOAuthState,
  verifyOAuthState,
} from './plan-bot.utils';

const KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

describe('plan bot commands', () => {
  it('parses the commands on the first non-empty line, case-insensitively', () => {
    expect(parseBotCommand('\n  loadweaver plan\nthanks')).toEqual({ name: 'plan' });
    expect(parseBotCommand('Loadweaver APPLY')).toEqual({ name: 'apply', confirm: false });
    expect(parseBotCommand('loadweaver apply --confirm')).toEqual({ name: 'apply', confirm: true });
    expect(parseBotCommand('loadweaver plan shop')).toEqual({ name: 'plan', project: 'shop' });
    expect(parseBotCommand('loadweaver plan clusters/prod/')).toEqual({ name: 'plan', path: 'clusters/prod' });
    expect(parseBotCommand('loadweaver unlock')).toEqual({ name: 'unlock' });
    expect(parseBotCommand('loadweaver approve')).toEqual({ name: 'approve' });
    expect(parseBotCommand('loadweaver drift')).toEqual({ name: 'drift' });
    expect(parseBotCommand('loadweaver help')).toEqual({ name: 'help' });
  });

  it('ignores normal discussion and explains invalid commands', () => {
    expect(parseBotCommand('LGTM, will loadweaver apply later')).toBeNull();
    expect(parseBotCommand('')).toBeNull();
    expect(parseBotCommand('<!-- loadweaver:plan -->\nloadweaver apply')).toBeNull();
    expect(parseBotCommand('loadweaver deploy')).toEqual({ name: 'invalid', reason: 'unknown command `deploy`' });
    expect(parseBotCommand('loadweaver')).toEqual({ name: 'invalid', reason: 'no command given' });
    expect(parseBotCommand('loadweaver apply now')).toMatchObject({ name: 'invalid' });
    expect(parseBotCommand('loadweaver plan ../etc')).toMatchObject({ name: 'invalid' });
    expect(parseBotCommand('loadweaver plan a b')).toMatchObject({ name: 'invalid' });
    expect(parseBotCommand('loadweaver unlock please')).toMatchObject({ name: 'invalid' });
  });
});

describe('plan bot webhook payloads', () => {
  const pr = (action: string, extra: object = {}) => ({
    action,
    pull_request: {
      number: 7,
      title: 'Add api',
      html_url: 'https://github.com/acme/infra/pull/7',
      head: { sha: 'abc', ref: 'feature' },
      base: { ref: 'main' },
      user: { login: 'dev' },
      merged: false,
      ...extra,
    },
  });

  it('maps GitHub pull request and comment events', () => {
    expect(parseBotEvent('github', 'pull_request', pr('opened'))).toEqual({
      kind: 'pull-request',
      action: 'opened',
      number: 7,
      headSha: 'abc',
      headRef: 'feature',
      baseRef: 'main',
      title: 'Add api',
      url: 'https://github.com/acme/infra/pull/7',
      author: 'dev',
      fork: false,
    });
    expect(
      parseBotEvent(
        'github',
        'pull_request',
        pr('opened', {
          head: { sha: 'abc', ref: 'f', repo: { full_name: 'evil/infra' } },
          base: { ref: 'main', repo: { full_name: 'acme/infra' } },
        }),
      ),
    ).toMatchObject({ fork: true });
    expect(parseBotEvent('github', 'pull_request', pr('synchronize'))).toMatchObject({ action: 'updated' });
    expect(parseBotEvent('github', 'pull_request', pr('reopened'))).toMatchObject({ action: 'opened' });
    expect(parseBotEvent('github', 'pull_request', pr('closed'))).toMatchObject({ action: 'closed' });
    expect(parseBotEvent('github', 'pull_request', pr('closed', { merged: true }))).toMatchObject({ action: 'merged' });
    expect(parseBotEvent('github', 'pull_request', pr('labeled'))).toMatchObject({ action: 'other' });
    expect(
      parseBotEvent('github', 'issue_comment', {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { id: 99, body: 'loadweaver apply', user: { id: 42, login: 'ops', type: 'User' } },
      }),
    ).toEqual({
      kind: 'comment',
      number: 7,
      commentId: '99',
      body: 'loadweaver apply',
      userId: '42',
      login: 'ops',
      isBot: false,
    });
    // Issue comments (not on a pull request) and edits are no commands.
    expect(
      parseBotEvent('github', 'issue_comment', {
        action: 'created',
        issue: { number: 7 },
        comment: { id: 1, body: 'loadweaver apply', user: { id: 1 } },
      }),
    ).toBeNull();
    expect(
      parseBotEvent('github', 'issue_comment', { action: 'edited', issue: { pull_request: {} }, comment: {} }),
    ).toBeNull();
    expect(parseBotEvent('github', 'push', { ref: 'refs/heads/main' })).toBeNull();
  });

  it('maps GitLab merge request and note hooks', () => {
    const mr = (action: string, oldrev?: string) => ({
      user: { username: 'dev' },
      object_attributes: {
        iid: 3,
        action,
        title: 'Change',
        url: 'https://gitlab.example.com/g/p/-/merge_requests/3',
        source_branch: 'feature',
        target_branch: 'main',
        last_commit: { id: 'def' },
        ...(oldrev ? { oldrev } : {}),
      },
    });

    expect(parseBotEvent('gitlab', 'Merge Request Hook', mr('open'))).toMatchObject({
      kind: 'pull-request',
      action: 'opened',
      number: 3,
      headSha: 'def',
      baseRef: 'main',
      author: 'dev',
      fork: false,
    });
    expect(parseBotEvent('gitlab', 'merge request hook', mr('update', 'abc'))).toMatchObject({ action: 'updated' });
    expect(
      parseBotEvent('gitlab', 'merge request hook', {
        object_attributes: { iid: 1, action: 'open', source_project_id: 9, target_project_id: 3 },
      }),
    ).toMatchObject({ fork: true });
    expect(parseBotEvent('gitlab', 'merge request hook', mr('update'))).toMatchObject({ action: 'other' });
    expect(parseBotEvent('gitlab', 'merge request hook', mr('merge'))).toMatchObject({ action: 'merged' });
    expect(parseBotEvent('gitlab', 'merge request hook', mr('close'))).toMatchObject({ action: 'closed' });
    expect(
      parseBotEvent('gitlab', 'Note Hook', {
        user: { id: 5, username: 'ops' },
        merge_request: { iid: 3 },
        object_attributes: { id: 11, noteable_type: 'MergeRequest', note: 'loadweaver plan' },
      }),
    ).toEqual({
      kind: 'comment',
      number: 3,
      commentId: '11',
      body: 'loadweaver plan',
      userId: '5',
      login: 'ops',
      isBot: false,
    });
    expect(
      parseBotEvent('gitlab', 'Note Hook', {
        user: { id: 5 },
        object_attributes: { id: 11, noteable_type: 'Issue', note: 'loadweaver plan' },
      }),
    ).toBeNull();
  });
});

describe('mergeability (3.30)', () => {
  const open = { state: 'open', mergeable: true, mergeable_state: 'blocked', draft: false };

  it('GitHub: Loadweaver’s own pending status never blocks; other checks, conflicts and drafts do', () => {
    expect(githubMergeability(open, [{ context: 'loadweaver/plan', state: 'pending' }], [], 'loadweaver/plan')).toEqual(
      {
        mergeable: true,
        pending: false,
        reasons: [],
      },
    );
    expect(
      githubMergeability(
        open,
        [
          { context: 'ci/build', state: 'failure' },
          { context: 'ci/lint', state: 'pending' },
        ],
        [{ name: 'tests', status: 'completed', conclusion: 'failure' }],
        'loadweaver/plan',
      ),
    ).toEqual({
      mergeable: false,
      pending: true,
      reasons: ['check `ci/build` is failure', 'check `ci/lint` is still running', 'check `tests` is failure'],
    });
    expect(githubMergeability({ ...open, mergeable: false, mergeable_state: 'dirty' }, [], [], 'x').reasons).toEqual([
      'it has merge conflicts',
    ]);
    expect(githubMergeability({ ...open, mergeable: null }, [], [], 'x')).toMatchObject({
      mergeable: false,
      pending: true,
    });
    expect(githubMergeability({ ...open, draft: true }, [], [], 'x').reasons).toEqual(['the pull request is a draft']);
    expect(githubMergeability({ ...open, mergeable_state: 'behind' }, [], [], 'x').mergeable).toBe(false);
    expect(
      githubMergeability(open, [], [{ name: 'skip', status: 'completed', conclusion: 'skipped' }], 'x').mergeable,
    ).toBe(true);
    expect(githubMergeability({ ...open, state: 'closed' }, [], [], 'x').reasons).toContain(
      'the pull request is not open',
    );
  });

  it('GitLab: detailed merge status and commit statuses without Loadweaver’s own', () => {
    const mr = { state: 'opened', detailed_merge_status: 'ci_still_running' };

    expect(gitlabMergeability(mr, [{ id: 1, name: 'loadweaver/plan', status: 'running' }], 'loadweaver/plan')).toEqual({
      mergeable: true,
      pending: false,
      reasons: [],
    });
    expect(
      gitlabMergeability(
        mr,
        [
          { id: 1, name: 'test', status: 'failed' },
          { id: 2, name: 'test', status: 'success' },
          { id: 3, name: 'lint', status: 'failed', allow_failure: true },
          { id: 4, name: 'build', status: 'running' },
        ],
        'loadweaver/plan',
      ),
    ).toEqual({ mergeable: false, pending: true, reasons: ['check `build` is still running'] });
    expect(gitlabMergeability({ state: 'opened', detailed_merge_status: 'conflict' }, [], 'x').reasons).toEqual([
      'it has merge conflicts',
    ]);
    expect(gitlabMergeability({ state: 'opened', detailed_merge_status: 'not_approved' }, [], 'x').reasons).toEqual([
      'it needs the approvals GitLab requires',
    ]);
    expect(gitlabMergeability({ state: 'opened', detailed_merge_status: 'checking' }, [], 'x')).toMatchObject({
      mergeable: false,
      pending: true,
    });
    expect(gitlabMergeability({ state: 'opened', merge_status: 'can_be_merged' }, [], 'x').mergeable).toBe(true);
    expect(gitlabMergeability({ state: 'opened', merge_status: 'cannot_be_merged' }, [], 'x').mergeable).toBe(false);
    expect(gitlabMergeability({ state: 'merged', detailed_merge_status: 'not_open' }, [], 'x').mergeable).toBe(false);
    expect(
      gitlabMergeability({ state: 'opened', draft: true, detailed_merge_status: 'draft_status' }, [], 'x').reasons,
    ).toEqual(['the merge request is a draft']);
  });
});

describe('OAuth state (account linking)', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  const state = {
    userId: 'u-1',
    provider: 'github' as const,
    nonce: newOAuthNonce(),
    expiresAt: now + OAUTH_STATE_TTL_MS,
  };

  it('round-trips a signed state until it expires', () => {
    const token = signOAuthState(KEY, state);

    expect(verifyOAuthState(KEY, token, now)).toEqual(state);
    expect(verifyOAuthState(KEY, token, now + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    expect(state.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('carries a fleet console’s return page signed in the state (3.41)', () => {
    const back = { ...state, returnUrl: 'https://fleet.example.com/account/git-accounts' };
    const token = signOAuthState(KEY, back);
    const [, signature] = token.split('.');
    const swapped = Buffer.from(
      JSON.stringify({ u: back.userId, p: 'github', n: back.nonce, e: back.expiresAt, r: 'https://evil.example.com' }),
      'utf8',
    ).toString('base64url');

    expect(verifyOAuthState(KEY, token, now)).toEqual(back);
    expect(verifyOAuthState(KEY, `${swapped}.${signature}`, now)).toBeNull();
  });

  it('rejects tampering, other keys, far-future expiries and junk', () => {
    const token = signOAuthState(KEY, state);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: 'admin', p: 'github', n: state.nonce, e: state.expiresAt }),
      'utf8',
    ).toString('base64url');

    expect(verifyOAuthState(KEY, `${forged}.${signature}`, now)).toBeNull();
    expect(verifyOAuthState(KEY, `${payload}.${signature.slice(0, -2)}AA`, now)).toBeNull();
    expect(verifyOAuthState('another-key', token, now)).toBeNull();
    expect(verifyOAuthState(KEY, signOAuthState(KEY, { ...state, expiresAt: now + 24 * 3_600_000 }), now)).toBeNull();
    expect(verifyOAuthState(KEY, signOAuthState(KEY, { ...state, provider: 'bitbucket' as 'github' }), now)).toBeNull();
    expect(verifyOAuthState(KEY, 'x', now)).toBeNull();
    expect(verifyOAuthState(KEY, `${payload}.${signature}.x`, now)).toBeNull();
    expect(verifyOAuthState(KEY, 'a'.repeat(2000), now)).toBeNull();
  });
});

describe('forks and required reviews', () => {
  it('treats an unknown head repository as a fork when the base is known (L3)', () => {
    expect(isFork('acme/infra', 'acme/infra')).toBe(false);
    expect(isFork('other/infra', 'acme/infra')).toBe(true);
    expect(isFork(null, 'acme/infra')).toBe(true);
    expect(isFork(undefined, 'acme/infra')).toBe(true);
    expect(isFork(3, 3)).toBe(false);
    expect(isFork(undefined, undefined)).toBe(false);
  });

  it('parses a GitHub pull request with a deleted fork as a fork', () => {
    const event = parseBotEvent('github', 'pull_request', {
      action: 'opened',
      pull_request: {
        number: 1,
        head: { sha: 'a', ref: 'x', repo: null },
        base: { ref: 'main', repo: { full_name: 'a/b' } },
      },
    });

    expect(event).toMatchObject({ kind: 'pull-request', fork: true });
  });

  it('blocks GitHub pull requests on required reviews (M2)', () => {
    const pr = { state: 'open', mergeable: true, mergeable_state: 'blocked' };

    expect(githubMergeability(pr, [], [], 'loadweaver/plan', 'APPROVED').mergeable).toBe(true);
    expect(githubMergeability(pr, [], [], 'loadweaver/plan', null).mergeable).toBe(true);
    expect(githubMergeability(pr, [], [], 'loadweaver/plan', 'REVIEW_REQUIRED')).toEqual({
      mergeable: false,
      pending: false,
      reasons: ['it needs the reviews GitHub requires'],
    });
    expect(githubMergeability(pr, [], [], 'loadweaver/plan', 'CHANGES_REQUESTED').reasons).toEqual([
      'a reviewer requested changes',
    ]);
    expect(githubMergeability(pr, [], [], 'loadweaver/plan', 'unknown')).toMatchObject({
      mergeable: false,
      pending: true,
    });
  });
});
