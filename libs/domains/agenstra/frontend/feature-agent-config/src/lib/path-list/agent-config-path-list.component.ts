import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

import { classifyPathListValue, isLocalEditorPath, resolveLayerEditorPath } from './path-list-value.util';

export interface PathListEntryView {
  value: string;
  inherited: boolean;
  index: number;
  /** True when local overlay entry is new, updated, or pending delete vs baseline. */
  dirty: boolean;
  /** True when the value existed in baseline but was removed from the current overlay. */
  deleted: boolean;
}

/**
 * Heredity-aware list for path/URL string arrays (skills, instructions).
 * Inherited rows are locked; local overlay rows support add/edit/remove and file/URL actions.
 */
@Component({
  selector: 'agenstra-agent-config-path-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <div class="agent-config-path-list">
      @if (!disabled()) {
        <div class="agent-config-path-list__chrome">
          <fpc-form-field forId="agentConfigPathListDraft" [label]="addLabel()">
            <fpc-input-group>
              <fpc-form-control
                controlId="agentConfigPathListDraft"
                [ngModel]="draft()"
                (ngModelChange)="draft.set($event)"
                [placeholder]="addPlaceholder()"
              />
              <fpc-button
                fpcInputGroupSuffix
                variant="secondary"
                iconOnly
                [disabled]="!draft().trim()"
                (clicked)="onAdd()"
                i18n-ariaLabel="@@featureAgentConfig-addPathEntry"
                ariaLabel="Add"
              >
                <i class="bi bi-plus" aria-hidden="true"></i>
              </fpc-button>
            </fpc-input-group>
          </fpc-form-field>
        </div>
      }

      @if (entries().length === 0) {
        <div class="agent-config-path-list__empty">
          <fpc-empty-state size="sm" [message]="emptyLabel()" />
        </div>
      } @else {
        <fpc-list [flush]="true" [ariaLabel]="ariaLabel()">
          @for (entry of entries(); track trackEntry(entry)) {
            <fpc-list-item variant="condensed" [dirty]="entry.dirty">
              <span fpcListItemTitle>
                <code class="small">{{ entry.value }}</code>
                @if (entry.inherited) {
                  <span class="badge text-bg-secondary ms-2" i18n="@@featureAgentConfig-inheritedBadge">Inherited</span>
                }
                @if (entry.deleted) {
                  <span class="badge text-bg-warning ms-2" i18n="@@featureAgentConfig-removedBadge">Removed</span>
                }
              </span>
              <fpc-button-group fpcListItemActions size="sm">
                @if (!entry.deleted && canOpenUrl(entry)) {
                  <fpc-button
                    variant="secondary"
                    size="sm"
                    iconOnly
                    (clicked)="openUrl.emit(entry.value.trim())"
                    i18n-ariaLabel="@@featureAgentConfig-openUrl"
                    ariaLabel="Open URL"
                    i18n-title="@@featureAgentConfig-openUrl"
                    title="Open URL"
                  >
                    <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                  </fpc-button>
                }
                @if (!entry.deleted && canShowOpenFile(entry)) {
                  <fpc-button
                    variant="secondary"
                    size="sm"
                    iconOnly
                    [disabled]="entry.inherited || disabled()"
                    (clicked)="onEditFile(entry)"
                    i18n-ariaLabel="@@featureAgentConfig-openPath"
                    ariaLabel="Open"
                    i18n-title="@@featureAgentConfig-openPath"
                    title="Open"
                  >
                    <i class="bi bi-folder2-open" aria-hidden="true"></i>
                  </fpc-button>
                }
                <fpc-button
                  variant="secondary"
                  size="sm"
                  iconOnly
                  [disabled]="entry.inherited || entry.deleted || disabled()"
                  (clicked)="toggleEdit(entry)"
                  i18n-ariaLabel="@@featureAgentConfig-editPathEntry"
                  ariaLabel="Edit"
                >
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </fpc-button>
                <fpc-button
                  variant="danger"
                  size="sm"
                  iconOnly
                  [disabled]="entry.inherited || entry.deleted || disabled()"
                  (clicked)="onRemove(entry)"
                  i18n-ariaLabel="@@featureAgentConfig-removePathEntry"
                  ariaLabel="Remove"
                >
                  <i class="bi bi-trash" aria-hidden="true"></i>
                </fpc-button>
              </fpc-button-group>
              @if (!entry.deleted && !entry.inherited && !disabled() && isEditExpanded(entry)) {
                <div class="agent-config-path-list__row-edit w-100">
                  <fpc-form-control
                    class="agent-config-path-list__control"
                    [ngModel]="entry.value"
                    (ngModelChange)="onChange(entry, $event)"
                  />
                </div>
              }
            </fpc-list-item>
          }
        </fpc-list>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .agent-config-path-list__chrome {
        padding-inline: 1rem;
        padding-block: 0.75rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);

        ::ng-deep .fpc-form-field {
          margin-bottom: 0;
        }

        ::ng-deep fpc-input-group,
        ::ng-deep .fpc-input-group__group {
          width: 100%;
        }
      }

      .agent-config-path-list__empty {
        display: flex;
        justify-content: center;
        padding: 0.75rem 1rem;

        fpc-empty-state {
          flex: none;
          align-self: center;
          width: auto;
          min-height: 0;
        }
      }

      .agent-config-path-list__row-edit {
        padding: 0.75rem 1rem;
      }

      .agent-config-path-list__control {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class AgentConfigPathListComponent {
  readonly entries = input.required<PathListEntryView[]>();
  readonly disabled = input(false);
  readonly emptyLabel = input('No entries yet.');
  readonly addLabel = input($localize`:@@featureAgentConfig-addPathLabel:Path or URL`);
  readonly addPlaceholder = input($localize`:@@featureAgentConfig-addPathPlaceholder:/path or https://…`);
  readonly ariaLabel = input('Path entries');

  readonly add = output<string>();
  readonly entryChange = output<{ index: number; value: string }>();
  readonly remove = output<number>();
  readonly editFile = output<string>();
  readonly openUrl = output<string>();

  readonly draft = signal('');
  /** Local entry index currently showing the inline path editor; null when collapsed. */
  readonly expandedIndex = signal<number | null>(null);

  readonly hasLocalEntries = computed(() => this.entries().some((entry) => !entry.inherited));

  trackEntry(entry: PathListEntryView): string {
    return `${entry.inherited ? 'i' : entry.deleted ? 'd' : 'l'}:${entry.index}:${entry.value}`;
  }

  canOpenUrl(entry: PathListEntryView): boolean {
    return classifyPathListValue(entry.value) === 'url';
  }

  canShowOpenFile(entry: PathListEntryView): boolean {
    return isLocalEditorPath(entry.value);
  }

  onEditFile(entry: PathListEntryView): void {
    if (entry.inherited || this.disabled()) {
      return;
    }

    const resolved = resolveLayerEditorPath(entry.value);

    if (!resolved) {
      return;
    }

    this.editFile.emit(resolved);
  }

  isEditExpanded(entry: PathListEntryView): boolean {
    return !entry.inherited && this.expandedIndex() === entry.index;
  }

  toggleEdit(entry: PathListEntryView): void {
    if (entry.inherited || this.disabled()) {
      return;
    }

    this.expandedIndex.set(this.expandedIndex() === entry.index ? null : entry.index);
  }

  onAdd(): void {
    const value = this.draft().trim();

    if (!value || this.disabled()) {
      return;
    }

    const nextIndex = this.entries().filter((entry) => !entry.inherited).length;
    this.add.emit(value);
    this.draft.set('');
    this.expandedIndex.set(nextIndex);
  }

  onChange(entry: PathListEntryView, value: string): void {
    if (entry.inherited || this.disabled()) {
      return;
    }

    this.entryChange.emit({ index: entry.index, value });
  }

  onRemove(entry: PathListEntryView): void {
    if (entry.inherited || this.disabled()) {
      return;
    }

    if (this.expandedIndex() === entry.index) {
      this.expandedIndex.set(null);
    }

    this.remove.emit(entry.index);
  }
}
