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

type Visibility = 'always' | 'guard' | 'worker';
type Tone = 'primary' | 'success' | 'warning' | 'danger';

interface ArchNode {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /** Scene coordinates (px) of the card's top-left corner; every card is `NODE_HEIGHT` tall. */
  x: number;
  y: number;
  width: number;
  show: Visibility;
  /** Second environment: context only, it stays quiet. */
  muted?: boolean;
}

interface ArchEdge {
  from: string;
  to: string;
  show: Visibility;
  /** Straight line between the cards' top and bottom edges instead of a curve between their sides. */
  vertical?: boolean;
  dashed?: boolean;
}

interface ArchFrame {
  id: string;
  label: string;
  badge: string;
  badgeIcon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  show: Visibility;
  muted?: boolean;
}

/** A dot travelling along one edge during a frame. */
interface Pulse {
  edge: string;
  reverse?: boolean;
  tone?: Tone;
  delayMs?: number;
}

/** Everything that changes over the loop. Each frame only lists what differs from the one before. */
interface FlowState {
  /** Active step: Sign in, Provision, Prompt, Egress, Audit. */
  phase: number;
  bubble: 'none' | 'prompt' | 'reply';
  identity: boolean;
  probe: boolean;
  guard: 'hidden' | 'lockdown' | 'enforcing';
  worker: 'hidden' | 'starting' | 'running';
  filter: boolean;
  allowed: boolean;
  blocked: boolean;
  audit: number;
  pulses: readonly Pulse[];
  durationMs: number;
}

interface Chip {
  text: string;
  icon: string;
  tone: Tone;
  spin?: boolean;
}

const NODE_HEIGHT = 64;
const SCENE_WIDTH = 1200;
const SCENE_HEIGHT = 600;

const PHASES = ['Sign in', 'Provision', 'Prompt', 'Egress', 'Audit'];

const COLUMNS = [
  { label: 'Your team', x: 20 },
  { label: 'Control plane', x: 212 },
  { label: 'Internet', x: 1016 },
];

const FRAMES_LAYOUT: readonly ArchFrame[] = [
  {
    id: 'host',
    label: 'Your host',
    badge: 'Docker',
    badgeIcon: 'bi-hdd-stack',
    x: 420,
    y: 48,
    width: 580,
    height: 520,
    show: 'always',
  },
  {
    id: 'env-api',
    label: 'platform-api',
    badge: 'Sandboxed',
    badgeIcon: 'bi-shield-fill-check',
    x: 632,
    y: 176,
    width: 356,
    height: 200,
    show: 'guard',
  },
  {
    id: 'env-web',
    label: 'web-app',
    badge: 'Standard',
    badgeIcon: 'bi-box',
    x: 632,
    y: 400,
    width: 356,
    height: 148,
    show: 'always',
    muted: true,
  },
];

