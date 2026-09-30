import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

@Component({
  selector: 'agenstra-agent-config-settings-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="agent-config-settings-row" [class.agent-config-settings-row--dirty]="dirty()">
      <div class="agent-config-settings-row__copy">
        <div class="agent-config-settings-row__title">{{ title() }}</div>
        @if (description()) {
          <div class="agent-config-settings-row__description">{{ description() }}</div>
        }
      </div>
      <div class="agent-config-settings-row__control">
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .agent-config-settings-row {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--bs-border-color);
      }
      .agent-config-settings-row--dirty {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bs-warning) 55%, transparent);
        background-color: color-mix(in srgb, var(--bs-warning) 8%, transparent);
      }
      :host(:last-child) .agent-config-settings-row {
        border-bottom: none;
      }
      .agent-config-settings-row__copy {
        flex: 1 1 auto;
        min-width: 0;
      }
      .agent-config-settings-row__title {
        font-weight: 600;
      }
      .agent-config-settings-row__description {
        font-size: 0.875rem;
        color: var(--bs-secondary-color);
      }
      .agent-config-settings-row__control {
        flex: 0 1 32rem;
        max-width: 50%;
      }
    `,
  ],
})
export class AgentConfigSettingsRowComponent {
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  /** True when this row's value differs from the last loaded/saved baseline. */
  readonly dirty = input(false, { transform: booleanAttribute });
}
