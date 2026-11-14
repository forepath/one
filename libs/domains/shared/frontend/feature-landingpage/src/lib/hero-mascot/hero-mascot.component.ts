import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  NgZone,
} from '@angular/core';

export type SharedHeroMascotBrand = 'forepath' | 'agenstra' | 'decabill';

/**
 * `point`: standing on the ground, pointing up and to the right at what stands beside it.
 * `corner`: hanging from the top-right corner of what it is placed on, like climbing a wall: the right
 * hand grips the corner overhead, the body and legs dangle below it (swinging out a little), the left
 * arm points inwards. The host shifts itself so the grip lands on its containing block's top-right
 * corner, so `top: 0; right: 0` places it.
 * `perch`: standing on the top edge of what sits below it, near its right end: the shoes on the edge,
 * the right hand on the hip, the left arm pointing down and inwards. The host's bottom edge is the soles
 * and its right edge a little past the body, so `right: 0; bottom: 100%` places it.
 * `peek`: peeking up from behind an edge, holding on to it: the host clips everything below its bottom
 * edge, the hands stay on that edge while the body rises and sinks behind them (the arms and legs stay
 * hidden behind and below it). Looking up and inwards.
 * `peek-point`: the hero variant of `peek`, calmer and livelier at once: it stays pulled up (only the
 * eyes move), holds on with the right hand only, leans in, and points up and inwards with the left (at
 * the headline).
 */
export type SharedHeroMascotPose = 'point' | 'corner' | 'perch' | 'peek' | 'peek-point';

type Point = readonly [x: number, y: number];

interface SharedHeroMascotBody {
  /** The brand glyph from the avatar, even-odd filled. */
  d: string;
  /** Places the glyph in the shared ~100-unit body box. */
  transform: string | null;
  /** Eyes: centre and radius. */
  eyes: readonly (readonly [cx: number, cy: number, r: number])[];
  eyeStroke: number;
  /**
   * Hanging, fill the glyph's hole with the page surface: for a hole large enough that the scene behind
   * shows through it too strongly, even through the halo.
   */
  backHole?: boolean;
  /** Where the pointing arm, the arm on the hip and the legs leave the body (inside its outline). */
  pointShoulder: Point;
  hipShoulder: Point;
  hips: readonly [Point, Point];
  /** Peeking: where (across) the hands hold on to the edge, under the body's sides. */
  peekHands: readonly [number, number];
}

/**
 * The brand avatars (the glyph with two googly eyes), normalised to the same ~100-unit box so the
 * limbs share one rig. The limbs start inside the outline and are painted behind the glyph.
 */
const SHARED_HERO_MASCOT_BODIES: Record<SharedHeroMascotBrand, SharedHeroMascotBody> = {
  // The ring.
  forepath: {
    d: 'M157.002,0C243.654,0 314.004,70.348 314.004,156.997C314.004,243.646 243.654,313.994 157.002,313.994C70.351,313.994 0.001,243.646 0.001,156.997C0.001,70.348 70.351,0 157.002,0ZM157.5,77.15C113.29,77.15 77.397,112.93 77.397,157C77.397,201.07 113.29,236.85 157.5,236.85C201.711,236.85 237.604,201.07 237.604,157C237.604,112.93 201.711,77.15 157.5,77.15Z',
    transform: 'scale(0.31847)',
    eyes: [
      [31.85, 18.47, 14.65],
      [68.15, 18.47, 14.65],
    ],
    eyeStroke: 1.91,
    pointShoulder: [90, 34],
    hipShoulder: [10, 60],
    hips: [
      [37, 92],
      [63, 92],
    ],
    peekHands: [16, 84],
  },
  // The rounded, tilted triangle ring.
  agenstra: {
    d: 'M25.06,9.94A12.84,12.84 0 0 1 46.81,5.32L99.70,64.07A12.84,12.84 0 0 1 92.83,85.21L15.51,101.65A12.84,12.84 0 0 1 0.63,85.13L25.06,9.94ZM45.13,30.10A4.99,4.99 0 0 0 36.67,31.90L22.93,74.19A4.99,4.99 0 0 0 28.71,80.61L72.21,71.37A4.99,4.99 0 0 0 74.88,63.15L45.13,30.10Z',
    transform: null,
    eyes: [
      [24, 30, 14],
      [52, 28, 14],
    ],
    eyeStroke: 2,
    backHole: true,
    pointShoulder: [74, 38],
    hipShoulder: [12, 62],
    hips: [
      [32, 95],
      [68, 88],
    ],
    peekHands: [20, 80],
  },
  // The decagon ring.
  decabill: {
    d: 'M256,76.8L361.35,111.03L426.46,200.63L426.46,311.37L361.35,400.97L256,435.2L150.65,400.97L85.54,311.37L85.54,200.63L150.65,111.03L256,76.8ZM256,137.6L188.78,159.44L147.22,216.64L147.22,287.36L188.78,344.56L256,366.4L323.22,344.56L364.78,287.36L364.78,216.64L323.22,159.44L256,137.6Z',
    transform: 'matrix(0.302124,0,0,0.287388,-25.8437,-22.0714)',
    eyes: [
      [35, 14, 15],
      [68, 14, 15],
    ],
    eyeStroke: 2,
    pointShoulder: [94, 40],
    hipShoulder: [8, 62],
    hips: [
      [37, 98],
      [67, 98],
    ],
    peekHands: [14, 89],
  },
};

