import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';

type Visibility = 'always' | 'monolith' | 'split' | 'observe' | 'extend';
type ServiceState = 'idle' | 'building' | 'live';
type CursorId = 'forepath' | 'team';
type CursorTarget = 'rest' | 'decision' | 'approve' | 'monolith' | 'services' | 'observability' | 'agents';

interface BoardNode {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /** Board coordinates (px) of the card's top-left corner; every card is `NODE_HEIGHT` tall. */
  x: number;
  y: number;
  width: number;
  show: Visibility;
  /** Services carry a build/deploy chip. */
  service?: boolean;
  /** Supporting detail on the right; it runs off screen in the hero, so it stays quiet. */
  muted?: boolean;
}

interface BoardEdge {
  from: string;
  to: string;
  show: Visibility;
  /** Carries traffic particles while the platform is operated. */
  traffic?: boolean;
  dashed?: boolean;
}

/** Everything that changes over the loop. Each frame only lists what differs from the one before. */
interface BoardState {
  /** Active step: Advise, Build, Operate, Extend. */
  phase: number;
  approved: boolean;
  split: boolean;
  services: ServiceState;
  observe: boolean;
  extend: boolean;
  cursors: Record<CursorId, CursorTarget>;
  click: CursorId | null;
  durationMs: number;
}

interface Point {
  x: number;
  y: number;
}

const NODE_HEIGHT = 64;
const BOARD_WIDTH = 1200;
const BOARD_HEIGHT = 664;

const PHASES = ['Advise', 'Build', 'Operate', 'Extend'];

// Everything the cursors touch sits in the left half: in the hero the board runs off the right edge.
const NODES: readonly BoardNode[] = [
  {
    id: 'users',
    icon: 'bi-people',
    title: 'Customers',
    detail: 'Web and mobile',
    x: 24,
    y: 300,
    width: 124,
    show: 'always',
  },
  {
    id: 'gateway',
    icon: 'bi-shield-lock',
    title: 'Gateway',
    detail: 'TLS, WAF',
    x: 172,
    y: 300,
    width: 136,
    show: 'always',
  },
  {
    id: 'monolith',
    icon: 'bi-box',
    title: 'Legacy monolith',
    detail: '1 release a month',
    x: 332,
    y: 300,
    width: 180,
    show: 'monolith',
  },
  {
    id: 'portal',
    icon: 'bi-window',
    title: 'Customer portal',
    detail: 'Angular',
    x: 332,
    y: 180,
    width: 180,
    show: 'split',
    service: true,
  },
  {
    id: 'billing',
    icon: 'bi-credit-card',
    title: 'Billing API',
    detail: 'Java',
    x: 332,
    y: 300,
    width: 180,
    show: 'split',
    service: true,
  },
  {
    id: 'worker',
    icon: 'bi-gear',
    title: 'Worker',
    detail: 'TypeScript',
    x: 332,
    y: 420,
    width: 180,
    show: 'split',
    service: true,
  },
  {
    id: 'observability',
    icon: 'bi-activity',
    title: 'Observability',
    detail: 'p95 182 ms, 0 alerts',
    x: 548,
    y: 150,
    width: 176,
    show: 'observe',
  },
  {
    id: 'database',
    icon: 'bi-database',
    title: 'PostgreSQL',
    detail: 'HA, tested backups',
    x: 548,
    y: 300,
    width: 176,
    show: 'always',
  },
  {
    id: 'agents',
    icon: 'bi-robot',
    title: 'Agenstra agents',
    detail: 'Guardrails, audit trail',
    x: 548,
    y: 450,
    width: 176,
    show: 'extend',
  },
  {
    id: 'backups',
    icon: 'bi-cloud-check',
    title: 'Off-site backups',
    detail: 'Restore tested weekly',
    x: 772,
    y: 228,
    width: 180,
    show: 'always',
    muted: true,
  },
  {
    id: 'oncall',
    icon: 'bi-telephone',
    title: 'On-call',
    detail: 'Runbooks, 24/7',
    x: 772,
    y: 380,
    width: 180,
    show: 'always',
    muted: true,
  },
  {
    id: 'region',
    icon: 'bi-globe2',
    title: 'Second region',
    detail: 'Planned for Q3',
    x: 1000,
    y: 300,
    width: 170,
    show: 'always',
    muted: true,
  },
];