const NODES: readonly ArchNode[] = [
  {
    id: 'console',
    icon: 'bi-window',
    title: 'Web console',
    detail: 'Chat, files, Git',
    x: 20,
    y: 152,
    width: 164,
    show: 'always',
  },
  {
    id: 'desktop',
    icon: 'bi-display',
    title: 'Desktop app',
    detail: 'Windows, Linux',
    x: 20,
    y: 268,
    width: 164,
    show: 'always',
  },
  {
    id: 'api',
    icon: 'bi-braces',
    title: 'API & tickets',
    detail: 'Tokens, webhooks',
    x: 20,
    y: 384,
    width: 164,
    show: 'always',
  },
  {
    id: 'identity',
    icon: 'bi-person-badge',
    title: 'Identity',
    detail: 'SSO, roles',
    x: 212,
    y: 112,
    width: 184,
    show: 'always',
  },
  {
    id: 'controller',
    icon: 'bi-diagram-3',
    title: 'Agent controller',
    detail: 'Policy, routing',
    x: 212,
    y: 268,
    width: 184,
    show: 'always',
  },
  {
    id: 'audit',
    icon: 'bi-journal-check',
    title: 'Audit log',
    detail: 'PostgreSQL',
    x: 212,
    y: 424,
    width: 184,
    show: 'always',
  },
  {
    id: 'manager',
    icon: 'bi-hdd-network',
    title: 'Agent manager',
    detail: 'Container, probes',
    x: 440,
    y: 268,
    width: 172,
    show: 'always',
  },
  {
    id: 'worker',
    icon: 'bi-robot',
    title: 'Agent worker',
    detail: 'gVisor runtime',
    x: 648,
    y: 268,
    width: 160,
    show: 'worker',
  },
  {
    id: 'guard',
    icon: 'bi-shield-lock',
    title: 'Egress guard',
    detail: 'Squid, dnsmasq',
    x: 820,
    y: 268,
    width: 160,
    show: 'guard',
  },
  {
    id: 'worker-web',
    icon: 'bi-robot',
    title: 'Agent worker',
    detail: 'runc runtime',
    x: 648,
    y: 456,
    width: 160,
    show: 'always',
    muted: true,
  },
  {
    id: 'guard-web',
    icon: 'bi-shield-lock',
    title: 'Egress guard',
    detail: 'Monitor mode',
    x: 820,
    y: 456,
    width: 160,
    show: 'always',
    muted: true,
  },
  {
    id: 'npm',
    icon: 'bi-box-seam',
    title: 'npmjs.org',
    detail: 'Allowlisted',
    x: 1016,
    y: 160,
    width: 168,
    show: 'always',
  },
  {
    id: 'github',
    icon: 'bi-github',
    title: 'github.com',
    detail: 'Allowlisted',
    x: 1016,
    y: 268,
    width: 168,
    show: 'always',
  },
  {
    id: 'paste',
    icon: 'bi-globe2',
    title: 'paste.example',
    detail: 'Not on the list',
    x: 1016,
    y: 376,
    width: 168,
    show: 'always',
  },
];

const EDGES: readonly ArchEdge[] = [
  { from: 'console', to: 'controller', show: 'always' },
  { from: 'desktop', to: 'controller', show: 'always', dashed: true },
  { from: 'api', to: 'controller', show: 'always', dashed: true },
  { from: 'controller', to: 'identity', show: 'always', vertical: true },
  { from: 'controller', to: 'audit', show: 'always', vertical: true },
  { from: 'controller', to: 'manager', show: 'always' },
  { from: 'manager', to: 'worker', show: 'worker' },
  { from: 'worker', to: 'guard', show: 'worker' },
  { from: 'manager', to: 'worker-web', show: 'always', dashed: true },
  { from: 'worker-web', to: 'guard-web', show: 'always', dashed: true },
  { from: 'guard', to: 'npm', show: 'guard' },
  { from: 'guard', to: 'github', show: 'guard' },
  { from: 'guard', to: 'paste', show: 'guard' },
];

const INITIAL: FlowState = {
  phase: 0,
  bubble: 'none',
  identity: false,
  probe: false,
  guard: 'hidden',
  worker: 'hidden',
  filter: false,
  allowed: false,
  blocked: false,
  audit: 0,
  pulses: [],
  durationMs: 1000,
};

/**
 * The loop: a developer signs in through the console (Sign in), the controller asks the host's agent
 * manager for an environment, which probes gVisor, locks the network down behind a new egress guard and
 * starts the worker in the sandbox (Provision). A prompt passes the message filters on its way to the
 * worker, checked by the manager (Prompt), the worker's outbound requests are allowed or blocked by the guard (Egress) and the
 * decisions land in the audit log before the reply comes back (Audit). Then the scene resets. The
 * first frame is the prerendered one.
 */