/** Standing: where the shoes stand, in the body box; the viewBox ends at their soles (GROUND + 1 + ry 4). */
const GROUND = 122;

/**
 * Hanging: the grip (the corner, overhead and to the right of the body), how far the whole figure
 * swings out (degrees around the grip; negative swings the feet away from what it hangs on) and where
 * the dangling feet end. The hanging viewBox is -16 -30 140 170: the grip sits 24 units in from its
 * right edge and 6 below its top, which the host's `translate` in the stylesheet relies on.
 */
const GRIP: Point = [100, -24];
const LEAN = -12;
const HANG = 122;

/** Perched: where the shoes stand on the edge below (the viewBox ends at their soles). */
const PERCH = 118;

/**
 * Per pose: the viewBox and the rest gaze (towards the finger: up and to the right standing, inwards
 * and a little down hanging, down and inwards perched).
 */
const POSES: Record<SharedHeroMascotPose, { viewBox: string; gaze: number }> = {
  point: { viewBox: '-20 -6 156 133', gaze: (-40 * Math.PI) / 180 },
  corner: { viewBox: '-16 -30 140 170', gaze: (165 * Math.PI) / 180 },
  perch: { viewBox: '-30 -6 148 129', gaze: (140 * Math.PI) / 180 },
  peek: { viewBox: '-4 -4 111 111', gaze: (-135 * Math.PI) / 180 },
  'peek-point': { viewBox: '-32 -4 139 111', gaze: (-135 * Math.PI) / 180 },
};

/**
 * Peeking: the edge (the viewBox's bottom), where on it the hands hold on (mostly above it, the rest
 * curled over) and how big they are (larger than elsewhere: the peeking figure is drawn small).
 */
const PEEK_EDGE = 107;
const PEEK_HAND_R = 7.5;
const PEEK_HAND_Y = PEEK_EDGE - PEEK_HAND_R + 2;
/** Peeking and pointing: how far the figure leans in (degrees, around the middle of the edge). */
const PEEK_LEAN = -7;

/** How far a pupil moves off the eye's centre, as a share of the eye's radius. */
const GAZE_REACH = 0.38;

const add = ([x, y]: Point, [dx, dy]: Point): Point => [x + dx, y + dy];

/** A media query, false where there is no `matchMedia` (jsdom in the consuming apps' specs). */
const mediaMatches = (query: string): boolean => typeof matchMedia === 'function' && matchMedia(query).matches;
const pt = ([x, y]: Point): string => `${+x.toFixed(2)},${+y.toFixed(2)}`;

/**
 * The brand avatar as a small character for the heroes and the footer, with or without legs and arms
 * (see `SharedHeroMascotPose`), the eyes on the finger. While a fine pointer hovers the section it is
 * in (the closest `section`, `footer` or `[data-hero-mascot-area]`), the eyes follow it instead, and settle back when it leaves
 * (like the mark stack's pull; both are off for reduced motion). Decorative; the host sizes it (it
 * fills its width), the limbs and shoes take `--shared-hero-mascot-ink`.
 */