const EDGES: readonly BoardEdge[] = [
  { from: 'users', to: 'gateway', show: 'always', traffic: true },
  { from: 'gateway', to: 'monolith', show: 'monolith' },
  { from: 'monolith', to: 'database', show: 'monolith' },
  { from: 'gateway', to: 'portal', show: 'split', traffic: true },
  { from: 'gateway', to: 'billing', show: 'split', traffic: true },
  { from: 'gateway', to: 'worker', show: 'split' },
  { from: 'portal', to: 'database', show: 'split' },
  { from: 'billing', to: 'database', show: 'split', traffic: true },
  { from: 'worker', to: 'database', show: 'split' },
  { from: 'portal', to: 'observability', show: 'observe', dashed: true },
  { from: 'billing', to: 'observability', show: 'observe', dashed: true },
  { from: 'worker', to: 'agents', show: 'extend', traffic: true },
  { from: 'database', to: 'backups', show: 'always', dashed: true },
  { from: 'backups', to: 'region', show: 'always', dashed: true },
  { from: 'database', to: 'oncall', show: 'always', dashed: true },
];

/** Cursor tip positions on the board. */
const TARGETS: Record<CursorTarget | 'teamRest', Point> = {
  rest: { x: 300, y: 590 },
  teamRest: { x: 110, y: 612 },
  decision: { x: 170, y: 118 },
  approve: { x: 252, y: 179 },
  monolith: { x: 430, y: 334 },
  services: { x: 440, y: 214 },
  observability: { x: 640, y: 184 },
  agents: { x: 640, y: 484 },
};

const INITIAL: BoardState = {
  phase: 0,
  approved: false,
  split: false,
  services: 'idle',
  observe: false,
  extend: false,
  cursors: { forepath: 'rest', team: 'rest' },
  click: null,
  durationMs: 1500,
};

/**
 * The loop: ForePath proposes splitting the monolith and your team approves it (Advise), the
 * services are built and go live (Build), traffic flows and is observed (Operate), and Agenstra
 * agents join the platform (Extend). Then the board resets. The first frame is the prerendered one.
 */
const FRAMES: readonly BoardState[] = buildFrames([
  {},
  { cursors: { forepath: 'decision', team: 'rest' }, durationMs: 1100 },
  { cursors: { forepath: 'decision', team: 'approve' }, durationMs: 1000 },
  { approved: true, click: 'team', durationMs: 1100 },
  { cursors: { forepath: 'monolith', team: 'rest' }, durationMs: 1000 },
  { split: true, click: 'forepath', durationMs: 1300 },
  { phase: 1, services: 'building', cursors: { forepath: 'services', team: 'rest' }, durationMs: 1600 },
  { services: 'live', durationMs: 1200 },
  { phase: 2, observe: true, cursors: { forepath: 'services', team: 'observability' }, durationMs: 2400 },
  { phase: 3, cursors: { forepath: 'agents', team: 'observability' }, durationMs: 1000 },
  { extend: true, click: 'forepath', durationMs: 1400 },
  { cursors: { forepath: 'rest', team: 'rest' }, durationMs: 2800 },
]);

/** Shown without animation (reduced motion): the finished, operated and extended platform. */
const STATIC_FRAME = FRAMES.length - 1;

/**
 * Hero scene for ForePath: your team's architecture board, shared with ForePath. Two live cursors
 * take a legacy platform through Advise, Build, Operate and Extend. It shows ForePath working inside
 * your environment next to your people, rather than a ForePath product.
 */
