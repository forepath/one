import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SharedMarkStackBrand = 'forepath' | 'agenstra' | 'decabill';

interface SharedMark {
  /** Side of the square box the path is drawn in. */
  size: number;
  /** Single path, even-odd filled. */
  d: string;
}

/**
 * The brand glyphs, normalised from each app's `favicon.svg` into the same 314-unit square box, so the
 * stack renders at the same scale for every brand (the front outline's stroke follows that scale).
 */
const SHARED_MARKS: Record<SharedMarkStackBrand, SharedMark> = {
  // The ring.
  forepath: {
    size: 314,
    d: 'M157.002,0C243.654,0 314.004,70.348 314.004,156.997C314.004,243.646 243.654,313.994 157.002,313.994C70.351,313.994 0.001,243.646 0.001,156.997C0.001,70.348 70.351,0 157.002,0ZM157.5,77.15C113.29,77.15 77.397,112.93 77.397,157C77.397,201.07 113.29,236.85 157.5,236.85C201.711,236.85 237.604,201.07 237.604,157C237.604,112.93 201.711,77.15 157.5,77.15Z',
  },
  // The rounded, tilted triangle ring.
  agenstra: {
    size: 314,
    d: 'M76.39,30.31A39.13,39.13 0 0 1 142.69,16.21L303.95,195.31A39.13,39.13 0 0 1 283.00,259.77L47.27,309.88A39.13,39.13 0 0 1 1.92,259.51L76.39,30.31ZM137.57,91.76A15.22,15.22 0 0 0 111.79,97.24L69.90,226.17A15.22,15.22 0 0 0 87.54,245.76L220.14,217.57A15.22,15.22 0 0 0 228.28,192.50L137.57,91.76Z',
  },
  // The decagon ring.
  decabill: {
    size: 314,
    d: 'M157.00,0.00L254.04,30.00L314.00,108.50L314.00,205.50L254.04,284.00L157.00,314.00L59.96,284.00L0.00,205.50L0.00,108.50L59.96,30.00L157.00,0.00ZM157.00,53.26L95.08,72.40L56.82,122.52L56.82,184.47L95.08,234.59L157.00,253.73L218.92,234.59L257.21,184.47L257.21,122.52L218.92,72.40L157.00,53.26Z',
  },
};

/** Front to back: scale of each copy (around its own centre) and its fill class. */
const LAYERS = [
  { scale: 1, cls: 'shared-mark-stack__mark--front' },
  { scale: 0.84, cls: 'shared-mark-stack__mark--2' },
  { scale: 0.7, cls: 'shared-mark-stack__mark--3' },
  { scale: 0.58, cls: 'shared-mark-stack__mark--4' },
] as const;

/** Diagonal step between copies, as a share of the mark size. */
const STEP = 96 / 314;

let nextMarkStackId = 0;

/**
 * Decorative stack of the brand mark for the home heroes: the front copy is a brand outline in the
 * top right that runs off the section; the copies behind step down and to the left, each smaller and
 * in a lighter brand tint. Place it as a direct child of the hero (`position: relative`,
 * `overflow: hidden`), before the content.
 */
@Component({
  selector: 'shared-mark-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'shared-mark-stack', 'aria-hidden': 'true' },
  template: `
    <svg class="shared-mark-stack__svg" [attr.viewBox]="viewBox()" focusable="false">
      <defs>
        <path [attr.id]="pathId" [attr.d]="mark().d" fill-rule="evenodd" />
      </defs>
      @for (layer of layers(); track layer.cls) {
        <use
          [attr.href]="'#' + pathId"
          class="shared-mark-stack__mark"
          [class]="layer.cls"
          [attr.transform]="layer.transform"
        />
      }
    </svg>
  `,
  styleUrl: './mark-stack.component.scss',
})
export class SharedMarkStackComponent {
  readonly brand = input.required<SharedMarkStackBrand>();

  protected readonly pathId = `shared-mark-stack-${nextMarkStackId++}`;
  protected readonly mark = computed(() => SHARED_MARKS[this.brand()]);

  protected readonly viewBox = computed(() => {
    const side = this.mark().size * (1 + 3 * STEP);

    return `0 0 ${side.toFixed(2)} ${side.toFixed(2)}`;
  });

  /** Back to front, so the front outline paints last. */
  protected readonly layers = computed(() => {
    const size = this.mark().size;
    const step = size * STEP;

    return LAYERS.map((layer, index) => {
      const centreX = 3 * step - index * step + size / 2;
      const centreY = index * step + size / 2;
      const offset = (size / 2) * layer.scale;

      return {
        cls: layer.cls,
        transform: `translate(${(centreX - offset).toFixed(2)} ${(centreY - offset).toFixed(2)}) scale(${layer.scale})`,
      };
    }).reverse();
  });
}
