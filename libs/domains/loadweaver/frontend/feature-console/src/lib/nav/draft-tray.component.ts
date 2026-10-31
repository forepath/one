import { ChangeDetectionStrategy, Component, computed, inject, Injectable, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { DraftOp } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { resourceObjectRoute } from '../objects/object-route';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';

/** Opens the draft tray from anywhere (wizards' "Preview now", shortcuts). */
@Injectable({ providedIn: 'root' })
export class DraftTrayService {
  readonly open = signal(false);
}

/** The chip text of a draft: "Draft: N changes" (no draft: "Draft"). */
export function draftChipCount(ops: readonly unknown[] | null | undefined): number {
  return ops?.length ?? 0;
}

/** "Risk" entries of a preview (project → reasons). */
export function previewRisks(
  risk: Record<string, string[]> | null | undefined,
): { project: string; reasons: string }[] {
  return Object.entries(risk ?? {}).map(([project, reasons]) => ({ project, reasons: reasons.join(', ') }));
}

/**
 * App-wide draft tray (3.37 P3): the top bar's draft chip ("Draft: N changes") opens the tray over the server-side
 * shared drafts (3.36): the active draft's ops (each opens its object; undo per op), title, dry-run preview with
 * "Show on map", submit as plan, discard, leave / switch / new draft, conflicts (keep mine / take current) and live
 * changes by collaborators. Edits come from the Spec tabs, wizards, tree / table / header actions (● marks).
 */
@Component({
  selector: 'loadweaver-draft-tray',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcSpinnerComponent,
  ],
  template: `
    <!-- Top-bar draft chip (3.38 R13): a top-bar action, not a link; warning outline while the draft has changes. -->
    <fpc-button
      variant="link"
      size="sm"
      class="fpc-top-bar__action lw-draft-chip"
      [class.fpc-top-bar__action--attention]="count() > 0"
      [title]="chipTitle"
      [ariaLabel]="count() > 0 ? draftLabel + ': ' + count() + ' ' + changesLabel : draftLabel"
      (clicked)="open.set(true)"
      data-testid="console-draft-chip"
    >
      <i class="bi bi-pencil-square" aria-hidden="true"></i>
      <span class="d-none d-md-inline">{{ draftLabel }}</span>
      @if (count() > 0) {
        <fpc-badge color="primary" size="sm" [pill]="true">{{ count() }}</fpc-badge>
      }
    </fpc-button>

    <fpc-modal
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="trayTitle"
      size="lg"
      [centered]="false"
      scrollable
    >
      @if (draft.error(); as message) {
        <fpc-alert
          variant="warning"
          [message]="message"
          [dismissible]="true"
          (closed)="draft.dismissError()"
          data-testid="draft-tray-error"
        />
      } @else if (draft.changedByOthers()) {
        <fpc-alert
          variant="info"
          [dismissible]="true"
          (closed)="draft.dismissError()"
          [message]="updatedLabel"
          data-testid="draft-tray-updated"
        />
      }

      @if (draft.active(); as d) {
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <label class="visually-hidden" for="lw-draft-tray-title">{{ titleLabel }}</label>
          <fpc-form-control
            controlId="lw-draft-tray-title"
            size="sm"
            class="flex-grow-1"
            [ngModel]="d.title"
            (ngModelChange)="$event.trim() && $event !== d.title && draft.rename($event)"
            [ngModelOptions]="{ updateOn: 'blur' }"
            data-testid="draft-tray-title"
          />
          @if (d.projects.length) {
            <fpc-badge size="sm" color="light">{{ d.projects.join(', ') }}</fpc-badge>
          }
          @if (draft.busy()) {
            <fpc-spinner size="sm" />
          }
        </div>

        @if (d.ops.length === 0) {
          <fpc-empty-state icon="pencil-square" size="sm" [title]="emptyLabel" [message]="emptyHint" />
        } @else {
          <fpc-list class="d-block mb-2" [flush]="true" data-testid="draft-tray-ops">
            @for (op of d.ops; track op.kind + op.project + op.name) {
              <fpc-list-item variant="condensed">
                <div fpcListItemTitle class="d-flex align-items-center gap-2 min-w-0 small">
                  <fpc-badge [tone]="op.op === 'delete' ? 'danger' : 'info'">{{
                    op.op === 'delete' ? deleteLabel : upsertLabel
                  }}</fpc-badge>
                  <a class="text-truncate" [routerLink]="opRoute(op)" (click)="open.set(false)">
                    {{ op.kind }} {{ op.project ? op.project + '/' : '' }}{{ op.name }}
                  </a>
                </div>
                <div fpcListItemActions class="d-flex align-items-center gap-2 small">
                  <span class="text-body-secondary text-nowrap">{{ op.by }}</span>
                  <fpc-button
                    size="sm"
                    variant="link"
                    iconOnly
                    [ariaLabel]="revertLabel"
                    [title]="revertLabel"
                    [disabled]="draft.busy()"
                    (clicked)="draft.revert(op)"
                    [attr.data-testid]="'draft-tray-revert-' + op.name"
                  >
                    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                  </fpc-button>
                </div>
              </fpc-list-item>
            }
          </fpc-list>
        }

        @if (draft.conflicts().length > 0) {
          <fpc-list class="d-block mb-2" [flush]="true" data-testid="draft-tray-conflicts">
            @for (c of draft.conflicts(); track c.key) {
              <fpc-list-item variant="condensed">
                <div fpcListItemTitle class="d-flex flex-wrap align-items-center gap-2 small">
                  <i class="bi bi-exclamation-triangle text-warning" aria-hidden="true"></i>
                  <span class="font-monospace">{{ c.key }}</span>
                  <fpc-badge size="sm" color="light">{{ c.baseGeneration }} → {{ c.currentGeneration }}</fpc-badge>
                </div>
                <fpc-button-group fpcListItemActions size="sm">
                  <fpc-button size="sm" variant="dark" (clicked)="draft.resolve(c, 'keep')">{{
                    keepMineLabel
                  }}</fpc-button>
                  <fpc-button size="sm" variant="dark" (clicked)="draft.resolve(c, 'take')">{{
                    takeCurrentLabel
                  }}</fpc-button>
                </fpc-button-group>
              </fpc-list-item>
            }
          </fpc-list>
        }

        @if (draft.preview(); as pv) {
          <div class="d-flex flex-wrap align-items-center gap-2 small mb-2" data-testid="draft-tray-preview">
            <span class="fw-semibold">{{ previewLabel }}</span>
            <fpc-badge size="sm" color="light">{{ pv.plan.changes.length }} {{ changesLabel }}</fpc-badge>
            @if (pv.plan.workloadChanges.length) {
              <fpc-badge size="sm" color="info">{{ pv.plan.workloadChanges.length }} {{ movesLabel }}</fpc-badge>
            }
            @if (pv.plan.warnings.length) {
              <fpc-badge size="sm" color="warning">{{ pv.plan.warnings.length }} {{ warningsLabel }}</fpc-badge>
            }
            @if (pv.plan.diagnostics.length) {
              <fpc-badge size="sm" color="danger">{{ pv.plan.diagnostics.length }} {{ issuesLabel }}</fpc-badge>
            }
            @for (entry of risks(); track entry.project) {
              <fpc-badge size="sm" color="warning">{{ entry.project }}: {{ entry.reasons }}</fpc-badge>
            }
            <a
              class="ms-auto"
              routerLink="/observe/topology"
              [queryParams]="{ draft: d.id }"
              (click)="open.set(false)"
              data-testid="draft-tray-show-on-map"
              >{{ showOnMapLabel }}</a
            >
          </div>
        }
      } @else {
        <p class="small text-body-secondary">{{ noDraftHint }}</p>
      }

      <div class="d-flex flex-wrap align-items-center gap-2 border-top pt-2 mt-2">
        <label class="visually-hidden" for="lw-draft-tray-switch">{{ draftLabel }}</label>
        <fpc-form-control
          controlType="select"
          controlId="lw-draft-tray-switch"
          size="sm"
          class="lw-draft-tray__switch"
          [ngModel]="draft.active()?.id ?? ''"
          (ngModelChange)="switchTo($event)"
          data-testid="draft-tray-switch"
        >
          <option value="">{{ noDraftLabel }}</option>
          @for (d of draft.drafts(); track d.id) {
            <option [value]="d.id">{{ d.title }} ({{ d.ops.length }})</option>
          }
        </fpc-form-control>
        <fpc-button size="sm" variant="secondary" (clicked)="newDraft()" data-testid="draft-tray-new">
          <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ newDraftLabel }}
        </fpc-button>
        @if (draft.active(); as d) {
          <fpc-button-group size="sm" class="ms-auto">
            <fpc-button
              size="sm"
              variant="secondary"
              [disabled]="d.ops.length === 0 || draft.busy()"
              (clicked)="draft.runPreview()"
              data-testid="draft-tray-preview-run"
            >
              <i class="bi bi-eye me-1" aria-hidden="true"></i>{{ previewLabel }}
            </fpc-button>
            <fpc-button
              size="sm"
              variant="primary"
              [disabled]="d.ops.length === 0 || draft.busy()"
              (clicked)="submit()"
              data-testid="draft-tray-submit"
            >
              <i class="bi bi-send me-1" aria-hidden="true"></i>{{ submitLabel }}
            </fpc-button>
            <fpc-button
              size="sm"
              variant="danger"
              iconOnly
              [ariaLabel]="discardLabel"
              [title]="discardLabel"
              [disabled]="draft.busy()"
              (clicked)="draft.discard()"
              data-testid="draft-tray-discard"
            >
              <i class="bi bi-trash" aria-hidden="true"></i>
            </fpc-button>
          </fpc-button-group>
        }
      </div>
    </fpc-modal>
  `,
  styles: `
    .lw-draft-tray__switch {
      max-width: 18rem;
    }
  `,
})
export class LoadweaverDraftTrayComponent {
  readonly draft = inject(WorkspaceDraftStore);
  private readonly router = inject(Router);

