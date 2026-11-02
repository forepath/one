import { execFileSync, spawn } from 'node:child_process';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Test doubles for the plan bot (3.30), all in the test process over HTTPS (self-signed for 127.0.0.1): real Git
 * repositories served by `git http-backend` (smart HTTP), and the parts of the GitHub and GitLab APIs the bot uses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies
type Json = any;

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Dev Eloper',
  GIT_AUTHOR_EMAIL: 'dev@example.test',
  GIT_COMMITTER_NAME: 'Dev Eloper',
  GIT_COMMITTER_EMAIL: 'dev@example.test',
};

export function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], HOME: tmpdir(), ...GIT_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** A self-signed certificate for 127.0.0.1 (openssl on the host). */
export function selfSigned(dir: string): { cert: string; key: string } {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '2',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore' },
  );

  return {
    cert: execFileSync('cat', [join(dir, 'cert.pem')], { encoding: 'utf8' }),
    key: execFileSync('cat', [join(dir, 'key.pem')], { encoding: 'utf8' }),
  };
}

export interface MockComment {
  id: number;
  body: string;
  user: string;
  /** Provider user id of the author (the bot: 1). */
  userId?: number;
  createdAt?: string;
  system?: boolean;
}

export interface MockPull {
  number: number;
  title: string;
  head: string;
  sha: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  /** Provider user id of the author. */
  authorId?: number;
  /** The head's repository when it is a fork. */
  forkOf?: string;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, json?: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json === undefined ? '' : JSON.stringify(json));
}

/** GitHub + GitLab + Git hosting in one HTTPS server. */
export class MockGitHosting {
  readonly dir = mkdtempSync(join(tmpdir(), 'lw-it-bot-'));
  readonly repos = join(this.dir, 'repos');
  private server!: Server;
  ca = '';
  port = 0;
  /** Authorization headers Git requests came with. */
  readonly gitAuth: string[] = [];
  /** Every API call: `METHOD path`. */
  readonly calls: string[] = [];
  appPublicKey: KeyObject | null = null;
  appId = 0;

  readonly github = {
    pulls: new Map<number, MockPull & { mergeable: boolean | null; draft: boolean }>(),
    comments: new Map<number, MockComment[]>(),
    statuses: new Map<string, Map<string, string>>(),
    reactions: [] as { comment: string; content: string }[],
    reviews: new Map<number, { user: { id: number; login: string }; state: string; commit_id: string }[]>(),
    /** Statuses of other CI systems, per sha. */
    extraStatuses: new Map<string, { context: string; state: string }[]>(),
    nextComment: 1000,
    nextPull: 100,
    installationTokens: 0,
    /** GraphQL `reviewDecision` per pull request (null: no review required). */
    reviewDecision: new Map<number, string | null>(),
    /** Pull requests whose head moves right before a merge (someone pushed meanwhile). */
    moveHeadOnMerge: new Set<number>(),
    /** Delay of `POST /pulls` (a slow provider). */
    createPullDelayMs: 0,
  };

  readonly gitlab = {
    mrs: new Map<number, MockPull & { detailed: string }>(),
    notes: new Map<number, MockComment[]>(),
    statuses: new Map<string, { id: number; name: string; status: string }[]>(),
    approvals: new Map<number, { id: number; username: string }[]>(),
    awards: [] as { note: string; name: string }[],
    nextNote: 5000,
    nextStatus: 1,
    /** Project setting `reset_approvals_on_push`. */
    resetApprovalsOnPush: false,
    /** MR versions (pushes): head sha and when it was pushed. */
    versions: new Map<number, { head_commit_sha: string; created_at: string }[]>(),
  };

  /** A user's comment on a GitHub pull request, as GitHub stores it; returns its id. */
  githubUserComment(n: number, body: string, user: { id: number; login: string }, createdAt = new Date()): number {
    const id = this.github.nextComment++;

    this.github.comments.set(n, [
      ...(this.github.comments.get(n) ?? []),
      { id, body, user: user.login, userId: user.id, createdAt: createdAt.toISOString() },
    ]);

    return id;
  }

