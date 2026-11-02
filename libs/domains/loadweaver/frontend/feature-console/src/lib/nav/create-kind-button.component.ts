import { ChangeDetectionStrategy, Component, computed, inject, input, LOCALE_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConsoleAccessFacade, ConsoleEndpointService } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { of } from 'rxjs';

import { kindScope } from '../objects/create-wizard';
import { isCreatableKind, ResourceModalService } from '../objects/resource-modal.service';
import { kindDisplayName } from '../resources/resource-format';
import { mayDraftResource, type WorkspaceAccess } from '../workspace/workspace-actions';

/** "Create <kind>" (en: lower-case kind unless it starts with an acronym; de keeps the noun's capital). */
export function createKindLabel(kind: string, locale: string): string {
  const name = kindDisplayName(kind);
  const readable =
    locale.startsWith('en') && !/^[A-Z]{2,}/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;

  return $localize`:@@lwConsoleCreate-kindButton:Create ${readable}:kind:`;
}

/** Whether the caller may create a `kind` resource in `project` (none given: anywhere the kind may live). */
export function mayCreateKind(kind: string, project: string | null, access: WorkspaceAccess): boolean {
  if (!isCreatableKind(kind)) return false;

  if (project) return mayDraftResource({ kind, project }, access);

  const scope = kindScope(kind);

  if (scope !== 'project' && mayDraftResource({ kind, project: null }, access)) return true;

  // A project kind without a project context: any project the caller may change (the modal asks which).
  return (
    scope !== 'cluster' &&
    (access.clusterRole === 'cluster-admin' ||
      Object.keys(access.projects).some((p) => mayDraftResource({ kind, project: p }, access)))
  );
}

/**
 * The kind-specific create "+" (2026-10-29, coordinator refinement of "top-bar + only"): allowed only as a table-head
 * action of a table listing one creatable kind. Same icon / size / variant everywhere; it opens the one resource modal
 * (`ResourceModalService.openCreate(kind, project)`), never a page-local form. Hidden without the role to create.
 * Use with `fpcDataTableToolbar` on the host (or inside a projected toolbar span).
 */
@Component({
  selector: 'loadweaver-create-kind-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcButtonComponent],
  host: { class: 'd-inline-flex' },
  template: `
    @if (allowed()) {
      <fpc-button
        variant="primary"
        size="sm"
        [iconOnly]="true"
        [ariaLabel]="label()"
        [title]="label()"
        (clicked)="open()"
        [attr.data-testid]="'create-kind-' + kind()"
      >
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
      </fpc-button>
    }
  `,
})
export class LoadweaverCreateKindButtonComponent {
  readonly kind = input.required<string>();
  /** The project the new resource starts in (the table's project context), null = none / cluster-level. */
  readonly project = input<string | null>(null);

  private readonly modal = inject(ResourceModalService);
  private readonly locale = inject(LOCALE_ID);
  private readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  // Optional: hosts without access state (tests, kiosk) simply show no "+".
  private readonly me = toSignal(inject(ConsoleAccessFacade, { optional: true })?.me$ ?? of(null), {
    initialValue: null,
  });

  readonly label = computed(() => createKindLabel(this.kind(), this.locale));
  readonly allowed = computed(() =>
    mayCreateKind(this.kind(), this.project(), {
      clusterRole: this.me()?.clusterRole ?? null,
      projects: this.me()?.projects ?? {},
      fleetMode: this.fleetMode,
    }),
  );

  open(): void {
    this.modal.openCreate(this.kind(), this.project());
  }
}
