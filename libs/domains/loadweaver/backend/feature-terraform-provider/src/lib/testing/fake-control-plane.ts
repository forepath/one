import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import {
  parseResourceDocuments,
  resourceRefKey,
  type Resource,
  type ResourceRef,
} from '@forepath/loadweaver/shared/util-model';

import type { HttpExchange, HttpTransport, PlanChange, PlanStatus } from '../api-client';

interface FakePlan {
  id: string;
  status: PlanStatus;
  changes: PlanChange[];
  documents: Resource[];
  deletions: ResourceRef[];
  approved: boolean;
  /** GET /plans/:id answers that remain `applying` before the plan settles. */
  applyingPolls: number;
}

const json = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });

function sameContent(a: Resource, b: Resource): boolean {
  return JSON.stringify([a.metadata.labels ?? {}, a.spec]) === JSON.stringify([b.metadata.labels ?? {}, b.spec]);
}

/**
 * An in-memory stand-in for the control plane's plan / resource API, with the same request and error shapes
 * (`400 issues`, `409 blockers`, `404`), used by the unit tests (as an {@link HttpTransport}) and the e2e test
 * (over HTTP). Validation uses the real resource schema (util-model), so defaults are filled in like on a cluster.
 */
export class FakeControlPlane {
  readonly resources = new Map<string, Resource>();
  readonly plans = new Map<string, FakePlan>();
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  /** Projects whose plans need an approval before they apply (the 3.17 approval rules). */
  readonly approvalRequired = new Set<string>();
  /** Plans answer `applying` this many times before they settle (exercises progress polling). */
  applyingPolls = 0;
  /** A failing apply ends `rolled-back` with this error. */
  failApplyWith: string | null = null;
  /** Plans containing pins (409 without `confirm`). */
  pins = false;

  constructor(readonly token = 'test-token') {}

  transport(): HttpTransport {
    return async (exchange) => this.handle(exchange);
  }

  seed(resource: Resource): void {
    this.resources.set(resourceRefKey({ ...resource.metadata, kind: resource.kind }), resource);
  }

  approve(id: string): void {
    const plan = this.plans.get(id);

    if (plan) plan.approved = true;
  }

  pendingPlans(): FakePlan[] {
    return [...this.plans.values()].filter((p) => p.status === 'pending');
  }

  async handle(exchange: HttpExchange): Promise<{ status: number; body: string }> {
    const url = new URL(exchange.url);
    const path = url.pathname.replace(/^\/api/, '');
    const body = exchange.body ? (JSON.parse(exchange.body) as Record<string, unknown>) : null;

    this.requests.push({ method: exchange.method, path: `${path}${url.search}`, body });

    if (exchange.headers['authorization'] !== `Bearer ${this.token}`)
      return json(401, { statusCode: 401, message: 'Unauthorized' });

    let m: RegExpMatchArray | null;

    if (exchange.method === 'POST' && path === '/plans') return this.createPlan(body ?? {});

    if ((m = path.match(/^\/plans\/([^/]+)$/)) && exchange.method === 'GET') {
      const plan = this.plans.get(decodeURIComponent(m[1]));

      if (!plan) return json(404, { message: 'plan not found' });

      if (plan.status === 'applying' && plan.applyingPolls-- <= 0) this.settle(plan);

      return json(200, this.view(plan));
    }

    if ((m = path.match(/^\/plans\/([^/]+)\/(apply|discard|approve)$/)) && exchange.method === 'POST') {
      const plan = this.plans.get(decodeURIComponent(m[1]));

      if (!plan) return json(404, { message: 'plan not found' });

      if (plan.status !== 'pending') return json(409, { statusCode: 409, message: `plan is ${plan.status}` });

      if (m[2] === 'discard') {
        plan.status = 'discarded';

        return json(200, this.view(plan));
      }

      if (m[2] === 'approve') {
        plan.approved = true;

        return json(200, this.view(plan));
      }

      const projects = [...new Set(plan.changes.map((c) => c.project).filter((p): p is string => !!p))];
      const blocked = projects.filter((p) => this.approvalRequired.has(p));

      if (blocked.length > 0 && !plan.approved)
        return json(409, {
          message: 'The plan cannot be applied yet',
          blockers: blocked.map((p) => `project ${p}: an approval by an operator or admin is required`),
        });

      if (this.pins && !(body && body['confirm'] === true))
        return json(409, {
          statusCode: 409,
          message:
            'the plan contains unacknowledged pins; apply with confirm: true or acknowledge them with x-loadweaver.pinned',
        });

      plan.status = 'applying';
      plan.applyingPolls = this.applyingPolls;

      if (plan.applyingPolls <= 0) this.settle(plan);

      return json(200, this.view(plan));
    }

    if ((m = path.match(/^\/resources\/([^/]+)\/([^/]+)$/)) && exchange.method === 'GET') {
      const project = url.searchParams.get('project') ?? undefined;
      const resource = this.resources.get(
        resourceRefKey({ kind: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]), project }),
      );

