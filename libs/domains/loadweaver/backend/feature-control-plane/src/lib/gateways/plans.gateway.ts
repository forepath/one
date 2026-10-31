import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
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
import type { FleetIdentityRequest, VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import { TrustedFleetsService } from '../fleet-identity/trusted-fleets.service';
import { DraftEntity } from '../drafts/draft.entity';
import { draftActor, mayEditDraft, toDraftResponse } from '../drafts/drafts.utils';
import { planUserIds, toPlanResponse } from '../dto/plan.dto';
import { userEmails } from '../fleet-identity/user-emails';
import { PlanEntity } from '../entities/plan.entity';
import { PlanApprovalEntity } from '../entities/project-access.entity';

/** Plans someone may still act on or wait for. */
const ACTIVE = ['pending', 'applying', 'rolling-back', 'rollback-failed'] as const;
const POLL_MS = 1_000;

type PlansSocket = Socket & {
  data: { userInfo?: SocketUserInfo; fleetIdentity?: VerifiedFleetIdentity; caller?: AccessCaller; actor?: string };
};

/**
 * Live plans (3.19, Agenstra's snapshot + patch pattern): on connect a `plansSnapshot` of the active plans the user
 * may see, then a `planPatch` for every plan that changed (approvals, applies, progress, rollbacks). Workspace drafts
 * (3.36) the same way: `draftsSnapshot` of the open drafts the user may edit, then `draftPatch` for every change
 * (collaborators see each other's edits; submitted / discarded drafts arrive once with their final status). Changes
 * are read from the database, so every control-plane replica serves every plan and draft.
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
    /** Person-scoped streams through a fleet (2026-10-27): verifies the handshake's signed claim. */
    @Optional() private readonly fleets?: TrustedFleetsService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      // A fleet's subscription for a person with project grants carries their signed claim (2026-10-27): the stream
      // then acts as that person (capped by the connecting user's roles) and carries only their projects' events.
      const evaluation = this.fleets
        ? await this.fleets.evaluateSocket(socket.handshake?.auth?.['fleetIdentity'], 'plans').catch(() => null)
        : null;

      if (evaluation?.result === 'refused') {
        next(new Error(`fleet identity claim refused: ${evaluation.reason}`));

        return;
      }

      (socket as PlansSocket).data = {
        userInfo,
        ...(evaluation?.result === 'verified' ? { fleetIdentity: evaluation.identity } : {}),
      };
      next();
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const s = socket as PlansSocket;

    if (!s.data?.userInfo) {
      socket.disconnect();

      return;
    }

    // The person behind a fleet subscription (verified claim): plans and drafts of their projects only.
    const req: FleetIdentityRequest = Object.assign(buildRequestFromSocketUser(s.data.userInfo), {
      fleetIdentity: s.data.fleetIdentity,
    });

    s.data.caller = await this.access.caller(req);
    s.data.actor = draftActor(req);
    this.sockets.set(socket.id, s);

    const plans = await this.dataSource
      .getRepository(PlanEntity)
      .find({ where: { status: In([...ACTIVE]) }, order: { createdAt: 'DESC' }, take: 200 });

    const visible = plans.filter((p) => planVisibleTo(s.data.caller as AccessCaller, p.changes)).slice(0, 50);
    const approvals = await this.approvals(visible.map((p) => p.id));
    const emails = await userEmails(this.dataSource, planUserIds(visible, approvals));

    socket.emit('plansSnapshot', {
      plans: visible.map((p) =>
        toPlanResponse(
          p,
          approvals.filter((a) => a.planId === p.id),
          emails,
        ),
      ),
    });

    const drafts = await this.dataSource
      .getRepository(DraftEntity)
      .find({ where: { status: 'open' }, order: { updatedAt: 'DESC' }, take: 500 });

    socket.emit('draftsSnapshot', {
      drafts: drafts.filter((d) => this.mayEdit(s, d)).map((d) => toDraftResponse(d)),
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

  private mayEdit(socket: PlansSocket, draft: DraftEntity): boolean {
    return !!socket.data.caller && mayEditDraft(socket.data.caller, socket.data.actor ?? '', draft);
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
      // Resolved once per poll; each plan (and its labels) only goes to sockets that may see it.
      const emails = changed.length ? await userEmails(this.dataSource, planUserIds(changed, approvals)) : new Map();

      for (const plan of changed)
        for (const socket of this.sockets.values())
          if (socket.data.caller && planVisibleTo(socket.data.caller, plan.changes))
            socket.emit('planPatch', {
              plan: toPlanResponse(
                plan,
                approvals.filter((a) => a.planId === plan.id),
                emails,
              ),
            });

      const drafts = await this.dataSource
        .getRepository(DraftEntity)
        .find({ where: { updatedAt: MoreThan(new Date(from.getTime() - POLL_MS)) }, take: 200 });

      for (const draft of drafts)
        for (const socket of this.sockets.values())
          if (this.mayEdit(socket, draft)) socket.emit('draftPatch', { draft: toDraftResponse(draft) });
    } catch (error) {
      this.logger.warn(`Plan poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.polling = false;
    }
  }
}