  /** A user's note on a GitLab merge request (or a system note), as GitLab stores it; returns its id. */
  gitlabUserNote(
    n: number,
    body: string,
    user: { id: number; username: string },
    options: { createdAt?: Date; system?: boolean } = {},
  ): number {
    const id = this.gitlab.nextNote++;

    this.gitlab.notes.set(n, [
      ...(this.gitlab.notes.get(n) ?? []),
      {
        id,
        body,
        user: user.username,
        userId: user.id,
        createdAt: (options.createdAt ?? new Date()).toISOString(),
        system: options.system ?? false,
      },
    ]);

    return id;
  }

  /** OAuth: code → provider user. */
  readonly oauthUsers = new Map<string, { id: number; login: string }>();

  get origin(): string {
    return `https://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const { cert, key } = selfSigned(this.dir);

    this.ca = cert;
    mkdirSync(this.repos, { recursive: true });
    this.server = createServer({ cert, key }, (req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        send(res, 500, { message: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Repositories
  // ---------------------------------------------------------------------------------------------------------------

  /** A bare repository `<owner>/<name>.git` with one commit on `main`. */
  createRepo(slug: string, files: Record<string, string>): string {
    const bare = join(this.repos, `${slug}.git`);

    mkdirSync(dirname(bare), { recursive: true });
    git(['init', '-q', '--bare', '-b', 'main', bare]);
    git(['config', 'http.receivepack', 'true'], bare);

    return this.commit(slug, 'main', files, 'initial', null);
  }

  /** Commits files (null = delete) on a branch (created from `from`), returns the sha. */
  commit(
    slug: string,
    branch: string,
    files: Record<string, string | null>,
    message: string,
    from: string | null = branch,
  ): string {
    const bare = join(this.repos, `${slug}.git`);
    const work = mkdtempSync(join(this.dir, 'work-'));

    git(['init', '-q', '-b', branch, work]);

    if (from) {
      git(['fetch', '-q', bare, `refs/heads/${from}`], work);
      git(['checkout', '-q', '-B', branch, 'FETCH_HEAD'], work);
    }

    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        git(['rm', '-q', path], work);
        continue;
      }

      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), content);
      git(['add', path], work);
    }

    git(['commit', '-q', '-m', message], work);
    git(['push', '-q', bare, `HEAD:refs/heads/${branch}`], work);

    return git(['rev-parse', 'HEAD'], work);
  }

  setRef(slug: string, ref: string, sha: string): void {
    git(['update-ref', ref, sha], join(this.repos, `${slug}.git`));
  }

  ref(slug: string, ref: string): string {
    return git(['rev-parse', ref], join(this.repos, `${slug}.git`));
  }

  readFile(slug: string, ref: string, path: string): string | null {
    try {
      return git(['show', `${ref}:${path}`], join(this.repos, `${slug}.git`));
    } catch {
      return null;
    }
  }

  /** `git http-backend` as CGI (smart HTTP fetch and push). */
  private async gitBackend(req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<void> {
    this.gitAuth.push(String(req.headers['authorization'] ?? ''));

    const input = await body(req);
    const child = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env['PATH'],
        HOME: this.dir,
        ...GIT_ENV,
        GIT_PROJECT_ROOT: this.repos,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: path,
        QUERY_STRING: query,
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
        CONTENT_LENGTH: String(input.length),
        HTTP_CONTENT_ENCODING: String(req.headers['content-encoding'] ?? ''),
        HTTP_GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
        REMOTE_USER: 'loadweaver',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    const out: Buffer[] = [];

    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stdin.end(input);
    await new Promise<void>((resolve) => child.on('close', () => resolve()));

    const raw = Buffer.concat(out);
    const split = raw.indexOf('\r\n\r\n');
    const headerText = raw.subarray(0, split).toString('utf8');
    const headers: Record<string, string> = {};
    let status = 200;

    for (const line of headerText.split('\r\n')) {
      const [name, ...rest] = line.split(':');
      const value = rest.join(':').trim();

      if (name.toLowerCase() === 'status') status = parseInt(value, 10);
      else if (name) headers[name] = value;
    }

    res.writeHead(status, headers);
    res.end(raw.subarray(split + 4));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin);
    const raw = (req.url ?? '/').split('?')[0];
    const gitPath = /^(\/[^/]+\/[^/]+\.git)(\/.*)$/.exec(raw);

    if (gitPath) return await this.gitBackend(req, res, raw, url.search.slice(1));

    this.calls.push(`${req.method} ${raw}`);

    const text = (await body(req)).toString('utf8');
    const json: Json = text ? JSON.parse(text) : {};

    if (raw.startsWith('/github/')) return this.githubApi(req, res, raw.slice('/github'.length), url, json);

    if (raw.startsWith('/gitlab/')) return this.gitlabApi(req, res, raw.slice('/gitlab'.length), json, url);

    send(res, 404, { message: 'Not Found' });
  }

  private appJwtValid(req: IncomingMessage): boolean {
    const token = /^Bearer (.+)$/.exec(String(req.headers['authorization'] ?? ''))?.[1];

    if (!token || !this.appPublicKey) return false;

    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8') || '{}');

    return (
      !!signature &&
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        this.appPublicKey,
        Buffer.from(signature, 'base64url'),
      ) &&
      claims.iss === String(this.appId) &&
      claims.exp * 1000 > Date.now()
    );
  }

  setAppKey(publicKeyPem: string, appId: number): void {
    this.appPublicKey = createPublicKey(publicKeyPem);
    this.appId = appId;
  }

  githubPull(n: number): Json {
    const pr = this.github.pulls.get(n);

    if (!pr) return null;

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state === 'open' ? 'open' : 'closed',
      merged: pr.state === 'merged',
      draft: pr.draft,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable === false ? 'dirty' : 'blocked',
      html_url: `${this.origin}/acme/infra/pull/${pr.number}`,
      user: { login: pr.author, id: pr.authorId ?? 1001 },
      head: { sha: pr.sha, ref: pr.head, repo: { full_name: pr.forkOf ?? 'acme/infra' } },
      base: { ref: 'main', repo: { full_name: 'acme/infra' } },
    };
  }

  private githubApi(req: IncomingMessage, res: ServerResponse, path: string, url: URL, json: Json): void {
    const gh = this.github;
    const method = req.method ?? 'GET';
    let m: RegExpExecArray | null;

    // OAuth (account linking).
    if (method === 'POST' && path === '/web/login/oauth/access_token') {
      const user = this.oauthUsers.get(json.code);

      return user && json.client_secret === 'github-client-secret'
        ? send(res, 200, { access_token: `gho_${json.code}`, token_type: 'bearer' })
        : send(res, 200, { error: 'bad_verification_code' });
    }

    if (method === 'GET' && path === '/api/user') {
      const code = /^Bearer gho_(.+)$/.exec(String(req.headers['authorization'] ?? ''))?.[1];
      const user = code ? this.oauthUsers.get(code) : undefined;

      return user ? send(res, 200, { id: user.id, login: user.login }) : send(res, 401, { message: 'Bad credentials' });
    }

    // The GitHub App.
    if (method === 'GET' && path === '/api/repos/acme/infra/installation')
      return this.appJwtValid(req)
        ? send(res, 200, { id: 55 })
        : send(res, 401, { message: 'A JSON web token could not be decoded' });

    if (method === 'POST' && path === '/api/app/installations/55/access_tokens') {
      if (!this.appJwtValid(req)) return send(res, 401, { message: 'bad jwt' });

      gh.installationTokens++;

      return send(res, 201, {
        token: 'ghs_mockinstallation',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }

    if (String(req.headers['authorization'] ?? '') !== 'Bearer ghs_mockinstallation')
      return send(res, 401, { message: 'Bad credentials' });

    if (method === 'GET' && path === '/api/repos/acme/infra') return send(res, 200, { default_branch: 'main' });

    if (method === 'POST' && path === '/api/graphql') {
      const n = Number(json.variables?.number);

      return send(res, 200, {
        data: { repository: { pullRequest: { reviewDecision: gh.reviewDecision.get(n) ?? null } } },
      });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/issues\/comments\/(\d+)$/.exec(path)) && method === 'GET') {
      for (const [number, list] of gh.comments) {
        const c = list.find((x) => x.id === Number(m?.[1]));

        if (c)
          return send(res, 200, {
            id: c.id,
            body: c.body,
            user: { id: c.userId ?? 1, login: c.user, type: c.user.endsWith('[bot]') ? 'Bot' : 'User' },
            created_at: c.createdAt ?? new Date().toISOString(),
            issue_url: `${this.origin}/github/api/repos/acme/infra/issues/${number}`,
          });
      }

      return send(res, 404, { message: 'Not Found' });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/statuses\/([0-9a-f]{40})$/.exec(path)) && method === 'POST') {
      const map = gh.statuses.get(m[1]) ?? new Map<string, string>();

      map.set(json.context, json.state);
      gh.statuses.set(m[1], map);

      return send(res, 201, { id: 1 });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/commits\/([0-9a-f]{40})\/status$/.exec(path)))
      return send(res, 200, {
        statuses: [
          ...[...(gh.statuses.get(m[1]) ?? new Map<string, string>()).entries()].map(([context, state]) => ({
            context,
            state,
          })),
          ...(gh.extraStatuses.get(m[1]) ?? []),
        ],
      });

    if (/^\/api\/repos\/acme\/infra\/commits\/[0-9a-f]{40}\/check-runs$/.test(path))
      return send(res, 200, { total_count: 0, check_runs: [] });

    if ((m = /^\/api\/repos\/acme\/infra\/pulls\/(\d+)$/.exec(path)) && method === 'GET') {
      const pr = this.githubPull(Number(m[1]));

      return pr ? send(res, 200, pr) : send(res, 404, { message: 'Not Found' });
    }

    if (method === 'POST' && path === '/api/repos/acme/infra/pulls') {
      if (gh.createPullDelayMs > 0) return void this.slowPull(res, json, gh.createPullDelayMs);

      const number = gh.nextPull++;
      const sha = this.ref('acme/infra', `refs/heads/${json.head}`);

      this.setRef('acme/infra', `refs/pull/${number}/head`, sha);
      gh.pulls.set(number, {
        number,
        title: json.title,
        head: json.head,
        sha,
        state: 'open',
        author: 'loadweaver[bot]',
        mergeable: true,
        draft: false,
      });

      return send(res, 201, { number, html_url: `${this.origin}/acme/infra/pull/${number}` });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/pulls\/(\d+)\/reviews$/.exec(path)))
      return send(res, 200, gh.reviews.get(Number(m[1])) ?? []);

    if ((m = /^\/api\/repos\/acme\/infra\/pulls\/(\d+)\/merge$/.exec(path)) && method === 'PUT') {
      const pr = gh.pulls.get(Number(m[1]));

      // Someone pushed right before the merge: the head moved.
      if (pr && gh.moveHeadOnMerge.delete(pr.number)) {
        pr.sha = this.commit('acme/infra', pr.head, { [`late-${pr.number}.txt`]: 'late\n' }, 'late push');
        this.setRef('acme/infra', `refs/pull/${pr.number}/head`, pr.sha);
      }

      if (pr && pr.state === 'open' && json.sha !== pr.sha)
        return send(res, 409, { message: 'Head branch was modified. Review and try the merge again.' });

      if (!pr || pr.state !== 'open') return send(res, 405, { message: 'Pull Request is not mergeable' });

      this.setRef('acme/infra', 'refs/heads/main', pr.sha);
      pr.state = 'merged';

      return send(res, 200, { merged: true, sha: pr.sha });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/issues\/(\d+)\/comments$/.exec(path))) {
      const list = gh.comments.get(Number(m[1])) ?? [];

      if (method === 'GET')
        return send(
          res,
          200,
          list.map((c) => ({ id: c.id, body: c.body, user: { login: c.user } })),
        );

      const comment = {
        id: gh.nextComment++,
        body: String(json.body),
        user: 'loadweaver[bot]',
        userId: 1,
        createdAt: new Date().toISOString(),
      };

      gh.comments.set(Number(m[1]), [...list, comment]);

      return send(res, 201, { id: comment.id });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/issues\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const comment = [...gh.comments.values()].flat().find((c) => c.id === Number(m?.[1]));

      if (!comment) return send(res, 404, { message: 'Not Found' });

      comment.body = String(json.body);

      return send(res, 200, { id: comment.id });
    }

    if ((m = /^\/api\/repos\/acme\/infra\/issues\/comments\/(\d+)\/reactions$/.exec(path))) {
      gh.reactions.push({ comment: m[1], content: json.content });

      return send(res, 201, {});
    }

    void url;
    send(res, 404, { message: `Not Found: ${method} ${path}` });
  }

  /** `POST /pulls` answered late (a slow provider). */
  private slowPull(res: ServerResponse, json: Json, delayMs: number): void {
    setTimeout(() => {
      const number = this.github.nextPull++;
      const sha = this.ref('acme/infra', `refs/heads/${json.head}`);

      this.setRef('acme/infra', `refs/pull/${number}/head`, sha);
      this.github.pulls.set(number, {
        number,
        title: json.title,
        head: json.head,
        sha,
        state: 'open',
        author: 'loadweaver[bot]',
        mergeable: true,
        draft: false,
      });
      send(res, 201, { number, html_url: `${this.origin}/acme/infra/pull/${number}` });
    }, delayMs);
  }

  private gitlabApi(req: IncomingMessage, res: ServerResponse, path: string, json: Json, url: URL): void {
    const gl = this.gitlab;
    const method = req.method ?? 'GET';
    let m: RegExpExecArray | null;

    if (method === 'POST' && path === '/oauth/token') {
      const user = this.oauthUsers.get(json.code);

      return user && json.client_secret === 'gitlab-app-secret' && json.grant_type === 'authorization_code'
        ? send(res, 200, { access_token: `glo_${json.code}`, token_type: 'Bearer' })
        : send(res, 400, { error: 'invalid_grant' });
    }

    if (method === 'GET' && path === '/api/v4/user') {
      const code = /^Bearer glo_(.+)$/.exec(String(req.headers['authorization'] ?? ''))?.[1];
      const user = code ? this.oauthUsers.get(code) : undefined;

      return user
        ? send(res, 200, { id: user.id, username: user.login })
        : send(res, 401, { message: '401 Unauthorized' });
    }

    if (String(req.headers['private-token'] ?? '') !== 'glpat-mockproject')
      return send(res, 401, { message: '401 Unauthorized' });

    const project = '/api/v4/projects/group%2Finfra';

    if (!path.startsWith(project)) return send(res, 404, { message: '404 Project Not Found' });

    const rest = path.slice(project.length);

    if ((m = /^\/statuses\/([0-9a-f]{40})$/.exec(rest)) && method === 'POST') {
      const list = gl.statuses.get(m[1]) ?? [];

      list.push({ id: gl.nextStatus++, name: json.name, status: json.state });
      gl.statuses.set(m[1], list);

      return send(res, 201, {});
    }

    if ((m = /^\/repository\/commits\/([0-9a-f]{40})\/statuses$/.exec(rest)))
      return send(res, 200, gl.statuses.get(m[1]) ?? []);

    if ((m = /^\/merge_requests\/(\d+)$/.exec(rest)) && method === 'GET') {
      const mr = gl.mrs.get(Number(m[1]));

      return mr
        ? send(res, 200, {
            iid: mr.number,
            title: mr.title,
            state: mr.state === 'open' ? 'opened' : mr.state,
            sha: mr.sha,
            source_branch: mr.head,
            target_branch: 'main',
            source_project_id: 11,
            target_project_id: 11,
            web_url: `${this.origin}/group/infra/-/merge_requests/${mr.number}`,
            author: { username: mr.author, id: mr.authorId ?? 1001 },
            detailed_merge_status: mr.detailed,
          })
        : send(res, 404, { message: '404 Not found' });
    }

    if ((m = /^\/merge_requests\/(\d+)\/approvals$/.exec(rest)))
      return send(res, 200, { approved_by: (gl.approvals.get(Number(m[1])) ?? []).map((user) => ({ user })) });

    if (rest === '/approvals' && method === 'GET')
      return send(res, 200, { reset_approvals_on_push: gl.resetApprovalsOnPush });

    if ((m = /^\/merge_requests\/(\d+)\/versions(\?.*)?$/.exec(rest)))
      return send(res, 200, gl.versions.get(Number(m[1])) ?? []);

    if ((m = /^\/merge_requests\/(\d+)\/notes\/(\d+)$/.exec(rest)) && method === 'GET') {
      const note = (gl.notes.get(Number(m[1])) ?? []).find((n) => n.id === Number(m?.[2]));

      return note
        ? send(res, 200, {
            id: note.id,
            body: note.body,
            author: { id: note.userId ?? 1, username: note.user, bot: note.user === 'loadweaver-bot' },
            created_at: note.createdAt ?? new Date().toISOString(),
            system: note.system ?? false,
            noteable_iid: Number(m[1]),
          })
        : send(res, 404, { message: '404 Not found' });
    }

    if ((m = /^\/merge_requests\/(\d+)\/merge$/.exec(rest)) && method === 'PUT') {
      const mr = gl.mrs.get(Number(m[1]));

      if (!mr || mr.state !== 'open' || json.sha !== mr.sha)
        return send(res, 406, { message: 'Branch cannot be merged' });

      this.setRef('group/infra', 'refs/heads/main', mr.sha);
      mr.state = 'merged';

      return send(res, 200, { state: 'merged' });
    }

    if ((m = /^\/merge_requests\/(\d+)\/notes(\?.*)?$/.exec(rest))) {
      const list = gl.notes.get(Number(m[1])) ?? [];

      if (method === 'GET')
        return send(
          res,
          200,
          (url.searchParams.get('sort') === 'desc' ? [...list].reverse() : list).map((n) => ({
            id: n.id,
            body: n.body,
            system: n.system ?? false,
            author: { id: n.userId ?? 1 },
            created_at: n.createdAt,
          })),
        );

      const note = {
        id: gl.nextNote++,
        body: String(json.body),
        user: 'loadweaver-bot',
        userId: 1,
        createdAt: new Date().toISOString(),
      };

      gl.notes.set(Number(m[1]), [...list, note]);

      return send(res, 201, { id: note.id });
    }

    if ((m = /^\/merge_requests\/(\d+)\/notes\/(\d+)$/.exec(rest)) && method === 'PUT') {
      const note = (gl.notes.get(Number(m[1])) ?? []).find((n) => n.id === Number(m?.[2]));

      if (!note) return send(res, 404, { message: '404 Not found' });

      note.body = String(json.body);

      return send(res, 200, { id: note.id });
    }

    if ((m = /^\/merge_requests\/(\d+)\/notes\/(\d+)\/award_emoji$/.exec(rest))) {
      gl.awards.push({ note: m[2], name: json.name });

      return send(res, 201, {});
    }

    send(res, 404, { message: `404 Not found: ${method} ${rest}` });
  }
}