      return resource ? json(200, resource) : json(404, { statusCode: 404, message: 'resource not found' });
    }

    if ((m = path.match(/^\/projects\/([^/]+)\/deployments\/([^/]+)\/status$/)) && exchange.method === 'GET') {
      const [project, deployment] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];

      if (!this.resources.has(resourceRefKey({ kind: 'Deployment', name: deployment, project })))
        return json(404, { message: 'Not found' });

      return json(200, {
        project,
        deployment,
        replicas: [
          {
            id: `${project}/${deployment}/web/0`,
            service: 'web',
            node: 'node-1',
            addresses: ['10.64.0.5'],
            state: 'running',
          },
        ],
        services: [{ name: 'web', addressV4: '10.96.0.10', addressV6: null }],
      });
    }

    return json(404, { message: `no route ${exchange.method} ${path}` });
  }

  private createPlan(body: Record<string, unknown>) {
    const documents: Resource[] = [];

    if (typeof body['documents'] === 'string' && body['documents']) {
      const parsed = parseResourceDocuments(body['documents']);

      if (parsed.ok === false) return json(400, { message: 'Invalid resources', issues: parsed.issues });

      documents.push(...parsed.resources);
    }

    const deletions = (Array.isArray(body['delete']) ? body['delete'] : []) as ResourceRef[];

    if (documents.length === 0 && deletions.length === 0) return json(400, { message: 'nothing to plan' });

    const changes: PlanChange[] = [];

    for (const doc of documents) {
      const existing = this.resources.get(resourceRefKey({ ...doc.metadata, kind: doc.kind }));

      changes.push({
        action: !existing ? 'create' : sameContent(existing, doc) ? 'unchanged' : 'update',
        kind: doc.kind,
        name: doc.metadata.name,
        project: doc.metadata.project ?? null,
      });
    }

    for (const ref of deletions) {
      if (!this.resources.has(resourceRefKey(ref)))
        return json(404, { statusCode: 404, message: `${ref.kind} ${ref.name} does not exist` });

      changes.push({ action: 'delete', kind: ref.kind, name: ref.name, project: ref.project ?? null });
    }

    const plan: FakePlan = {
      id: randomUUID(),
      status: 'pending',
      changes,
      documents,
      deletions,
      approved: false,
      applyingPolls: 0,
    };

    this.plans.set(plan.id, plan);

    return json(201, this.view(plan));
  }

  private settle(plan: FakePlan): void {
    if (this.failApplyWith) {
      plan.status = 'rolled-back';

      return;
    }

    for (const doc of plan.documents) this.seed(doc);

    for (const ref of plan.deletions) this.resources.delete(resourceRefKey(ref));

    plan.status = 'applied';
  }

  private view(plan: FakePlan) {
    const touched = plan.changes.filter((c) => c.action !== 'unchanged');

    return {
      id: plan.id,
      status: plan.status,
      changes: plan.changes,
      networkChanges: touched
        .filter((c) => c.kind === 'Policy')
        .map((c) => ({ layer: 'filtering', action: c.action, node: 'node-1', summary: `policy ${c.name}` })),
      workloadChanges: touched
        .filter((c) => c.kind === 'Deployment' && c.action === 'create')
        .map((c) => ({ action: 'start', replica: `${c.project}/${c.name}/web/0`, to: 'node-1' })),
      warnings: this.pins
        ? [{ level: 'warning', path: 'backups', message: 'no external backup target', pin: true }]
        : [],
      diagnostics: [],
      risk: {},
      approvals: plan.approved ? [{ project: 'any', userId: 'approver' }] : [],
      error: plan.status === 'rolled-back' ? this.failApplyWith : null,
    };
  }

  /** Serves the API over HTTP on a free loopback port (the e2e test). */
  async listen(): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
        );

        void this.handle({
          method: req.method ?? 'GET',
          url: `http://127.0.0.1${req.url ?? '/'}`,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
        }).then(({ status, body }) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(body);
        });
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve())),
    };
  }
}
