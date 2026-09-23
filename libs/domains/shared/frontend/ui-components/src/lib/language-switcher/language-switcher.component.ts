import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

import { FpcButtonComponent, FpcButtonSize, FpcButtonVariant } from '../button/button.component';
import { FpcDropdownItemComponent } from '../dropdown-item/dropdown-item.component';
import { FpcDropdownComponent, FpcDropdownDirection } from '../dropdown/dropdown.component';

export interface FpcLocaleOption {
  code: string;
  label: string;
  /** When set, the menu row navigates via full page load (landing locale switch). */
  href?: string;
}

export type FpcLanguageSwitcherSize = 'sm' | 'md' | 'lg';

export type FpcLanguageSwitcherAppearance = 'default' | 'footer';

/**
 * Locale picker built on `fpc-dropdown`.
 *
 * - `appearance="default"` (consoles): link-style trigger with optional translate icon + uppercase locale code.
 * - `appearance="footer"` (landings): dark `btn-sm` trigger with globe + visible “Language” label; menu opens upward.
 *
 * Optional `href` on locale options renders anchor menuitems for full-page locale navigation.
 * Otherwise the consuming app handles `(localeChange)` (reload, route change, runtime i18n).
 */
@Component({
  selector: 'fpc-language-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcButtonComponent, FpcDropdownComponent, FpcDropdownItemComponent],
  host: {
    class: 'fpc-language-switcher',
    '[class.fpc-language-switcher--footer]': 'appearance() === "footer"',
  },
  template: `
    <fpc-dropdown [disabled]="disabled()" [alignment]="menuAlignment()" [direction]="menuDirection()">
      <fpc-button
        fpcDropdownTrigger
        class="fpc-language-switcher__trigger"
        [variant]="triggerVariant()"
        [size]="buttonSize()"
        [btnClass]="triggerBtnClass()"
        [disabled]="disabled()"
        [ariaLabel]="ariaLabel()"
        [title]="ariaLabel()"
      >
        @if (showIcon()) {
          <i class="bi" [class]="triggerIconClass()" aria-hidden="true"></i>
        }
        @if (appearance() === 'footer') {
          <span class="fpc-language-switcher__label">{{ resolvedTriggerLabel() }}</span>
        } @else {
          <span class="fpc-language-switcher__code">{{ currentCode() }}</span>
        }
      </fpc-button>

      @for (option of locales(); track option.code) {
        <fpc-dropdown-item
          [active]="option.code === locale()"
          [href]="option.href ?? null"
          (selected)="selectLocale(option.code)"
        >
          {{ option.label }}
        </fpc-dropdown-item>
      }
    </fpc-dropdown>
  `,
  styleUrl: './language-switcher.component.scss',
})
export class FpcLanguageSwitcherComponent {
  readonly locales = input<readonly FpcLocaleOption[]>([]);
  readonly locale = model<string | null>(null);
  readonly size = input<FpcLanguageSwitcherSize>('sm');
  readonly appearance = input<FpcLanguageSwitcherAppearance>('default');
  readonly disabled = input(false);
  readonly showIcon = input(true);
  readonly ariaLabel = input('Language');
  /** Visible trigger text for `appearance="footer"` (defaults to `ariaLabel`). */
  readonly triggerLabel = input<string | null>(null);

  protected readonly buttonSize = computed<FpcButtonSize>(() => this.size());
  protected readonly triggerVariant = computed<FpcButtonVariant>(() =>
    this.appearance() === 'footer' ? 'dark' : 'link',
  );
  protected readonly menuDirection = computed<FpcDropdownDirection>(() =>
    this.appearance() === 'footer' ? 'up' : 'down',
  );
  protected readonly menuAlignment = computed(() => (this.appearance() === 'footer' ? 'start' : 'end'));
  protected readonly triggerBtnClass = computed(() => (this.appearance() === 'footer' ? 'dropdown-toggle' : null));
  protected readonly triggerIconClass = computed(() => (this.appearance() === 'footer' ? 'bi-globe' : 'bi-translate'));
  protected readonly resolvedTriggerLabel = computed(() => this.triggerLabel() ?? this.ariaLabel());

  protected readonly currentCode = computed(() => {
    const code = this.locale() ?? this.locales()[0]?.code ?? '';

    return code.toUpperCase();
  });

  protected selectLocale(code: string): void {
    this.locale.set(code);
  }
}