const FRAMES: readonly FlowState[] = buildFrames([
  { durationMs: 1200 },
  { pulses: [{ edge: 'console-controller' }], durationMs: 1000 },
  { pulses: [{ edge: 'controller-identity' }], durationMs: 900 },
  { identity: true, durationMs: 900 },
  { phase: 1, pulses: [{ edge: 'controller-manager' }], durationMs: 1000 },
  { probe: true, durationMs: 1000 },
  { guard: 'lockdown', durationMs: 1200 },
  { guard: 'enforcing', durationMs: 900 },
  { worker: 'starting', durationMs: 1300 },
  { worker: 'running', durationMs: 900 },
  { phase: 2, bubble: 'prompt', pulses: [{ edge: 'console-controller' }], durationMs: 1200 },
  { pulses: [{ edge: 'controller-manager' }], durationMs: 1000 },
  { filter: true, pulses: [{ edge: 'manager-worker', delayMs: 300 }], durationMs: 1300 },
  {
    phase: 3,
    pulses: [{ edge: 'worker-guard' }, { edge: 'guard-npm', tone: 'success', delayMs: 800 }],
    durationMs: 1700,
  },
  { allowed: true, durationMs: 600 },
  {
    pulses: [{ edge: 'worker-guard' }, { edge: 'guard-paste', tone: 'danger', delayMs: 800 }],
    durationMs: 1700,
  },
  { blocked: true, durationMs: 900 },
  {
    phase: 4,
    pulses: [
      { edge: 'controller-manager', reverse: true },
      { edge: 'controller-audit', delayMs: 800 },
    ],
    durationMs: 1800,
  },
  { audit: 2, durationMs: 800 },
  { bubble: 'reply', pulses: [{ edge: 'console-controller', reverse: true }], durationMs: 1400 },
  { durationMs: 3200 },
]);

/** Shown without animation (reduced motion): the whole round trip, finished. */
const STATIC_FRAME = FRAMES.length - 1;

/**
 * "How it works" scene for Agenstra: every component on one board, from the console through the
 * control plane to a host running a sandboxed agent behind its egress guard. A request travels the
 * whole path, so the scene shows how the parts interact rather than what any one screen looks like.
 */
