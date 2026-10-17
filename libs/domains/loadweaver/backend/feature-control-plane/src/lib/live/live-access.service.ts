import type { RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { atLeast, canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { ResourceStoreService } from '../services/resource-store.service';

export interface LiveTarget {
  /** Where the session runs. */
  node: string;
  project: string | null;
  /** `replica/<id>`, `volume/<id>`, `node/<name>` (audit target). */
  target: string;
  caller: AccessCaller;
}

/**
 * Who may open what live (3.19): terminals and file access in a project's replicas / volumes for its operators and
 * admins (developers if the project allows exec, viewers never); the host shell for cluster admins only, and only
 * when the cluster enables it; debug tunnels for operators and admins. Unknown or unreadable targets are 404.
 */
@Injectable()
export class LiveAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly resources: ResourceStoreService,
  ) {}

  private async mayExec(caller: AccessCaller, project: string): Promise<boolean> {
    const role = projectRole(caller, project);

    if (atLeast(role, 'operator')) return true;

    if (role !== 'developer') return false;

    return (await this.access.settings(this.dataSource.manager, project)).developerExec;
  }

  /** A running replica's node, if the caller may exec / browse it. */
  async replica(
    req: RequestWithUser | undefined,
    replica: string,
    purpose: 'exec' | 'files' | 'tunnel' | 'machine-exec',
  ): Promise<LiveTarget> {
    const caller = await this.access.caller(req);
    const placement = await this.dataSource.getRepository(WorkloadPlacementEntity).findOne({ where: { id: replica } });

    if (!placement || !canReadProject(caller, placement.project)) throw new NotFoundException('replica not found');

    // Tunnels and machine exec (non-interactive, e.g. Agenstra's agent manager) need an operator or admin.
    const operatorOnly = purpose === 'tunnel' || purpose === 'machine-exec';
    const allowed = operatorOnly
      ? atLeast(projectRole(caller, placement.project), 'operator')
      : await this.mayExec(caller, placement.project);

    if (!allowed) throw new ForbiddenException(operatorOnly ? 'operator role required' : 'exec not allowed');

    return { node: placement.node, project: placement.project, target: `replica/${replica}`, caller };
  }

  /** A volume on the node holding its primary replica. */
  async volume(req: RequestWithUser | undefined, volume: string): Promise<LiveTarget> {
    const caller = await this.access.caller(req);
    const placement = await this.dataSource.getRepository(VolumePlacementEntity).findOne({ where: { id: volume } });
    const project = volume.split('/')[0];

    if (!placement || !canReadProject(caller, project)) throw new NotFoundException('volume not found');

    if (!(await this.mayExec(caller, project))) throw new ForbiddenException('exec not allowed');

    return { node: placement.primaryNode, project, target: `volume/${volume}`, caller };
  }

  /** The host shell: root on the node (cluster admins, cluster setting). */
  async nodeShell(req: RequestWithUser | undefined, node: string): Promise<LiveTarget> {
    const caller = await this.access.caller(req);
    const exists = await this.dataSource
      .getRepository(NodeEntity)
      .exists({ where: { name: node, lifecycle: Not('left') } });

    if (!caller.clusterRole || !exists) throw new NotFoundException('node not found');

    if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admin role required');

    if (!(await this.resources.clusterSpec()).nodeShellEnabled)
      throw new ForbiddenException('node shells are disabled for this cluster');

    return { node, project: null, target: `node/${node}`, caller };
  }

  /** Whether a terminal session is recorded: node shells always, replicas per cluster / project policy. */
  async recorded(target: LiveTarget): Promise<boolean> {
    if (!target.project) return true;

    if ((await this.resources.clusterSpec()).terminalRecording === 'on') return true;

    return (await this.access.settings(this.dataSource.manager, target.project)).recordTerminals;
  }
}
