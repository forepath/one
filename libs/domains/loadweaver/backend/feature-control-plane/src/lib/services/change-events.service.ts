import { Injectable, Logger } from '@nestjs/common';

import type { PlanEntity, PlanStatus } from '../entities/plan.entity';

/** Which access scopes a direct-API change touched (3.17): the cluster members and / or projects. */
export interface AccessScopesChanged {
  cluster: boolean;
  projects: string[];
}

type Handler<T> = (value: T) => Promise<void>;

/**
 * In-process change events between services that must not depend on each other (plans ↔ Git, 3.29): plans are
 * created / approved / finish, direct access changes happen. Listeners never fail the change that emitted the event
 * (`created` is awaited so its result, e.g. a pull request link, is part of the response).
 */
@Injectable()
export class ChangeEventsService {
  private readonly logger = new Logger(ChangeEventsService.name);
  private readonly createdHandlers: Handler<PlanEntity>[] = [];
  private readonly statusHandlers: Handler<{ planId: string; status: PlanStatus | 'approved' }>[] = [];
  private readonly accessHandlers: Handler<AccessScopesChanged>[] = [];

  onPlanCreated(handler: Handler<PlanEntity>): void {
    this.createdHandlers.push(handler);
  }

  onPlanStatus(handler: Handler<{ planId: string; status: PlanStatus | 'approved' }>): void {
    this.statusHandlers.push(handler);
  }

  onAccessChanged(handler: Handler<AccessScopesChanged>): void {
    this.accessHandlers.push(handler);
  }

  async planCreated(plan: PlanEntity): Promise<void> {
    await this.run('plan created', this.createdHandlers, plan);
  }

  /** Fire and forget: the status change is already committed. */
  planStatus(planId: string, status: PlanStatus | 'approved'): void {
    void this.run('plan status', this.statusHandlers, { planId, status });
  }

  accessChanged(scopes: AccessScopesChanged): void {
    if (!scopes.cluster && scopes.projects.length === 0) return;

    void this.run('access changed', this.accessHandlers, scopes);
  }

  private async run<T>(what: string, handlers: readonly Handler<T>[], value: T): Promise<void> {
    for (const handler of handlers)
      await handler(value).catch((error: unknown) =>
        this.logger.warn(`${what}: ${error instanceof Error ? error.message : String(error)}`),
      );
  }
}
