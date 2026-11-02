import type { RequestWithUser } from '@forepath/identity/backend';
import { stringifyResourceDocuments, type Resource } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { stringify } from 'yaml';
import { DataSource, In } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import type { PlanResponseDto } from '../dto/plan.dto';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { PlansService } from '../services/plans.service';
import { GitScopeService, type GitAheadEntry } from '../git/git-scope.service';

interface ForeignContainer {
  node: string;
  id: string;
  name: string;
  image: string;
  state: string;
  ports: string[];
  reportedAt: string;
}

export interface DriftReport {
  /** Containers on nodes that Loadweaver doesn't manage (e.g. `docker run`). */
  containers: ForeignContainer[];
  /**
   * Containers a workload with the node's Docker socket started itself (e.g. Agenstra's agent manager and its
   * `io.agenstra.*` environments): known and owned by that replica, not drift.
   */
  delegated: (ForeignContainer & { delegatedTo: string })[];
  /** Failed rollbacks: configuration and reality may differ until their fix-forward plan is applied. */
  inconsistent: { planId: string; error: string | null; fixForward: string | null }[];
  /** Git scopes whose default branch is ahead of the cluster: its plan isn't applied, or the push was rejected. */
  gitAhead: GitAheadEntry[];
}

/** `0.0.0.0:8080->80/tcp` → `8080:80/tcp`; anything unparseable is left out. */
export function composePort(port: string): string | null {
  const match = /:(\d{1,5})->(\d{1,5})\/(tcp|udp)$/.exec(port);

  return match ? `${match[1]}:${match[2]}/${match[3]}` : null;
}

/** A compose service name from a container name. */
export function serviceName(container: string): string {
  return (
    container
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      .slice(0, 63) || 'service'
  );
}

/**
 * Drift (3.8): what the platform owns heals by itself; what was changed outside Loadweaver is reported here and
 * can be turned into a proposed plan, never overwritten or adopted silently.
 */
@Injectable()
export class DriftService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly plans: PlansService,
    private readonly git: GitScopeService,
  ) {}

  async report(req: RequestWithUser | undefined): Promise<DriftReport> {
    const caller = await this.access.caller(req);

    if (!caller.clusterRole) throw new ForbiddenException('Missing cluster permission');

    const nodes = await this.dataSource.getRepository(NodeEntity).find({ order: { name: 'ASC' } });
    const failed = await this.dataSource
      .getRepository(PlanEntity)
      .find({ where: { status: 'rollback-failed' }, order: { createdAt: 'DESC' } });
    const fixes = failed.length
      ? await this.dataSource
          .getRepository(PlanEntity)
          .find({ where: { resolves: In(failed.map((p) => p.id)), status: 'pending' } })
      : [];

    const foreign = nodes.flatMap((n) =>
      (n.drift?.containers ?? []).map((c) => ({ node: n.name, ...c, reportedAt: n.drift?.at ?? '' })),
    );

    return {
      containers: foreign.filter((c) => !c.delegatedTo),
      delegated: foreign.flatMap((c) => (c.delegatedTo ? [{ ...c, delegatedTo: c.delegatedTo }] : [])),
      inconsistent: failed.map((p) => ({
        planId: p.id,
        error: p.error,
        fixForward: fixes.find((f) => f.resolves === p.id)?.id ?? null,
      })),
      gitAhead: await this.git.ahead(),
    };
  }

  /**
   * A proposed plan that takes a foreign container over as a deployment of a project: same image and published
   * ports (environment and volumes are not copied: they may hold secrets and host paths). Normal plan rights apply.
   */
  async propose(
    req: RequestWithUser | undefined,
    input: { node: string; container: string; project: string; deployment: string },
  ): Promise<PlanResponseDto> {
    // Foreign containers are cluster-level information: reading them takes a cluster role, like the report.
    if (!(await this.access.caller(req)).clusterRole) throw new ForbiddenException('Missing cluster permission');
    const node = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: input.node } });
    const container = node?.drift?.containers.find((c) => c.id === input.container || c.id.startsWith(input.container));

    if (!container) throw new NotFoundException('no such foreign container');

    // A delegated container belongs to the workload that started it (e.g. an Agenstra environment).
    if (container.delegatedTo) throw new BadRequestException(`the container is managed by ${container.delegatedTo}`);

    const ports = container.ports.map(composePort).filter((p): p is string => !!p);
    const compose = stringify({
      services: {
        [serviceName(container.name)]: {
          image: container.image,
          ...(ports.length ? { ports: [...new Set(ports)] } : {}),
        },
      },
    });
    const resource = {
      apiVersion: 'loadweaver.com/v1',
      kind: 'Deployment',
      metadata: {
        name: input.deployment,
        project: input.project,
        annotations: { 'loadweaver.com/adopted-from': `${input.node}/${container.id.slice(0, 12)}` },
      },
      spec: { compose },
    } as Resource;

    // In a connected scope this becomes a pull request (authoritative) or is committed back after the apply.
    return await this.plans.create({ documents: stringifyResourceDocuments([resource]) }, req, { kind: 'drift' });
  }
}
