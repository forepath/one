import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataSource, In, MoreThan } from 'typeorm';

import { planVisibleTo, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { toPlanResponse } from '../dto/plan.dto';
import { PlanEntity } from '../entities/plan.entity';
import { PlanApprovalEntity } from '../entities/project-access.entity';

/** Plans someone may still act on or wait for. */
const ACTIVE = ['pending', 'applying', 'rolling-back', 'rollback-failed'] as const;
const POLL_MS = 1_000;

type PlansSocket = Socket & { data: { userInfo?: SocketUserInfo; caller?: AccessCaller } };

/**
 * Live plans (3.19, Agenstra's snapshot + patch pattern): on connect a `plansSnapshot` of the active plans the user
 * may see, then a `planPatch` for every plan that changed (approvals, applies, progress, rollbacks). Changes are read
 * from the database, so every control-plane replica serves every plan.
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_PLANS_WEBSOCKET_NAMESPACE || 'socket/plans',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class PlansGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(PlansGateway.name);
  private readonly sockets = new Map<string, PlansSocket>();
  private timer: NodeJS.Timeout | null = null;
  private since = new Date();
  private polling = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly socketAuth: SocketAuthService,
    private readonly access: ProjectAccessService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as PlansSocket).data = { userInfo };
      next();
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const s = socket as PlansSocket;

    if (!s.data?.userInfo) {
      socket.disconnect();

      return;
    }

    s.data.caller = await this.access.caller(buildRequestFromSocketUser(s.data.userInfo));
    this.sockets.set(socket.id, s);

    const plans = await this.dataSource
      .getRepository(PlanEntity)
      .find({ where: { status: In([...ACTIVE]) }, order: { createdAt: 'DESC' }, take: 200 });

    const visible = plans.filter((p) => planVisibleTo(s.data.caller as AccessCaller, p.changes)).slice(0, 50);
    const approvals = await this.approvals(visible.map((p) => p.id));

    socket.emit('plansSnapshot', {
      plans: visible.map((p) =>
        toPlanResponse(
          p,
          approvals.filter((a) => a.planId === p.id),
        ),
      ),
    });
    this.timer ??= setInterval(() => void this.poll(), POLL_MS);
  }

  handleDisconnect(socket: Socket): void {
    this.sockets.delete(socket.id);

    if (this.sockets.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async approvals(ids: readonly string[]): Promise<PlanApprovalEntity[]> {
    return ids.length
      ? await this.dataSource.getRepository(PlanApprovalEntity).find({ where: { planId: In([...ids]) } })
      : [];
  }

  /** Every plan changed since the last poll, to each socket that may see it. */
  async poll(): Promise<void> {
    if (this.polling) return;

    this.polling = true;

    try {
      const from = this.since;

      this.since = new Date();

      const changed = await this.dataSource
        .getRepository(PlanEntity)
        .find({ where: { updatedAt: MoreThan(new Date(from.getTime() - POLL_MS)) }, take: 200 });

      const approvals = await this.approvals(changed.map((p) => p.id));

      for (const plan of changed)
        for (const socket of this.sockets.values())
          if (socket.data.caller && planVisibleTo(socket.data.caller, plan.changes))
            socket.emit('planPatch', {
              plan: toPlanResponse(
                plan,
                approvals.filter((a) => a.planId === plan.id),
              ),
            });
    } catch (error) {
      this.logger.warn(`Plan poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.polling = false;
    }
  }
}
