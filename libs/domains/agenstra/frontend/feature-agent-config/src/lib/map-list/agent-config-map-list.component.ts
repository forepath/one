import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, TemplateRef, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

export interface ConfigMapEntryBadge {
  label: string;
  color: 'success' | 'warning' | 'danger' | 'secondary';
}

export interface ConfigMapEntryView {
  key: string;
  summary: string;
  inherited: boolean;
  /** True when local overlay entry is new, updated, or pending delete vs baseline. */
  dirty: boolean;
  /** True when the key existed in baseline but was removed from the current overlay. */
  deleted: boolean;
  /** Extra status badges after Inherited/Removed (e.g. MCP runtime status). */
  badges?: ConfigMapEntryBadge[];
}

/**
 * Expandable keyed-map list for agent configuration structured editors.
 */
@Component({
  selector: 'agenstra-agent-config-map-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    NgTemplateOutlet,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <div class="agent-config-map-list">
      @if (!disabled() && showAddChrome()) {
        <div class="agent-config-map-list__chrome">
          <fpc-form-field forId="agentConfigMapListNewKey" [label]="addLabel()">
            <fpc-input-group>
              <fpc-form-control
                controlId="agentConfigMapListNewKey"
                [ngModel]="draftKey()"
                (ngModelChange)="draftKey.set($event)"
                [disabled]="disabled()"
                [placeholder]="addPlaceholder()"
              />
              <fpc-button
                fpcInputGroupSuffix
                variant="secondary"
                iconOnly
                [disabled]="disabled() || !draftKey().trim()"
                (clicked)="onAdd()"
                i18n-ariaLabel="@@featureAgentConfig-addEntry"
                ariaLabel="Add"
              >
                <i class="bi bi-plus" aria-hidden="true"></i>
              </fpc-button>
            </fpc-input-group>
          </fpc-form-field>
        </div>
      }

      @if (entries().length === 0) {
        <div class="agent-config-map-list__empty">
          <fpc-empty-state size="sm" [message]="emptyLabel()" />
        </div>
      } @else {
        <fpc-list [flush]="true" [ariaLabel]="ariaLabel()">
          @for (entry of entries(); track entry.key) {
            <fpc-list-item variant="condensed" [dirty]="entry.dirty">
              <span fpcListItemTitle>
                {{ entry.key }}
                @if (entry.inherited) {
                  <span class="badge text-bg-secondary ms-2" i18n="@@featureAgentConfig-inheritedBadge">Inherited</span>
                }
                @if (entry.deleted) {
                  <span class="badge text-bg-warning ms-2" i18n="@@featureAgentConfig-removedBadge">Removed</span>
                }
                @for (badge of entry.badges ?? []; track badge.label) {
                  <fpc-badge class="ms-2" [color]="badge.color" size="sm">{{ badge.label }}</fpc-badge>
                }
              </span>
              <span fpcListItemMeta class="text-secondary">{{ entry.summary }}</span>
              <div fpcListItemActions class="d-flex gap-1">
                @if (leadingActionsTemplate()) {
                  <ng-container
                    *ngTemplateOutlet="leadingActionsTemplate()!; context: { $implicit: entry.key, entry: entry }"
                  />
                }
                <fpc-button
                  variant="secondary"
                  size="sm"
                  iconOnly
                  [disabled]="disabled() || entry.deleted"
                  (clicked)="toggle(entry.key)"
                  i18n-ariaLabel="@@featureAgentConfig-editEntry"
                  ariaLabel="Edit"
                >
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </fpc-button>
                <fpc-button
                  variant="danger"
                  size="sm"
                  iconOnly
                  [disabled]="disabled() || entry.inherited || entry.deleted"
                  (clicked)="remove.emit(entry.key)"
                  i18n-ariaLabel="@@featureAgentConfig-removeEntry"
                  ariaLabel="Remove"
                >
                  <i class="bi bi-trash" aria-hidden="true"></i>
                </fpc-button>
              </div>
              @if (!entry.deleted && expandedKey() === entry.key && entryTemplate()) {
                <div class="agent-config-map-list__editor w-100">
                  <ng-container *ngTemplateOutlet="entryTemplate()!; context: { $implicit: entry.key, entry: entry }" />
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

      .agent-config-map-list__chrome {
        padding-inline: 1rem;
        padding-block: 0.75rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);

        ::ng-deep .fpc-form-field {
          margin-bottom: 0;
        }
      }

      .agent-config-map-list__empty {
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

      .agent-config-map-list__editor {
        max-width: 100%;
      }
    `,
  ],
})
export class AgentConfigMapListComponent {
  readonly entries = input.required<ConfigMapEntryView[]>();
  readonly entryTemplate = input<TemplateRef<{ $implicit: string; entry: ConfigMapEntryView }> | null>(null);
  /** Optional actions rendered before Edit/Remove (e.g. MCP Authenticate). */
  readonly leadingActionsTemplate = input<TemplateRef<{ $implicit: string; entry: ConfigMapEntryView }> | null>(null);
  readonly disabled = input(false);
  readonly lockInherited = input(true);
  /** When false, the built-in free-text add chrome is omitted (host supplies its own). */
  readonly showAddChrome = input(true);
  readonly emptyLabel = input('No entries yet.');
  readonly addLabel = input($localize`:@@featureAgentConfig-addNameLabel:Name`);
  readonly addPlaceholder = input<string | null>(null);
  readonly ariaLabel = input('Configuration entries');
  readonly draftKey = model('');
  readonly expandedKey = model<string | null>(null);

  readonly add = output<string>();
  readonly remove = output<string>();

  toggle(key: string): void {
    this.expandedKey.set(this.expandedKey() === key ? null : key);
  }

  onAdd(): void {
    const key = this.draftKey().trim();

    if (!key) {
      return;
    }

    this.add.emit(key);
    this.draftKey.set('');
    this.expandedKey.set(key);
  }
}