@Component({
  selector: 'shared-hero-mascot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'shared-hero-mascot',
    '[class.shared-hero-mascot--corner]': "pose() === 'corner'",
    '[class.shared-hero-mascot--peek]': "pose() === 'peek' || pose() === 'peek-point'",
    'aria-hidden': 'true',
  },
  template: `
    @let rig = mascot();
    <svg
      class="shared-hero-mascot__svg"
      [class.shared-hero-mascot__svg--peek]="rig.peek && !rig.still"
      [class.shared-hero-mascot__svg--peek-still]="rig.still"
      [attr.viewBox]="rig.viewBox"
      focusable="false"
    >
      <!-- The whole figure; hanging, it leans in around the grip. -->
      <g class="shared-hero-mascot__figure" [attr.transform]="rig.lean">
        <g class="shared-hero-mascot__limbs">
          @for (limb of rig.limbs; track $index) {
            <path [attr.d]="limb" />
          }
        </g>
        @for (shoe of rig.shoes; track $index) {
          <ellipse
            class="shared-hero-mascot__shoe"
            [attr.cx]="shoe[0]"
            [attr.cy]="shoe[1]"
            [attr.rx]="rig.shoeRx"
            ry="4"
          />
        }
        @if (rig.backing) {
          <!-- The glyph's outer outline, filled, behind it: closes the hole (see backHole). -->
          <path class="shared-hero-mascot__backing" [attr.d]="rig.backing" [attr.transform]="rig.body.transform" />
        }
        <path class="shared-hero-mascot__body" [attr.d]="rig.body.d" [attr.transform]="rig.body.transform" />
        @for (eye of rig.eyes; track $index) {
          <circle
            class="shared-hero-mascot__eye"
            [attr.cx]="eye.cx"
            [attr.cy]="eye.cy"
            [attr.r]="eye.r"
            [attr.stroke-width]="rig.body.eyeStroke"
          />
          <!-- Drawn at the eye's centre and moved by translate: the rest gaze, or towards the pointer. -->
          <g
            class="shared-hero-mascot__gaze"
            [style.--shared-hero-mascot-rest-x.px]="eye.restX"
            [style.--shared-hero-mascot-rest-y.px]="eye.restY"
          >
            <circle class="shared-hero-mascot__pupil" [attr.cx]="eye.cx" [attr.cy]="eye.cy" [attr.r]="eye.pr" />
            <circle class="shared-hero-mascot__glint" [attr.cx]="eye.gx" [attr.cy]="eye.gy" [attr.r]="eye.gr" />
          </g>
        }
        @if (rig.restHand; as restHand) {
          <circle class="shared-hero-mascot__glove" [attr.cx]="restHand[0]" [attr.cy]="restHand[1]" r="5.6" />
        }
        @if (rig.hand; as hand) {
          @if (rig.finger) {
            <path class="shared-hero-mascot__finger-outline" [attr.d]="rig.finger" />
          }
          <circle class="shared-hero-mascot__glove" [attr.cx]="hand[0]" [attr.cy]="hand[1]" r="5.6" />
          @if (rig.finger) {
            <path class="shared-hero-mascot__finger" [attr.d]="rig.finger" />
          }
        }
      </g>
      <!-- Peeking: the hands on the edge stay put, outside the (moving) figure. -->
      @for (x of rig.edgeHands; track $index) {
        <circle class="shared-hero-mascot__glove" [attr.cx]="x" [attr.cy]="peekHandY" [attr.r]="peekHandR" />
      }
    </svg>
  `,
  styleUrl: './hero-mascot.component.scss',
})
export class SharedHeroMascotComponent {
  readonly brand = input.required<SharedHeroMascotBrand>();
  readonly pose = input<SharedHeroMascotPose>('point');

  protected readonly peekHandY = PEEK_HAND_Y;
  protected readonly peekHandR = PEEK_HAND_R;

