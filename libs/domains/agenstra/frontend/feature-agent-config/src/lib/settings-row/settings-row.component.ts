import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';

@Component({
  selector: 'agenstra-agent-config-settings-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="agent-config-settings-row"
      [class.agent-config-settings-row--dirty]="dirty()"
      [class.agent-config-settings-row--locked]="lockable() && locked()"
    >
      <div class="agent-config-settings-row__copy">
        <div class="agent-config-settings-row__title">{{ title() }}</div>
        @if (description()) {
          <div class="agent-config-settings-row__description">{{ description() }}</div>
        }
      </div>
      <div class="agent-config-settings-row__control">
        <ng-content />
      </div>
      @if (lockable()) {
        @if (lockInteractive()) {
          <button
            type="button"
            class="agent-config-settings-row__lock btn btn-link btn-sm p-0"
            [class.text-warning]="locked()"
            [attr.aria-pressed]="locked()"
            [attr.aria-label]="locked() ? unlockLabel() : lockLabel()"
            [title]="locked() ? unlockLabel() : lockLabel()"
            (click)="onToggleLock()"
          >
            <i class="bi" [class.bi-lock-fill]="locked()" [class.bi-unlock]="!locked()" aria-hidden="true"></i>
          </button>
        } @else {
          <span
            class="agent-config-settings-row__lock agent-config-settings-row__lock--readonly"
            [class.text-warning]="locked()"
            [attr.aria-label]="lockedLabel()"
            [title]="lockedLabel()"
            role="img"
          >
            <i class="bi" [class.bi-lock-fill]="locked()" [class.bi-unlock]="!locked()" aria-hidden="true"></i>
          </span>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .agent-config-settings-row {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--bs-border-color);
      }
      .agent-config-settings-row--dirty {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bs-warning) 55%, transparent);
        background-color: color-mix(in srgb, var(--bs-warning) 8%, transparent);
      }
      .agent-config-settings-row--locked {
        background-color: color-mix(in srgb, var(--bs-secondary) 6%, transparent);
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
      .agent-config-settings-row__lock {
        flex: 0 0 auto;
        line-height: 1;
        font-size: 0.7rem;
        text-decoration: none;
        color: var(--bs-secondary-color);
      }
      .agent-config-settings-row__lock:hover,
      .agent-config-settings-row__lock:focus-visible {
        color: var(--bs-body-color);
      }
      .agent-config-settings-row__lock--readonly {
        cursor: default;
        pointer-events: none;
      }
      .agent-config-settings-row__lock--readonly:hover {
        color: var(--bs-secondary-color);
      }
    `,
  ],
})
export class AgentConfigSettingsRowComponent {
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  /** True when this row's value differs from the last loaded/saved baseline. */
  readonly dirty = input(false, { transform: booleanAttribute });
  /** When true, show a lock indicator (toggle or read-only). */
  readonly lockable = input(false, { transform: booleanAttribute });
  /** Whether this path is locked. */
  readonly locked = input(false, { transform: booleanAttribute });
  /** When false, the lock icon is display-only (higher-layer lock). */
  readonly lockInteractive = input(true, { transform: booleanAttribute });
  readonly lockChange = output<boolean>();

  lockLabel(): string {
    return $localize`:@@featureAgentConfig-lockSetting:Lock for lower layers`;
  }

  unlockLabel(): string {
    return $localize`:@@featureAgentConfig-unlockSetting:Unlock for lower layers`;
  }

  lockedLabel(): string {
    return this.locked()
      ? $localize`:@@featureAgentConfig-lockedByHigherLayer:Locked by a higher layer`
      : $localize`:@@featureAgentConfig-unlockedInherited:Not locked by a higher layer`;
  }

  onToggleLock(): void {
    if (!this.lockInteractive()) {
      return;
    }

    this.lockChange.emit(!this.locked());
  }
}
