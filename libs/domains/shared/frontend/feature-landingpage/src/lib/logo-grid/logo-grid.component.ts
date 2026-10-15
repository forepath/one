import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
} from '@angular/core';

export interface SharedLogoGridLogo {
  id: string;
  name: string;
  logoUrl: string;
  /** Square or very bold marks that read too large at the default height. */
  compact?: boolean;
}

/**
 * Logo strip for the landing pages: one full-width row of cells separated by the grid-section lines
 * (a rounded single-column list on phones). There is one column per slot, each starting on its slot's
 * first logo. When the band has more logos than columns, all columns swap together every few seconds
 * to the next run of logos from the band's pool, wrapping around at the end. The columns always show
 * consecutive pool entries, so no logo ever shows in two columns at once. An optional caption takes
 * the first cell.
 *
 * Put it as the only content of a `grid-section` container and give the section the global
 * `landing-logo-section` class (padding and clipping live in `ui-components/styles/_landing.scss`).
 */
@Component({
  selector: 'shared-logo-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'shared-logo-grid',
    '[style.--shared-logo-grid-columns]': 'columns()',
  },
  template: `
    <!--
      Monochrome mark for the dark page: every coloured or dark part turns white, white and near-white
      parts (Fedora's "f", Cloudflare's flash, a white image background) turn transparent. Alpha
      becomes alpha x 3 x (1 - luminance), so logos keep their inner structure instead of a solid shape.
      The mask is computed from colour alone and then multiplied by the source alpha (rather than
      subtracting luminance from alpha), so anti-aliased edges keep their partial coverage.
    -->
    <svg class="shared-logo-grid__defs" aria-hidden="true" focusable="false">
      <filter id="shared-logo-grid-mono" color-interpolation-filters="sRGB">
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -0.6378 -2.1456 -0.2166 0 3"
          result="mono"
        />
        <feComposite in="mono" in2="SourceAlpha" operator="in" />
      </filter>
    </svg>
    <div class="shared-logo-grid__grid" role="list" [attr.aria-label]="ariaLabel()">
      @if (caption()) {
        <div class="shared-logo-grid__cell shared-logo-grid__cell--caption" role="presentation">
          <p class="small text-body-secondary mb-0">{{ caption() }}</p>
        </div>
      }
      @for (logo of visibleLogos(); track logo.instanceKey) {
        <div class="shared-logo-grid__cell" role="listitem">
          <img
            [src]="logo.logoUrl"
            [alt]="logo.name"
            class="shared-logo-grid__logo"
            [class.shared-logo-grid__logo--compact]="logo.compact"
            loading="lazy"
          />
        </div>
      }
    </div>
  `,
  styleUrl: './logo-grid.component.scss',
})
export class SharedLogoGridComponent {
  /** One entry per column, starting on its first logo; all logos of the band rotate across all columns. */
  readonly slots = input.required<readonly (readonly SharedLogoGridLogo[])[]>();
  readonly ariaLabel = input.required<string>();
  /** Short sentence shown in the first cell (e.g. "Runs with the coding agents your teams already use"). */
  readonly caption = input<string | null>(null);
  /** How long the columns show their logos before all of them swap together. */
  readonly rotationIntervalMs = input(4000);

  private readonly platformId = inject(PLATFORM_ID);

  /** Every logo once, interleaved across slots so the rotation mixes the slots' categories. */
  private readonly pool = computed(() => {
    const slots = this.slots();
    const seen = new Set<string>();
    const pool: SharedLogoGridLogo[] = [];
    const depth = Math.max(0, ...slots.map((slot) => slot.length));

    for (let index = 0; index < depth; index++) {
      for (const slot of slots) {
        const logo = slot[index];

        if (logo && !seen.has(logo.id)) {
          seen.add(logo.id);
          pool.push(logo);
        }
      }
    }

    return pool;
  });

  private readonly logoColumns = computed(() => Math.min(this.slots().length, this.pool().length));

  /** Pool index shown in the first column; resets when the logos change. */
  private readonly offset = linkedSignal({ source: this.pool, computation: () => 0 });

  protected readonly columns = computed(() => this.logoColumns() + (this.caption() ? 1 : 0));

  protected readonly visibleLogos = computed(() => {
    const pool = this.pool();
    const offset = this.offset();

    return Array.from({ length: this.logoColumns() }, (_, column) => {
      const logo = pool[(offset + column) % pool.length];

      return { ...logo, instanceKey: `${column}-${logo.id}` };
    });
  });

  constructor() {
    effect((onCleanup) => {
      const columns = this.logoColumns();
      const rotates = this.pool().length > columns;

      if (!rotates || !isPlatformBrowser(this.platformId) || this.prefersReducedMotion()) {
        return;
      }

      const total = this.pool().length;
      const timer = setInterval(
        () => this.offset.update((offset) => (offset + columns) % total),
        this.rotationIntervalMs(),
      );

      onCleanup(() => clearInterval(timer));
    });
  }

  private prefersReducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