  protected readonly mascot = computed(() => {
    const body = SHARED_HERO_MASCOT_BODIES[this.brand()];
    const pose = POSES[this.pose()];
    const hanging = this.pose() === 'corner';
    const perched = this.pose() === 'perch';
    const peeking = this.pose() === 'peek';
    const peekPointing = this.pose() === 'peek-point';
    const [leftHip, rightHip] = body.hips;
    const right = body.pointShoulder;
    const left = body.hipShoulder;

    // Standing: the right arm points up and to the right (slightly bent, index finger out), the left
    // hand rests on the hip. Hanging: the right arm reaches up to the grip (the elbow bowed out a
    // little), the left points inwards. Perched: the right hand on the hip, the left points down and
    // inwards. Peeking: no visible arms (they run down behind the body to the hands on the edge).
    // Peeking and pointing: the right arm runs down to its hand on the edge (hidden), the left points
    // up and inwards.
    let pointArm: [Point, Point, Point];
    let restArm: [Point, Point, Point];
    let fingertip: Point | null;

    if (peeking) {
      pointArm = [right, right, right];
      fingertip = null;
      restArm = [left, left, left];
    } else if (peekPointing) {
      const elbow = add(left, [-14, -4]);
      const hand = add(elbow, [-9, -14]);

      pointArm = [left, elbow, hand];
      fingertip = add(hand, [-6, -7]);
      restArm = [right, right, right];
    } else if (hanging) {
      const elbow = add(left, [-14, 2]);
      const hand = add(elbow, [-13, 3]);

      pointArm = [left, elbow, hand];
      fingertip = add(hand, [-8, 1]);
      restArm = [right, [(right[0] + GRIP[0]) / 2 + 7, (right[1] + GRIP[1]) / 2], GRIP];
    } else if (perched) {
      const elbow = add(left, [-15, 4]);
      const hand = add(elbow, [-10, 14]);

      pointArm = [left, elbow, hand];
      fingertip = add(hand, [-6, 7]);
      restArm = [right, add(right, [15, 11]), add(right, [2, 22])];
    } else {
      const elbow = add(right, [15, -4]);
      const hand = add(elbow, [12, -14]);

      pointArm = [right, elbow, hand];
      fingertip = add(hand, [7, -7]);
      restArm = [left, add(left, [-15, 11]), add(left, [-2, 22])];
    }

    const hand = pointArm[2];
    const restHand = restArm[2];

    // Legs: standing, straight down with a slight stance and the shoes pointing outwards; hanging,
    // dangling (one a little shorter), the shoes (seen from the front) right under them; perched, like
    // standing, on the edge below.
    let leftFoot: Point = [leftHip[0] - 4, GROUND];
    let rightFoot: Point = [rightHip[0] + 4, GROUND];

    if (hanging) {
      leftFoot = [leftHip[0] + 1, HANG];
      rightFoot = [rightHip[0] - 1, HANG - 3];
    } else if (perched) {
      leftFoot = [leftHip[0] - 4, PERCH];
      rightFoot = [rightHip[0] + 4, PERCH];
    }

    const shoeShift = hanging ? 0 : 3;

    return {
      body,
      // The first subpath is the glyph's outer outline.
      backing: hanging && body.backHole ? body.d.slice(0, body.d.indexOf('Z') + 1) : null,
      viewBox: pose.viewBox,
      peek: peeking || peekPointing,
      // The hero variant stays pulled up (only the eyes move), the footer's rises on hover.
      still: peekPointing,
      // Hanging, the figure swings out around the grip; peeking and pointing, it leans in.
      lean: hanging
        ? `rotate(${LEAN} ${GRIP[0]} ${GRIP[1]})`
        : peekPointing
          ? `rotate(${PEEK_LEAN} 50 ${PEEK_EDGE})`
          : null,
      limbs: peeking
        ? []
        : peekPointing
          ? [`M${pt(pointArm[0])}L${pt(pointArm[1])}L${pt(pointArm[2])}`]
          : [
              `M${pt(pointArm[0])}L${pt(pointArm[1])}L${pt(pointArm[2])}`,
              `M${pt(restArm[0])}L${pt(restArm[1])}L${pt(restArm[2])}`,
              `M${pt(leftHip)}L${pt(leftFoot)}`,
              `M${pt(rightHip)}L${pt(rightFoot)}`,
            ],
      shoes: (peeking || peekPointing
        ? []
        : [
            [leftFoot[0] - shoeShift, leftFoot[1] + 1],
            [rightFoot[0] + shoeShift, rightFoot[1] + 1],
          ]) as Point[],
      shoeRx: hanging ? 6 : 7.5,
      hand: peeking ? null : hand,
      restHand: peeking || peekPointing ? null : restHand,
      // Peeking, the hands on the edge (across): both, or only the right one when the left points.
      edgeHands: peeking ? body.peekHands : peekPointing ? [body.peekHands[1]] : [],
      finger: fingertip ? `M${pt(hand)}L${pt(fingertip)}` : null,
      eyes: body.eyes.map(([cx, cy, r]) => {
        const pr = r * 0.48;

        return {
          cx,
          cy,
          r,
          pr,
          restX: +(Math.cos(pose.gaze) * r * GAZE_REACH).toFixed(2),
          restY: +(Math.sin(pose.gaze) * r * GAZE_REACH).toFixed(2),
          gx: cx - pr * 0.35,
          gy: cy - pr * 0.35,
          gr: pr * 0.28,
        };
      }),
    };
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.keepPageBottomWhileFooterGrows(host, zone, destroyRef);

      // The eyes follow the pointer over the area the character sits in (`section`, `footer` or
      // `[data-hero-mascot-area]`, which also makes a peeking one pull itself up), or over a wider
      // `[data-hero-mascot-track]` around it (the docs: the whole scrolling content, table of contents too).
      const hero =
        host.closest<HTMLElement>('[data-hero-mascot-track]') ??
        host.closest<HTMLElement>('section, footer, [data-hero-mascot-area]');
      // The pointer is mapped into the figure's own coordinates (the eyes' space, leaning or not).
      const figure = host.querySelector<SVGGElement>('.shared-hero-mascot__figure');
      const canTrack =
        mediaMatches('(hover: hover) and (pointer: fine)') && !mediaMatches('(prefers-reduced-motion: reduce)');

      if (!hero || !figure || !canTrack) {
        return;
      }

      let frame = 0;
      let pointer: { x: number; y: number } | null = null;

      // Each pupil moves towards the pointer, the full reach once the pointer is more than a few eye
      // radii away, less when it is right over the eye (so it never jumps across at the centre).
      const apply = () => {
        frame = 0;
        const matrix = figure.getScreenCTM()?.inverse();

        if (!pointer || !matrix) {
          return;
        }

        const target = new DOMPoint(pointer.x, pointer.y).matrixTransform(matrix);
        const eyes = this.mascot().eyes;

        host.querySelectorAll<SVGGElement>('.shared-hero-mascot__gaze').forEach((gaze, index) => {
          const eye = eyes[index];

          if (!eye) {
            return;
          }

          const dx = target.x - eye.cx;
          const dy = target.y - eye.cy;
          const distance = Math.hypot(dx, dy) || 1;
          const reach = eye.r * GAZE_REACH * Math.min(1, distance / (eye.r * 3));

          gaze.style.setProperty('--shared-hero-mascot-gaze-x', `${((dx / distance) * reach).toFixed(2)}px`);
          gaze.style.setProperty('--shared-hero-mascot-gaze-y', `${((dy / distance) * reach).toFixed(2)}px`);
        });
        host.classList.add('shared-hero-mascot--tracking');
      };

      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') {
          return;
        }

        pointer = { x: event.clientX, y: event.clientY };
        frame ||= requestAnimationFrame(apply);
      };

