import { ChangeDetectionStrategy, Component, computed, effect, input, model, OnDestroy, output } from '@angular/core';

export type FpcToastVariant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

const VARIANT_ICONS: Record<FpcToastVariant, string | null> = {
  default: null,
  primary: 'info-circle',
  success: 'check-circle',
  danger: 'exclamation-octagon',
  warning: 'exclamation-triangle',
  info: 'info-circle',
};

/**
 * Transient toast notification. Pair with `fpc-toast-container` for stacking/placement.
 */
@Component({
  selector: 'fpc-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-toast' },
  template: `
    @if (open()) {
      <div
        [class]="toastClasses()"
        [attr.role]="variant() === 'danger' ? 'alert' : 'status'"
        [attr.aria-live]="variant() === 'danger' ? 'assertive' : 'polite'"
        aria-atomic="true"
      >
        @if (title()) {
          <div class="toast-header">
            @if (resolvedIcon()) {
              <i class="bi bi-{{ resolvedIcon() }} me-2" aria-hidden="true"></i>
            }
            <strong class="me-auto">{{ title() }}</strong>
            @if (dismissible()) {
              <button type="button" class="btn-close" [attr.aria-label]="closeAriaLabel()" (click)="dismiss()"></button>
            }
          </div>
        }

        <div class="toast-body d-flex align-items-start gap-2">
          @if (resolvedIcon() && !title()) {
            <i class="bi bi-{{ resolvedIcon() }}" aria-hidden="true"></i>
          }
          <div class="flex-grow-1">
            @if (message()) {
              <span>{{ message() }}</span>
            }
            <ng-content />
          </div>
          @if (dismissible() && !title()) {
            <button type="button" class="btn-close" [attr.aria-label]="closeAriaLabel()" (click)="dismiss()"></button>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './toast.component.scss',
})
export class FpcToastComponent implements OnDestroy {
  readonly open = model(true);
  readonly variant = input<FpcToastVariant>('default');
  readonly title = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly dismissible = input(true);
  readonly closeAriaLabel = input('Close notification');
  /** Auto-dismiss delay in milliseconds; `0` keeps the toast until dismissed. */
  readonly delay = input(0);

  readonly closed = output<void>();

  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.clearTimeout();

      if (this.open() && this.delay() > 0) {
        this.timeoutId = setTimeout(() => this.dismiss(), this.delay());
      }
    });
  }

  protected readonly resolvedIcon = computed(() => this.icon() ?? VARIANT_ICONS[this.variant()]);

  protected readonly toastClasses = computed(() => {
    const classes = ['toast', 'show', 'fpc-toast__toast'];
    const variant = this.variant();

    if (variant !== 'default') {
      classes.push(`text-bg-${variant}`, 'border-0');
    }

    return classes.join(' ');
  });

  ngOnDestroy(): void {
    this.clearTimeout();
  }

  dismiss(): void {
    this.clearTimeout();
    this.open.set(false);
    this.closed.emit();
  }

  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
