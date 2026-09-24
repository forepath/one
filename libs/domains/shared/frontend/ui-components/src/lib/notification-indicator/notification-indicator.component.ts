import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * `default` / `unread` — primary dot, `security-warning` — small warning dot,
 * `git` — info dot for repository activity, `both` — unread and security warning together.
 */
export type FpcNotificationIndicatorKind = 'default' | 'security-warning' | 'git' | 'unread' | 'both';

export type FpcNotificationIndicatorPlacement = 'inline' | 'absolute';

/**
 * Small status dot for sidebar items, list rows and tabs. `absolute` placement pins the dot to
 * the top-right corner of the nearest positioned ancestor, matching the sidebar badges in the
 * Agenstra and Decabill consoles.
 */
@Component({
  selector: 'fpc-notification-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"fpc-notification-indicator fpc-notification-indicator--" + placement()',
    '[attr.role]': 'ariaLabel() ? "status" : null',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.aria-hidden]': 'ariaLabel() ? null : "true"',
  },
  template: `
    @if (showUnread()) {
      <span class="fpc-notification-indicator__dot fpc-notification-indicator__dot--unread"></span>
    }
    @if (showGit()) {
      <span class="fpc-notification-indicator__dot fpc-notification-indicator__dot--git"></span>
    }
    @if (showSecurityWarning()) {
      <span class="fpc-notification-indicator__dot fpc-notification-indicator__dot--security-warning"></span>
    }
  `,
  styleUrl: './notification-indicator.component.scss',
})
export class FpcNotificationIndicatorComponent {
  readonly kind = input<FpcNotificationIndicatorKind>('default');
  readonly placement = input<FpcNotificationIndicatorPlacement>('inline');
  readonly ariaLabel = input<string | null>(null);

  protected readonly showUnread = computed(() => {
    const kind = this.kind();

    return kind === 'default' || kind === 'unread' || kind === 'both';
  });

  protected readonly showGit = computed(() => this.kind() === 'git');

  protected readonly showSecurityWarning = computed(() => {
    const kind = this.kind();

    return kind === 'security-warning' || kind === 'both';
  });
}