      // Content scrolling under a resting pointer moves the character relative to it: look again.
      const onScroll = () => {
        if (pointer) {
          frame ||= requestAnimationFrame(apply);
        }
      };

      const onLeave = () => {
        pointer = null;
        cancelAnimationFrame(frame);
        frame = 0;
        host.classList.remove('shared-hero-mascot--tracking');
        host.querySelectorAll<SVGGElement>('.shared-hero-mascot__gaze').forEach((gaze) => {
          gaze.style.removeProperty('--shared-hero-mascot-gaze-x');
          gaze.style.removeProperty('--shared-hero-mascot-gaze-y');
        });
      };

      zone.runOutsideAngular(() => {
        hero.addEventListener('pointermove', onMove, { passive: true });
        hero.addEventListener('pointerleave', onLeave, { passive: true });
        // Capturing, so a scroll inside the area (the docs' scrollport) counts as well as the page's.
        document.addEventListener('scroll', onScroll, { passive: true, capture: true });
      });

      destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        hero.removeEventListener('pointermove', onMove);
        hero.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('scroll', onScroll, { capture: true });
      });
    });
  }

  /**
   * Peeking from a footer, the character pulls itself up while the pointer is in it and the footer grows
   * with it (the landing containers pad the copyright line by as much as it rises). A reader scrolled to
   * the very bottom would see that growth open below the viewport, the risen character cut off by its
   * edge: while the footer grows (its transition, a little longer to be safe), keep them at the bottom so
   * the page scrolls along. Leaving needs nothing: the page shrinks and the browser clamps the scroll.
   */
  private keepPageBottomWhileFooterGrows(host: HTMLElement, zone: NgZone, destroyRef: DestroyRef): void {
    const footer = host.closest<HTMLElement>('footer');

    if (!footer || this.pose() !== 'peek' || !mediaMatches('(hover: hover)')) {
      return;
    }

    const scroller = document.scrollingElement ?? document.documentElement;
    let frame = 0;
    let until = 0;

    const follow = () => {
      scroller.scrollTop = scroller.scrollHeight;
      frame = performance.now() < until ? requestAnimationFrame(follow) : 0;
    };

    const onEnter = () => {
      if (Math.ceil(scroller.scrollTop + scroller.clientHeight) < scroller.scrollHeight - 2) {
        return;
      }

      until = performance.now() + 800;
      frame ||= requestAnimationFrame(follow);
    };

    zone.runOutsideAngular(() => footer.addEventListener('pointerenter', onEnter, { passive: true }));

    destroyRef.onDestroy(() => {
      cancelAnimationFrame(frame);
      footer.removeEventListener('pointerenter', onEnter);
    });
  }
}
