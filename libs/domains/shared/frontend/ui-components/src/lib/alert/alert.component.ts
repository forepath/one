import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, model, output } from '@angular/core';

export type FpcAlertVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark';

const VARIANT_ICONS: Record<FpcAlertVariant, string> = {
  primary: 'info-circle',
  secondary: 'info-circle',
  success: 'check-circle',
  danger: 'exclamation-octagon',
  warning: 'exclamation-triangle',
  info: 'info-circle',
  light: 'info-circle',
  dark: 'info-circle',
};

/**
 * Inline status / error banner. Always shows a leading variant icon unless `showIcon` is false
 * (e.g. custom spinner content). Use `flush` for full-width strips under `fpc-page-header`.
 *
 * Optional trailing actions via `[fpcAlertActions]` (e.g. `fpc-button`) sit at the far right of
 * the alert row, before the dismiss control when `dismissible` is set.
 */
@Component({
  selector: 'fpc-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-alert',
    '[class.fpc-alert--flush]': 'flush()',
  },
  template: `
    @if (open()) {
      <div
        [class]="alertClasses()"
        [attr.role]="variant() === 'danger' ? 'alert' : 'status'"
        [attr.aria-live]="variant() === 'danger' ? 'assertive' : 'polite'"
      >
        @if (showIcon()) {
          <i class="bi bi-{{ resolvedIcon() }} fpc-alert__icon" aria-hidden="true"></i>
        }

        <div class="fpc-alert__content">
          @if (heading()) {
            <h3 class="alert-heading h6">{{ heading() }}</h3>
          }
          @if (message()) {
            <p class="mb-0">{{ message() }}</p>
          }
          <ng-content />
        </div>

        <div class="fpc-alert__actions">
          <ng-content select="[fpcAlertActions]" />
        </div>

        @if (dismissible()) {
          <button
            type="button"
            class="btn-close fpc-alert__close"
            [attr.aria-label]="closeAriaLabel()"
            (click)="dismiss()"
          ></button>
        }
      </div>
    }
  `,
  styleUrl: './alert.component.scss',
})
export class FpcAlertComponent {
  readonly open = model(true);
  readonly variant = input<FpcAlertVariant>('info');
  readonly heading = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly icon = input<string | null>(null);
  /** Defaults to true so all alerts share a leading icon. */
  readonly showIcon = input(true, { transform: booleanAttribute });
  /** Square corners; drops side/top borders for full-width strips under page headers. */
  readonly flush = input(false, { transform: booleanAttribute });
  readonly dismissible = input(false, { transform: booleanAttribute });
  readonly closeAriaLabel = input('Dismiss message');

  readonly closed = output<void>();

  protected readonly resolvedIcon = computed(() => this.icon() ?? VARIANT_ICONS[this.variant()]);

  protected readonly alertClasses = computed(() =>
    ['alert', `alert-${this.variant()}`, 'fpc-alert__alert', 'mb-0'].join(' '),
  );

  protected dismiss(): void {
    this.open.set(false);
    this.closed.emit();
  }
}
