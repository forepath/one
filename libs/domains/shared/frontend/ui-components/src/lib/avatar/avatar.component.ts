import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export type FpcAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Renders `src` when available and falls back to `initials` when the image is missing or fails
 * to load, so a broken URL never leaves an empty hole in a list.
 */
@Component({
  selector: 'fpc-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"fpc-avatar fpc-avatar--" + size()',
  },
  template: `
    @if (showImage()) {
      <img class="fpc-avatar__image" [src]="src()" [alt]="alt()" (error)="onImageError()" />
    } @else {
      <span class="fpc-avatar__initials" [attr.aria-label]="alt() || null" [attr.role]="alt() ? 'img' : null">
        {{ resolvedInitials() }}
      </span>
    }
  `,
  styleUrl: './avatar.component.scss',
})
export class FpcAvatarComponent {
  readonly src = input<string | null>(null);
  readonly initials = input('');
  readonly size = input<FpcAvatarSize>('md');
  readonly alt = input('');

  private readonly imageFailed = signal(false);

  protected readonly showImage = computed(() => Boolean(this.src()) && !this.imageFailed());

  protected readonly resolvedInitials = computed(() => {
    const initials = this.initials().trim();

    if (initials.length > 0) {
      return initials.slice(0, 2).toUpperCase();
    }

    const alt = this.alt().trim();

    if (alt.length === 0) {
      return '?';
    }

    return alt
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase();
  });

  protected onImageError(): void {
    this.imageFailed.set(true);
  }
}