  readonly open = inject(DraftTrayService).open;
  readonly count = computed(() => draftChipCount(this.draft.active()?.ops));
  readonly risks = computed(() => previewRisks(this.draft.preview()?.plan.risk));

  readonly trayTitle = $localize`:@@lwConsoleDraft-tray:Draft`;
  readonly chipTitle = $localize`:@@lwConsoleDraft-chipTitle:Draft: changes waiting to be submitted as a plan`;
  readonly draftLabel = $localize`:@@lwConsoleWorkspace-draft:Draft`;
  readonly changesLabel = $localize`:@@lwConsoleDraft-changes:changes`;
  readonly movesLabel = $localize`:@@lwConsoleDraft-moves:workload moves`;
  readonly warningsLabel = $localize`:@@lwConsoleDraft-warnings:warnings`;
  readonly issuesLabel = $localize`:@@lwConsoleDraft-issues:issues`;
  readonly titleLabel = $localize`:@@lwConsoleWorkspace-draftTitle:Title`;
  readonly noDraftLabel = $localize`:@@lwConsoleWorkspace-noDraft:No draft (view only)`;
  readonly newDraftLabel = $localize`:@@lwConsoleWorkspace-newDraft:New draft`;
  readonly previewLabel = $localize`:@@lwConsoleWorkspace-preview:Preview`;
  readonly submitLabel = $localize`:@@lwConsoleWorkspace-submit:Submit as plan`;
  readonly discardLabel = $localize`:@@lwConsoleWorkspace-discard:Discard draft`;
  readonly revertLabel = $localize`:@@lwConsoleWorkspace-revert:Undo in draft`;
  readonly keepMineLabel = $localize`:@@lwConsoleWorkspace-keepMine:Keep mine`;
  readonly takeCurrentLabel = $localize`:@@lwConsoleWorkspace-takeCurrent:Take current`;
  readonly showOnMapLabel = $localize`:@@lwConsoleDraft-showOnMap:Show on map`;
  readonly deleteLabel = $localize`:@@lwConsoleDraft-opDelete:Delete`;
  readonly upsertLabel = $localize`:@@lwConsoleDraft-opUpsert:Change`;
  readonly emptyLabel = $localize`:@@lwConsoleDraft-empty:No changes yet`;
  readonly emptyHint = $localize`:@@lwConsoleDraft-emptyHint:Use Edit, Create or "Delete in draft" — changes collect here until you submit them as a plan.`;
  readonly noDraftHint = $localize`:@@lwConsoleDraft-noDraft:No draft is open. Pick one or start a new one; editing starts one too.`;
  readonly updatedLabel = $localize`:@@lwConsoleWorkspace-draftUpdated:A collaborator changed this draft: the map shows their version.`;
  private readonly untitled = $localize`:@@lwConsoleDraft-untitled:Untitled draft`;

  opRoute(op: DraftOp): string[] {
    return [...resourceObjectRoute({ kind: op.kind, name: op.name, project: op.project })];
  }

  async switchTo(id: string): Promise<void> {
    await this.draft.open(id || null);
  }

  async newDraft(): Promise<void> {
    await this.draft.create(this.untitled);
  }

  async submit(): Promise<void> {
    const plan = await this.draft.submit();

    if (plan) {
      this.open.set(false);
      void this.router.navigate(['/activity/plans', plan.id]);
    }
  }
}
