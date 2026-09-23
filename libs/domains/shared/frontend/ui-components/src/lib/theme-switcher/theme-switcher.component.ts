import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, model } from '@angular/core';

export type FpcThemeSwitcherVariant = 'switch' | 'button';

let nextThemeSwitcherId = 0;

/**
 * Dark-mode toggle. By default it only reports the new state; set `applyToDocument` to let the
 * component write `data-bs-theme` on `<html>` itself (handy in Storybook and small apps).
 */
@Component({
  selector: 'fpc-theme-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-theme-switcher' },
  template: `
    @if (variant() === 'switch') {
      <div class="form-check form-switch fpc-theme-switcher__switch">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          [id]="switchId"
          [checked]="dark()"
          (change)="onToggle($event)"
        />
        <label class="form-check-label" [for]="switchId" [title]="ariaLabel()">
          <i class="bi" [class.bi-moon-fill]="!dark()" [class.bi-sun-fill]="dark()" aria-hidden="true"></i>
          <span class="visually-hidden">{{ ariaLabel() }}</span>
        </label>
      </div>
    } @else {
      <button
        type="button"
        class="btn btn-link fpc-theme-switcher__button"
        [attr.aria-pressed]="dark()"
        [attr.aria-label]="ariaLabel()"
        [title]="ariaLabel()"
        (click)="toggle()"
      >
        <i class="bi" [class.bi-moon-fill]="!dark()" [class.bi-sun-fill]="dark()" aria-hidden="true"></i>
      </button>
    }
  `,
  styleUrl: './theme-switcher.component.scss',
})
export class FpcThemeSwitcherComponent {
  private readonly document = inject(DOCUMENT);

  readonly dark = model(false);
  readonly variant = input<FpcThemeSwitcherVariant>('switch');
  readonly ariaLabel = input('Toggle dark mode');
  /** Writes `data-bs-theme` on the document element whenever `dark` changes. */
  readonly applyToDocument = input(false);

  protected readonly switchId = `fpc-theme-switcher-${nextThemeSwitcherId++}`;

  constructor() {
    effect(() => {
      if (this.applyToDocument()) {
        this.document.documentElement.setAttribute('data-bs-theme', this.dark() ? 'dark' : 'light');
      }
    });
  }

  toggle(): void {
    this.dark.set(!this.dark());
  }

  protected onToggle(event: Event): void {
    this.dark.set((event.target as HTMLInputElement).checked);
  }
}