@Component({
  selector: 'framework-portal-architecture-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration
      [label]="label()"
      windowTitle="Agenstra, end to end"
      [width]="sceneWidth"
      [height]="sceneHeight + 56"
    >
      <section class="sai-col sai-col--grow arch">
        <header class="arch__toolbar">
          <ol class="arch__phases list-unstyled mb-0">
            @for (phase of phases; track phase; let index = $index) {
              <li
                class="arch__phase"
                [class.arch__phase--done]="index < state().phase"
                [class.arch__phase--active]="index === state().phase"
              >
                <span class="arch__phase-dot">
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
          <span class="arch__legend">
            <span class="arch__legend-item arch__legend-item--primary"><i></i>Request</span>
            <span class="arch__legend-item arch__legend-item--success"><i></i>Allowed</span>
            <span class="arch__legend-item arch__legend-item--danger"><i></i>Blocked</span>
          </span>
        </header>

        <div class="arch__canvas">
          @for (column of columns; track column.label) {
            <span class="arch__caption" [style.left.px]="column.x">{{ column.label }}</span>
          }

          @for (frame of frames; track frame.id) {
            <div
              class="arch__frame"
              [class.arch__frame--host]="frame.id === 'host'"
              [class.arch__frame--muted]="frame.muted"
              [class.arch__frame--hidden]="!isVisible(frame.show)"
              [style.left.px]="frame.x"
              [style.top.px]="frame.y"
              [style.width.px]="frame.width"
              [style.height.px]="frame.height"
            >
              <span class="arch__frame-label">
                {{ frame.label }}
                @if (frame.id !== 'host' || state().probe) {
                  <span class="arch__frame-badge" [class.arch__frame-badge--sandboxed]="frame.id === 'env-api'">
                    <i class="bi" [class]="frame.badgeIcon"></i
                    >{{ frame.id === 'host' ? 'Docker + gVisor' : frame.badge }}
                  </span>
                } @else {
                  <span class="arch__frame-badge"><i class="bi" [class]="frame.badgeIcon"></i>{{ frame.badge }}</span>
                }
              </span>
            </div>
          }

          <svg class="arch__edges" [attr.viewBox]="'0 0 ' + sceneWidth + ' ' + sceneHeight">
            @for (edge of edges; track edge.id) {
              <path
                class="arch__edge"
                [class.arch__edge--dashed]="edge.dashed"
                [class.arch__edge--visible]="isVisible(edge.show)"
                [class.arch__edge--active]="activeEdges().has(edge.id)"
                [class.arch__edge--allowed]="edge.id === 'guard-npm' && state().allowed"
                [class.arch__edge--blocked]="edge.id === 'guard-paste' && state().blocked"
                [attr.d]="edge.path"
                pathLength="1"
              />
            }
          </svg>

          @for (pulse of pulses(); track pulse.key) {
            <i
              class="arch__pulse"
              [class]="'arch__pulse--' + pulse.tone"
              [class.arch__pulse--reverse]="pulse.reverse"
              [style.offset-path]="pulse.offsetPath"
              [style.animation-delay]="pulse.delay"
            ></i>
          }

          @if (state().bubble !== 'none') {
            <div
              class="arch__bubble sai-bubble"
              [class.sai-bubble--user]="state().bubble === 'prompt'"
              [class.sai-bubble--agent]="state().bubble === 'reply'"
            >
              @if (state().bubble === 'prompt') {
                Add rate limiting to /login
              } @else {
                <i class="bi bi-git me-1 text-primary"></i>Done, PR #142 is ready for review
              }
            </div>
          }

          @for (node of nodes; track node.id) {
            <div
              class="arch__node"
              [class.arch__node--muted]="node.muted"
              [class.arch__node--hidden]="!isVisible(node.show)"
              [class.arch__node--blocked]="node.id === 'paste' && state().blocked"
              [style.left.px]="node.x"
              [style.top.px]="node.y"
              [style.width.px]="node.width"
            >
              <span class="arch__node-icon"><i class="bi" [class]="node.icon"></i></span>
              <span class="arch__node-text">
                <span class="arch__node-title">{{ node.title }}</span>
                <span class="arch__node-detail">{{ node.detail }}</span>
              </span>
              @if (chips()[node.id]; as chip) {
                <span class="arch__chip" [class]="'arch__chip--' + chip.tone">
                  <i class="bi" [class]="chip.icon" [class.arch__spin]="chip.spin"></i>
                  {{ chip.text }}
                </span>
              }
            </div>
          }
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .arch__toolbar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 2rem;
        height: 3.5rem;
        padding: 0 1.5rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .arch__phases {
        display: flex;
        gap: 1.25rem;
        font-size: 0.8125rem;
        color: var(--bs-secondary-color);
      }

      .arch__phase {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        transition: color 0.3s ease;
      }

      .arch__phase-dot {
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

      .arch__phase--active {
        color: var(--bs-body-color);
        font-weight: 600;

        .arch__phase-dot {
          color: var(--bs-primary);
          border-color: var(--bs-primary);
        }
      }

      .arch__phase--done .arch__phase-dot {
        color: #fff;
        background-color: var(--bs-primary);
        border-color: var(--bs-primary);
      }

      .arch__legend {
        display: flex;
        gap: 1rem;
        margin-left: auto;
        font-size: 0.75rem;
        color: var(--bs-secondary-color);
      }

      .arch__legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;

        i {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background-color: var(--arch-tone);
        }
      }

      .arch__legend-item--primary {
        --arch-tone: var(--bs-primary);
      }

      .arch__legend-item--success {
        --arch-tone: var(--bs-success);
      }

      .arch__legend-item--danger {
        --arch-tone: var(--bs-danger);
      }

      // Dotted board; frames, nodes, edges and pulses share its pixel coordinates.
      .arch__canvas {
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

      .arch__caption {
        position: absolute;
        top: 16px;
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--bs-secondary-color);
      }

      // Boundaries: the host and the environments on it.
      .arch__frame {
        position: absolute;
        border: var(--bs-border-width) dashed color-mix(in srgb, var(--bs-body-color) 24%, transparent);
        border-radius: 0.75rem;
        transition:
          opacity 0.5s ease,
          transform 0.6s cubic-bezier(0.34, 1.3, 0.64, 1),
          border-color 0.4s ease;
      }

      .arch__frame--host {
        background-color: color-mix(in srgb, var(--bs-body-color) 3%, transparent);
        border-style: solid;
        border-color: var(--bs-border-color);
      }

      .arch__frame:not(.arch__frame--host):not(.arch__frame--muted) {
        background-color: color-mix(in srgb, var(--bs-primary) 6%, transparent);
        border-color: color-mix(in srgb, var(--bs-primary) 55%, transparent);
      }

      .arch__frame--muted {
        opacity: 0.55;
      }

      .arch__frame--hidden {
        opacity: 0;
        transform: scale(0.96);
      }

      .arch__frame-label {
        position: absolute;
        top: 0.625rem;
        left: 0.875rem;
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        font-family: var(--bs-font-monospace);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-secondary-color);
      }

      .arch__frame-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.0625rem 0.5rem;
        font-family: var(--bs-body-font-family);
        font-size: 0.625rem;
        font-weight: 600;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 50rem;
        animation: arch-pop 0.4s ease;
      }

      .arch__frame-badge--sandboxed {
        color: var(--bs-primary);
        border-color: currentColor;
      }

      .arch__edges {
        position: absolute;
        top: 0;
        left: 0;
        width: 1200px;
        height: 600px;
        overflow: visible;
      }

      // Edges draw themselves in when they appear (dash offset over the normalised path length).
      .arch__edge {
        fill: none;
        stroke: color-mix(in srgb, var(--bs-body-color) 28%, transparent);
        stroke-width: 1.5;
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        opacity: 0;
        transition:
          stroke-dashoffset 0.8s ease,
          stroke 0.4s ease,
          opacity 0.3s ease;
      }

      .arch__edge--visible {
        stroke-dashoffset: 0;
        opacity: 1;
      }

      .arch__edge--dashed {
        stroke-dasharray: 0.012 0.012;
        opacity: 0;
        transition: opacity 0.6s ease;

        &.arch__edge--visible {
          opacity: 0.6;
        }
      }

      .arch__edge--active {
        stroke: color-mix(in srgb, var(--bs-primary) 70%, transparent);
      }

      .arch__edge--allowed {
        stroke: color-mix(in srgb, var(--bs-success) 70%, transparent);
      }

      .arch__edge--blocked {
        stroke: color-mix(in srgb, var(--bs-danger) 70%, transparent);
        stroke-dasharray: 0.02 0.02;
      }

      .arch__pulse {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        width: 0.625rem;
        height: 0.625rem;
        background-color: var(--arch-tone);
        border-radius: 50%;
        box-shadow: 0 0 0.75rem var(--arch-tone);
        offset-rotate: 0deg;
        opacity: 0;
        animation: arch-flow 0.8s cubic-bezier(0.45, 0, 0.2, 1) both;
      }

      .arch__pulse--reverse {
        animation-direction: reverse;
      }

      .arch__pulse--primary {
        --arch-tone: var(--bs-primary);
      }

      .arch__pulse--success {
        --arch-tone: var(--bs-success);
      }

      // A blocked request stops short of its destination.
      .arch__pulse--danger {
        --arch-tone: var(--bs-danger);
        animation-name: arch-flow-blocked;
      }

      .arch__bubble {
        position: absolute;
        top: 52px;
        left: 24px;
        z-index: 3;
        max-width: 22rem;
        font-size: 0.8125rem;
        white-space: nowrap;
        box-shadow: 0 0.75rem 1.5rem -1rem rgb(0 0 0 / 0.6);
        animation: arch-pop 0.4s ease;
      }

      .arch__node {
        position: absolute;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        height: 64px;
        padding: 0 0.625rem;
        background-color: var(--bs-body-bg);
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
        box-shadow: 0 0.75rem 1.5rem -1rem rgb(0 0 0 / 0.6);
        transition:
          transform 0.7s cubic-bezier(0.34, 1.3, 0.64, 1),
          opacity 0.5s ease,
          border-color 0.3s ease;
      }

      .arch__node--hidden {
        opacity: 0;
        transform: scale(0.8);
      }

      .arch__node--muted {
        opacity: 0.55;
      }

      .arch__node--blocked {
        border-color: color-mix(in srgb, var(--bs-danger) 60%, var(--bs-border-color));

        .arch__node-title {
          text-decoration: line-through;
          text-decoration-color: color-mix(in srgb, var(--bs-danger) 70%, transparent);
        }
      }

      .arch__node-icon {
        display: grid;
        flex: 0 0 auto;
        place-items: center;
        width: 2rem;
        height: 2rem;
        color: var(--bs-primary);
        background-color: color-mix(in srgb, var(--bs-primary) 12%, transparent);
        border-radius: 0.375rem;
      }

      .arch__node-text {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
      }

      .arch__node-title {
        overflow: hidden;
        font-size: 0.8125rem;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .arch__node-detail {
        overflow: hidden;
        font-size: 0.6875rem;
        color: var(--bs-secondary-color);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .arch__chip {
        position: absolute;
        top: -0.625rem;
        right: 0.625rem;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.0625rem 0.5rem;
        font-size: 0.625rem;
        font-weight: 600;
        white-space: nowrap;
        color: var(--arch-tone);
        background-color: var(--bs-body-bg);
        border: var(--bs-border-width) solid currentColor;
        border-radius: 50rem;
        animation: arch-pop 0.4s ease;

        .bi-circle-fill {
          font-size: 0.375rem;
        }
      }

      .arch__chip--primary {
        --arch-tone: var(--bs-primary);
      }

      .arch__chip--success {
        --arch-tone: var(--bs-success);
      }

      .arch__chip--warning {
        --arch-tone: var(--bs-warning);
      }

      .arch__chip--danger {
        --arch-tone: var(--bs-danger);
      }

      .arch__spin {
        animation: arch-spin 1s linear infinite;
      }

      @keyframes arch-flow {
        0% {
          offset-distance: 0%;
          opacity: 0;
        }

        15%,
        85% {
          opacity: 1;
        }

        100% {
          offset-distance: 100%;
          opacity: 0;
        }
      }

      @keyframes arch-flow-blocked {
        0% {
          offset-distance: 0%;
          opacity: 0;
        }

        15% {
          opacity: 1;
        }

        70% {
          offset-distance: 45%;
          opacity: 1;
          transform: scale(1);
        }

        100% {
          offset-distance: 45%;
          opacity: 0;
          transform: scale(2.4);
        }
      }

      @keyframes arch-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes arch-pop {
        from {
          opacity: 0;
          transform: scale(0.8);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .arch__edge,
        .arch__node,
        .arch__frame,
        .arch__frame-badge,
        .arch__chip,
        .arch__bubble,
        .arch__spin {
          animation: none;
          transition: none;
        }

        .arch__pulse {
          display: none;
        }
      }
    `,
  ],
})
export class ArchitectureIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly sceneWidth = SCENE_WIDTH;
  protected readonly sceneHeight = SCENE_HEIGHT;
  protected readonly phases = PHASES;
  protected readonly columns = COLUMNS;
  protected readonly frames = FRAMES_LAYOUT;
  protected readonly nodes = NODES;
  protected readonly edges = EDGES.map((edge) => ({ ...edge, id: `${edge.from}-${edge.to}`, path: edgePath(edge) }));

  private readonly paths = new Map(this.edges.map((edge) => [edge.id, edge.path]));
  private readonly frameIndex = signal(0);

  protected readonly state = computed(() => FRAMES[this.frameIndex()]);

  protected readonly activeEdges = computed(() => new Set(this.state().pulses.map((pulse) => pulse.edge)));

  /** Keyed by frame, so a pulse on the same edge in the next frame is a new element and runs again. */
  protected readonly pulses = computed(() => {
    const frame = this.frameIndex();

    return this.state().pulses.map((pulse, index) => ({
      key: `${frame}-${index}`,
      tone: pulse.tone ?? 'primary',
      reverse: pulse.reverse ?? false,
      delay: `${pulse.delayMs ?? 0}ms`,
      offsetPath: `path('${this.paths.get(pulse.edge) ?? ''}')`,
    }));
  });

  protected readonly chips = computed<Partial<Record<string, Chip>>>(() => {
    const state = this.state();
    const chips: Partial<Record<string, Chip>> = {};

    if (state.identity) {
      chips['identity'] = { text: 'Verified', icon: 'bi-check-circle-fill', tone: 'success' };
    }

    // The controller ships the effective rules; the manager enforces them on every message.
    if (state.filter) {
      chips['manager'] = { text: 'Filters passed', icon: 'bi-funnel-fill', tone: 'success' };
    } else if (state.probe) {
      chips['manager'] = { text: 'gVisor probed', icon: 'bi-check-circle-fill', tone: 'success' };
    }

    if (state.guard === 'lockdown') {
      chips['guard'] = { text: 'Lockdown', icon: 'bi-lock-fill', tone: 'warning' };
    } else if (state.guard === 'enforcing') {
      chips['guard'] = { text: 'Enforcing', icon: 'bi-shield-check', tone: 'success' };
    }

    if (state.worker === 'starting') {
      chips['worker'] = { text: 'Starting', icon: 'bi-arrow-repeat', tone: 'primary', spin: true };
    } else if (state.worker === 'running') {
      chips['worker'] = { text: 'Running', icon: 'bi-circle-fill', tone: 'success' };
    }

    if (state.allowed) {
      chips['npm'] = { text: 'Allowed', icon: 'bi-check-lg', tone: 'success' };
    }

    if (state.blocked) {
      chips['paste'] = { text: 'Blocked', icon: 'bi-x-octagon-fill', tone: 'danger' };
    }

    if (state.audit > 0) {
      chips['audit'] = { text: `+${state.audit} events`, icon: 'bi-plus-circle-fill', tone: 'primary' };
    }

    return chips;
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
      case 'guard':
        return state.guard !== 'hidden';
      case 'worker':
        return state.worker !== 'hidden';
      default:
        return true;
    }
  }
}

/** Fills in every frame from the one before, so the timeline only lists changes. */
function buildFrames(steps: readonly Partial<FlowState>[]): FlowState[] {
  const frames: FlowState[] = [];

  steps.reduce<FlowState>((previous, step) => {
    const frame = { ...previous, pulses: [], durationMs: INITIAL.durationMs, ...step };

    frames.push(frame);

    return frame;
  }, INITIAL);

  return frames;
}

/**
 * Curve from the right edge of one card to the left edge of the next, or a straight line between
 * the facing top and bottom edges of two stacked cards, in scene pixels.
 */
function edgePath(edge: ArchEdge): string {
  const from = NODES.find((node) => node.id === edge.from);
  const to = NODES.find((node) => node.id === edge.to);

  if (!from || !to) {
    return '';
  }

  if (edge.vertical) {
    const x = from.x + from.width / 2;
    const down = to.y > from.y;
    const startY = down ? from.y + NODE_HEIGHT : from.y;
    const endY = down ? to.y : to.y + NODE_HEIGHT;

    return `M ${x} ${startY} L ${x} ${endY}`;
  }

  const start = { x: from.x + from.width, y: from.y + NODE_HEIGHT / 2 };
  const end = { x: to.x, y: to.y + NODE_HEIGHT / 2 };
  const bend = Math.max(24, (end.x - start.x) / 2);

  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}
