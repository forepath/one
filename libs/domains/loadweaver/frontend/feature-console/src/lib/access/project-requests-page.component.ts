import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type CrossProjectRequest,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { atLeastRole, projectRoleOf } from './access-format';
import { LoadweaverAccessRequestsComponent } from './access-requests.component';

/**
 * A project's cross-project requests (3.17), where the overview's inbox item "policy requests wait for <project>"
 * leads: operators and admins accept other projects' policies reaching its groups. Rejecting means not accepting
 * (the requesting plan stays blocked) or rejecting the plan itself.
 */
@Component({
  selector: 'loadweaver-project-requests-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    LoadweaverAccessRequestsComponent,
  ],
  templateUrl: './project-requests-page.component.html',
  standalone: true,
})
export class LoadweaverProjectRequestsPageComponent {
  private readonly facade = inject(ConsoleAccessManagementFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);

  readonly project = toSignal(this.route.paramMap.pipe(map((p) => p.get('project') ?? '')), { initialValue: '' });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly requests = toSignal(this.facade.requests$, { initialValue: [] as CrossProjectRequest[] });
  readonly loaded = toSignal(this.facade.projectAccess$.pipe(map((a) => a?.project ?? null)), { initialValue: null });
  readonly loading = toSignal(this.facade.projectLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.projectError$, { initialValue: null });
  readonly changing = toSignal(this.facade.changing$, { initialValue: false });
  readonly changeError = toSignal(this.facade.changeError$, { initialValue: null });

  /** Fleet mode: approvals stay native — given in the cluster's own console, never through the fleet's relay. */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  readonly mayAccept = computed(
    () => !this.fleetMode && atLeastRole(projectRoleOf(this.me(), this.project()), 'operator'),
  );
  readonly ready = computed(() => this.loaded() === this.project());
  readonly acceptFor = signal<CrossProjectRequest | null>(null);
  readonly acceptMessage = computed(() => {
    const request = this.acceptFor();

    return request
      ? $localize`:@@lwConsoleProjectRequests-acceptMessage:Policy ${request.policy}:policy: of ${request.project}:from: may reach the groups of ${this.project()}:project: in exactly this version.`
      : null;
  });

  readonly title = $localize`:@@lwConsoleProjectRequests-title:Requests from other projects`;
  readonly refreshLabel = $localize`:@@lwConsoleProjectRequests-refresh:Refresh`;
  readonly accessLabel = $localize`:@@lwConsoleProjectRequests-access:Project access`;
  readonly acceptTitle = $localize`:@@lwConsoleProjectRequests-acceptTitle:Accept the policy?`;
  readonly acceptLabel = $localize`:@@lwConsoleProjectRequests-accept:Accept`;
  readonly cancelLabel = $localize`:@@lwConsoleProjectRequests-cancel:Cancel`;

  constructor() {
    effect(() => {
      const project = this.project();

      if (project) untracked(() => this.facade.openProject(project));
    });
  }

  refresh(): void {
    if (this.project()) this.facade.openProject(this.project());
  }

  onAcceptOpenChange(open: boolean): void {
    if (!open) this.acceptFor.set(null);
  }

  confirmAccept(): void {
    const request = this.acceptFor();

    this.acceptFor.set(null);

    if (request) this.facade.accept(this.project(), request);
  }
}