@Component({
  selector: 'framework-forepath-platform-board-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration
      [label]="label()"
      address="architecture.your-company.com/platform-2027"
      [width]="boardWidth"
      [height]="boardHeight + 56"
    >
      <section class="sai-col sai-col--grow board">
        <header class="board__toolbar">
          <ol class="board__phases list-unstyled mb-0">
            @for (phase of phases; track phase; let index = $index) {
              <li
                class="board__phase"
                [class.board__phase--done]="index < state().phase"
                [class.board__phase--active]="index === state().phase"
              >
                <span class="board__phase-dot">
                  @if (index < state().phase) {
                    <i class="bi bi-check-lg"></i>
                  } @else {
                    {{ index + 1 }}
                  }
                </span>
                {{ phase }}
              </li>
            }
          </ol>
          <span class="board__presence">
            <span class="board__person board__person--forepath"><i></i>ForePath</span>
            <span class="board__person board__person--team"><i></i>Your team</span>
          </span>
        </header>

        <div class="board__canvas">
          <svg class="board__edges" [attr.viewBox]="'0 0 ' + boardWidth + ' ' + boardHeight">
            @for (edge of edges; track edge.id) {
              <path
                class="board__edge"
                [class.board__edge--dashed]="edge.dashed"
                [class.board__edge--visible]="isVisible(edge.show)"
                [class.board__edge--live]="state().observe && edge.traffic"
                [attr.d]="edge.path"
                pathLength="1"
              />
            }
          </svg>

          @if (state().observe) {
            @for (edge of trafficEdges; track edge.id) {
              @if (isVisible(edge.show)) {
                @for (delay of particleDelays; track delay) {
                  <i class="board__particle" [style.offset-path]="edge.offsetPath" [style.animation-delay]="delay"></i>
                }
              }
            }
          }

          <article class="board__decision" [class.board__decision--approved]="state().approved">
            <span class="board__decision-head">
              <i class="bi bi-journal-check"></i>
              <span class="fw-semibold">ADR-014 · Split the monolith</span>
            </span>
            <span class="small text-body-secondary">
              Release portal, billing and worker on their own. No more release-day downtime.
            </span>
            <span class="board__decision-foot">
              <span class="small text-body-secondary">Proposed by ForePath</span>
              @if (state().approved) {
                <span class="board__approved"><i class="bi bi-check-circle-fill"></i>Approved</span>
              } @else {
                <span class="board__approve" [class.board__approve--hover]="state().cursors.team === 'approve'">
                  Approve
                </span>
              }
            </span>
          </article>

          @for (node of nodes; track node.id) {
            <div
              class="board__node"
              [class.board__node--muted]="node.muted"
              [class.board__node--hidden]="!isVisible(node.show)"
              [class.board__node--pop]="node.id === 'agents'"
              [class.board__node--watched]="node.id === 'observability' && state().cursors.team === 'observability'"
              [style.left.px]="node.x"
              [style.top.px]="node.y"
              [style.width.px]="node.width"
              [style.--board-node-collapse]="(node.service ? 300 - node.y : 0) + 'px'"
            >
              <span class="board__node-icon"><i class="bi" [class]="node.icon"></i></span>
              <span class="board__node-text">
                <span class="board__node-title">{{ node.title }}</span>
                <span class="board__node-detail">{{ node.detail }}</span>
              </span>
              @if (node.service && state().services !== 'idle') {
                <span class="board__chip" [class.board__chip--live]="state().services === 'live'">
                  <i class="bi" [class]="state().services === 'live' ? 'bi-circle-fill' : 'bi-arrow-repeat'"></i>
                  {{ state().services === 'live' ? 'Live' : 'Building' }}
                </span>
              }
            </div>
          }

          @for (cursor of cursors(); track cursor.id) {
            <span
              class="board__cursor"
              [class]="'board__cursor--' + cursor.id"
              [class.board__cursor--click]="state().click === cursor.id"
              [style.transform]="'translate(' + cursor.point.x + 'px, ' + cursor.point.y + 'px)'"
            >
              <span class="board__ripple"></span>
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M4 2.5 L4 19.5 L8.6 15.4 L11.7 22 L14.6 20.7 L11.6 14.2 L17.8 14.2 Z" />
              </svg>
              <span class="board__cursor-label">{{ cursor.label }}</span>
            </span>
          }
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .board {
        --board-forepath: var(--bs-primary);
        --board-team: #3fb6d9;
      }

      .board__toolbar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 2rem;
        height: 3.5rem;
        padding: 0 1.5rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .board__phases {
        display: flex;
        gap: 1.25rem;
        font-size: 0.8125rem;
        color: var(--bs-secondary-color);
      }

      .board__phase {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        transition: color 0.3s ease;
      }

      .board__phase-dot {
        display: grid;
        place-items: center;
        width: 1.375rem;
        height: 1.375rem;
        font-size: 0.6875rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 50%;
        transition:
          color 0.3s ease,
          background-color 0.3s ease,
          border-color 0.3s ease;
      }

      .board__phase--active {
        color: var(--bs-body-color);
        font-weight: 600;

        .board__phase-dot {
          color: var(--bs-primary);
          border-color: var(--bs-primary);
        }
      }

      .board__phase--done .board__phase-dot {
        color: #fff;
        background-color: var(--bs-primary);
        border-color: var(--bs-primary);
      }

      .board__presence {
        display: flex;
        gap: 0.5rem;
        margin-left: auto;
      }

      .board__person {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 50rem;

        i {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
        }
      }

      .board__person--forepath i {
        background-color: var(--board-forepath);
      }

      .board__person--team i {
        background-color: var(--board-team);
      }

      // Dotted whiteboard; nodes, edges, particles and cursors share its pixel coordinates.
      .board__canvas {
        position: relative;
        flex: 1 1 auto;
        overflow: hidden;
        background-image: radial-gradient(
          circle,
          color-mix(in srgb, var(--bs-body-color) 12%, transparent) 1px,
          transparent 1.5px
        );
        background-size: 24px 24px;
      }

      .board__edges {
        position: absolute;
        top: 0;
        left: 0;
        width: 1200px;
        height: 664px;
        overflow: visible;
      }

      // Edges draw themselves in when they appear (dash offset over the normalised path length).
      .board__edge {
        fill: none;
        stroke: color-mix(in srgb, var(--bs-body-color) 28%, transparent);
        stroke-width: 1.5;
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        transition:
          stroke-dashoffset 0.8s ease,
          stroke 0.4s ease;
      }

      .board__edge--visible {
        stroke-dashoffset: 0;
      }

      .board__edge--dashed {
        stroke-dasharray: 0.012 0.012;
        opacity: 0;
        transition: opacity 0.6s ease;

        &.board__edge--visible {
          opacity: 1;
        }
      }

      .board__edge--live {
        stroke: color-mix(in srgb, var(--bs-primary) 55%, transparent);
      }

      .board__particle {
        position: absolute;
        top: 0;
        left: 0;
        width: 0.4375rem;
        height: 0.4375rem;
        background-color: var(--bs-primary);
        border-radius: 50%;
        box-shadow: 0 0 0.625rem var(--bs-primary);
        offset-rotate: 0deg;
        animation: board-flow 2.4s linear infinite both;
      }

      .board__decision {
        position: absolute;
        top: 80px;
        left: 24px;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        width: 280px;
        height: 124px;
        padding: 0.75rem 0.875rem;
        font-size: 0.875rem;
        background-color: var(--bs-body-bg);
        border: var(--bs-border-width) solid color-mix(in srgb, var(--board-forepath) 55%, var(--bs-border-color));
        border-radius: 0.5rem;
        box-shadow: 0 0.75rem 1.5rem -1rem rgb(0 0 0 / 0.6);
        transition: border-color 0.4s ease;

        .small {
          line-height: 1.35;
        }
      }

      .board__decision--approved {
        border-color: color-mix(in srgb, var(--bs-success) 60%, var(--bs-border-color));
      }

      .board__decision-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;

        .bi {
          color: var(--board-forepath);
        }
      }

      .board__decision-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: auto;
      }

      .board__approve {
        display: grid;
        place-items: center;
        width: 72px;
        height: 26px;
        font-size: 0.75rem;
        font-weight: 600;
        color: #0b1f26;
        background-color: var(--board-team);
        border-radius: 0.375rem;
        transition: filter 0.2s ease;
      }

      .board__approve--hover {
        filter: brightness(1.15);
      }

      .board__approved {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        height: 26px;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-success);
        animation: board-pop 0.4s ease;
      }

      .board__node {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        height: 64px;
        padding: 0 0.75rem;
        background-color: var(--bs-body-bg);
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
        box-shadow: 0 0.75rem 1.5rem -1rem rgb(0 0 0 / 0.6);
        transition:
          transform 0.7s cubic-bezier(0.34, 1.3, 0.64, 1),
          opacity 0.5s ease,
          border-color 0.3s ease;
      }

      // Hidden services sit folded into the monolith's spot, so splitting fans them out from it.
      .board__node--hidden {
        opacity: 0;
        transform: translateY(var(--board-node-collapse, 0)) scale(0.92);
      }

      .board__node--pop.board__node--hidden {
        transform: scale(0.6);
      }

      .board__node--muted {
        opacity: 0.55;
      }

      .board__node--watched {
        border-color: var(--board-team);
      }

      .board__node-icon {
        display: grid;
        flex: 0 0 auto;
        place-items: center;
        width: 2rem;
        height: 2rem;
        color: var(--bs-primary);
        background-color: color-mix(in srgb, var(--bs-primary) 12%, transparent);
        border-radius: 0.375rem;
      }

      .board__node-text {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
      }

      .board__node-title {
        overflow: hidden;
        font-size: 0.8125rem;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .board__node-detail {
        overflow: hidden;
        font-size: 0.6875rem;
        color: var(--bs-secondary-color);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .board__chip {
        position: absolute;
        top: -0.625rem;
        right: 0.625rem;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.0625rem 0.5rem;
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--bs-primary);
        background-color: var(--bs-body-bg);
        border: var(--bs-border-width) solid currentColor;
        border-radius: 50rem;
        animation: board-pop 0.4s ease;

        .bi-arrow-repeat {
          animation: board-spin 1s linear infinite;
        }

        .bi-circle-fill {
          font-size: 0.375rem;
        }
      }

      .board__chip--live {
        color: var(--bs-success);
      }

      .board__cursor {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 3;
        transition: transform 0.9s cubic-bezier(0.45, 0, 0.2, 1);
        filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));

        svg {
          display: block;
          fill: var(--board-cursor);
          stroke: #fff;
          stroke-width: 1.25;
          stroke-linejoin: round;
        }
      }

      .board__cursor--forepath {
        --board-cursor: var(--board-forepath);
      }

      .board__cursor--team {
        --board-cursor: var(--board-team);
      }

      .board__cursor-label {
        position: absolute;
        top: 1.25rem;
        left: 1rem;
        padding: 0.125rem 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        background-color: var(--board-cursor);
        border-radius: 0.25rem 0.5rem 0.5rem;
      }

      .board__cursor--team .board__cursor-label {
        color: #0b1f26;
      }

      .board__ripple {
        position: absolute;
        top: 3px;
        left: 4px;
        width: 2rem;
        height: 2rem;
        margin: -1rem 0 0 -1rem;
        border: 2px solid var(--board-cursor);
        border-radius: 50%;
        opacity: 0;
      }

      .board__cursor--click {
        svg {
          animation: board-press 0.35s ease 0.1s;
        }

        .board__ripple {
          animation: board-ripple 0.6s ease-out 0.1s;
        }
      }

      @keyframes board-flow {
        from {
          offset-distance: 0%;
          opacity: 0;
        }

        10%,
        90% {
          opacity: 1;
        }

        to {
          offset-distance: 100%;
          opacity: 0;
        }
      }

      @keyframes board-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes board-pop {
        from {
          opacity: 0;
          transform: scale(0.8);
        }
      }

      @keyframes board-press {
        50% {
          transform: scale(0.9);
        }
      }

      @keyframes board-ripple {
        from {
          opacity: 0.9;
          transform: scale(0.3);
        }

        to {
          opacity: 0;
          transform: scale(1.6);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .board__edge,
        .board__node,
        .board__cursor,
        .board__cursor svg,
        .board__ripple,
        .board__chip,
        .board__chip .bi,
        .board__approved {
          animation: none;
          transition: none;
        }

        .board__particle {
          display: none;
        }
      }
    `,
  ],
})
export class PlatformBoardIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly boardWidth = BOARD_WIDTH;
  protected readonly boardHeight = BOARD_HEIGHT;
  protected readonly phases = PHASES;
  protected readonly nodes = NODES;
  protected readonly edges = EDGES.map((edge) => {
    const path = edgePath(edge);

    return { ...edge, id: `${edge.from}-${edge.to}`, path, offsetPath: `path('${path}')` };
  });
  protected readonly trafficEdges = this.edges.filter((edge) => edge.traffic);
  protected readonly particleDelays = ['0s', '-0.8s', '-1.6s'];

  private readonly frameIndex = signal(0);

  protected readonly state = computed(() => FRAMES[this.frameIndex()]);
  protected readonly cursors = computed(() => {
    const { cursors } = this.state();

    return [
      {
        id: 'team' as const,
        label: 'Your team',
        point: tipOffset(TARGETS[cursors.team === 'rest' ? 'teamRest' : cursors.team]),
      },
      { id: 'forepath' as const, label: 'ForePath', point: tipOffset(TARGETS[cursors.forepath]) },
    ];
  });

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    inject(DestroyRef).onDestroy(() => clearTimeout(timer));

    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.frameIndex.set(STATIC_FRAME);

        return;
      }

      const advance = () => {
        timer = setTimeout(() => {
          this.frameIndex.update((index) => (index + 1) % FRAMES.length);
          advance();
        }, this.state().durationMs);
      };

      advance();
    });
  }

  protected isVisible(show: Visibility): boolean {
    const state = this.state();

    switch (show) {
      case 'monolith':
        return !state.split;
      case 'split':
        return state.split;
      case 'observe':
        return state.observe;
      case 'extend':
        return state.extend;
      default:
        return true;
    }
  }
}

/** Fills in every frame from the one before, so the timeline only lists changes. */
function buildFrames(steps: readonly Partial<BoardState>[]): BoardState[] {
  const frames: BoardState[] = [];

  steps.reduce<BoardState>((previous, step) => {
    const frame = { ...previous, click: null, durationMs: INITIAL.durationMs, ...step };

    frames.push(frame);

    return frame;
  }, INITIAL);

  return frames;
}

/** Curve from the right edge of one card to the left edge of the next, in board pixels. */
function edgePath(edge: BoardEdge): string {
  const from = NODES.find((node) => node.id === edge.from);
  const to = NODES.find((node) => node.id === edge.to);

  if (!from || !to) {
    return '';
  }

  const start = { x: from.x + from.width, y: from.y + NODE_HEIGHT / 2 };
  const end = { x: to.x, y: to.y + NODE_HEIGHT / 2 };
  const bend = Math.max(24, (end.x - start.x) / 2);

  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

/** The arrow's tip sits a few pixels into its box. */
function tipOffset(point: Point): Point {
  return { x: point.x - 4, y: point.y - 3 };
}
