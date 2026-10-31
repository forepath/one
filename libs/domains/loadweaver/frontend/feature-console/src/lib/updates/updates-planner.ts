import { inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConsoleUpdatesFacade, type UpdateRelease } from '@forepath/loadweaver/frontend/data-access-console';

/** The value of the plan dialog's release picker that means "no new release, host updates only". */
export const HOST_ONLY = '';

/**
 * The "Plan an update" dialog state of the Updates section (3.38): provided on the route, shared by the page head
 * (header `+`, renders the dialog) and the Releases lane (plan a release).
 */
@Injectable()
export class LoadweaverUpdatesPlanner {
  private readonly facade = inject(ConsoleUpdatesFacade);
  private readonly status = toSignal(this.facade.status$, { initialValue: null });
  private readonly plannable = toSignal(this.facade.plannableReleases$, { initialValue: [] as UpdateRelease[] });

  readonly open = signal(false);
  /** A plan for the installed release only updates hosts. */
  readonly hostOnly = signal(true);
  version = HOST_ONLY;
  host = false;
  osUpgrade = false;

  /** Opens the dialog, preselecting a release (or the newest available one). */
  start(release?: UpdateRelease): void {
    const cluster = this.status()?.clusterVersion ?? null;
    const target = release ?? this.plannable().find((r) => r.version !== cluster);

    this.version = target && target.version !== cluster ? target.version : HOST_ONLY;
    this.host = this.version === HOST_ONLY;
    this.osUpgrade = false;
    this.hostOnly.set(this.version === HOST_ONLY);
    this.facade.clearCreateError();
    this.open.set(true);
  }

  setVersion(version: string): void {
    this.version = version;
    this.hostOnly.set(version === HOST_ONLY);

    if (version === HOST_ONLY) this.host = true;
  }

  setHost(host: boolean): void {
    this.host = host;

    if (!host) this.osUpgrade = false;
  }

  create(): void {
    const hostOnly = this.version === HOST_ONLY;

    this.facade.create({
      ...(hostOnly ? {} : { version: this.version }),
      host: hostOnly || this.host,
      osUpgrade: (hostOnly || this.host) && this.osUpgrade,
    });
  }
}
