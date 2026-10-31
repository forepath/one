import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ConsoleResourcesFacade,
  type ResourceKey,
  resourceKeyOfResource,
  resourceToYaml,
  sameResourceKey,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcEmptyStateComponent,
  FpcFormSwitchComponent,
  FpcSectionRowComponent,
} from '@forepath/shared/frontend/ui-components';

import { ResourceModalService } from '../objects/resource-modal.service';
import { specLineDiff, type SpecLineDiff } from '../objects/spec-diff';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { draftOpOf } from '../workspace/workspace-draft';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';

/**
 * The object page's Spec tab (3.37; read-only since 2026-10-29): the resource as the draft leaves it (else live),
 * "Draft vs live" side by side, "Undo in draft", and "Edit" — editing happens in the resource modal
 * (`ResourceModalService.openEdit`), like every create / edit form of the console.
 */
@Component({
  selector: 'loadweaver-resource-spec',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcEmptyStateComponent,
    FpcFormSwitchComponent,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  styles: `
    .lw-spec__code {
      flex: 1 1 0;
      min-height: 20rem;
    }

    /* Nothing to show (no draft, no edit / revert action, e.g. the cluster's Options tab): no empty padded bar between
       the tabs and the first section header (user, 2026-10-29). */
    .lw-spec__toolbar:not(:has(> :not(.ms-auto))) {
      display: none !important;
    }
  `,
  template: `
    <div
      class="lw-spec__toolbar flex-shrink-0 d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom"
      data-testid="spec-toolbar"
    >
      @if (liveText() !== null && draftOp()) {
        <fpc-form-switch
          switchId="lw-spec-compare"
          [label]="compareLabel"
          [checked]="compare()"
          (checkedChange)="compare.set($event)"
          data-testid="spec-compare"
        />
      }
      @if (draftOp()) {
        <fpc-badge tone="warning" data-testid="spec-in-draft">● {{ inDraftLabel }}</fpc-badge>
      }
      <span class="ms-auto"></span>
      @if (draftOp() && draftStore && editable()) {
        <fpc-button
          variant="dark"
          size="sm"
          iconOnly
          [ariaLabel]="revertLabel"
          [title]="revertLabel"
          (clicked)="revertDraft()"
          data-testid="spec-revert-draft"
        >
          <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
        </fpc-button>
      }
      @if (editable()) {
        <fpc-button variant="primary" size="sm" (clicked)="edit()" data-testid="spec-edit">
          <i class="bi bi-pencil me-1" aria-hidden="true"></i>{{ editLabel }}
        </fpc-button>
      }
    </div>
    @if (selectedError(); as message) {
      <fpc-alert [flush]="true" variant="danger" [message]="message" />
    }
    @if (text() === null) {
      @if (!selectedError()) {
        <fpc-empty-state [loading]="true" [title]="loadingLabel" />
      }
    } @else {
      <fpc-section-row class="flex-grow-1 min-h-0" data-testid="spec-workbench">
        @if (compare() && liveText() !== null && draftOp()) {
          <loadweaver-lane [title]="liveLabel" [flush]="true" data-testid="spec-live">
            <fpc-code-editor
              class="lw-spec__code"
              [value]="liveText() ?? ''"
              language="yaml"
              height="auto"
              [readOnly]="true"
              [lineHighlights]="lineDiff().live"
            />
          </loadweaver-lane>
        }
        <loadweaver-lane [title]="draftOp() ? draftLabel : resourceLabel" [flush]="true" data-testid="spec-lane">
          <fpc-code-editor
            class="lw-spec__code"
            [value]="text() ?? ''"
            language="yaml"
            height="auto"
            [readOnly]="true"
            [lineHighlights]="lineDiff().draft"
            data-testid="spec-yaml"
          />
        </loadweaver-lane>
      </fpc-section-row>
    }
  `,
})
export class LoadweaverResourceSpecComponent {
  readonly resourceKey = input.required<ResourceKey>();
  /** The caller may edit (the object's "Edit in draft" action exists). */
  readonly editable = input(false);

  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly modal = inject(ResourceModalService);
  readonly draftStore = inject(WorkspaceDraftStore, { optional: true });

  private readonly selected = toSignal(this.facade.selected$, { initialValue: null });
  private readonly selectedLoading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly selectedError = toSignal(this.facade.selectedError$, { initialValue: null });

  readonly compare = signal(false);
  /** The live document (only from the fresh GET of this key). */
  readonly liveText = computed(() => {
    const resource = this.selected();

    if (this.selectedLoading() || !resource || !sameResourceKey(resourceKeyOfResource(resource), this.resourceKey()))
      return null;

    return resourceToYaml(resource);
  });
  readonly draftOp = computed(() => draftOpOf(this.draftStore?.active() ?? null, this.resourceKey()));
  /** What the Spec tab shows: the draft's version of the resource, else the live one. */
  readonly text = computed(() => {
    const op = this.draftOp();

    return op?.op === 'upsert' && op.document ? op.document : this.liveText();
  });
  readonly lineDiff = computed<SpecLineDiff>(() => {
    const live = this.liveText();
    const text = this.text();

    return this.compare() && live !== null && text !== null && this.draftOp()
      ? specLineDiff(live, text)
      : { live: [], draft: [] };
  });

  readonly compareLabel = $localize`:@@lwConsoleResourceEditor-compare:Draft vs live`;
  readonly inDraftLabel = $localize`:@@lwConsoleResourceEditor-inDraft:Changed in the draft`;
  readonly revertLabel = $localize`:@@lwConsoleWorkspace-revert:Undo in draft`;
  readonly editLabel = $localize`:@@lwConsoleResourceEditor-editTitle:Edit`;
  readonly loadingLabel = $localize`:@@lwConsoleResourceEditor-loading:Loading the resource`;
  readonly liveLabel = $localize`:@@lwConsoleResourceEditor-live:Live`;
  readonly draftLabel = $localize`:@@lwConsoleWorkspace-draft:Draft`;
  readonly resourceLabel = $localize`:@@lwConsoleResourceEditor-resourceTab:Resource`;

  constructor() {
    effect(() => {
      const key = this.resourceKey();

      untracked(() => this.facade.open(key));
    });
  }

  edit(): void {
    this.modal.openEdit(this.resourceKey());
  }

  /** Drops the draft's change of this resource: back to the live version. */
  async revertDraft(): Promise<void> {
    await this.draftStore?.revert(this.resourceKey());
  }
}
