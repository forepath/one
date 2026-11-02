import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface FailoverStep {
  title: string;
  detail: string;
}

/**
 * Ingress failover scene (3.6, 3.28): the failover IP moves from a node that went down to a healthy
 * node of the `role = ingress` group; DNS failover covers addresses that cannot move.
 */
@Component({
  selector: 'loadweaver-portal-failover-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <svg viewBox="0 0 1200 520" aria-hidden="true" focusable="false">
      <!-- Client -->
      <rect class="lw-card" x="32" y="150" width="170" height="104" rx="14" />
      <text class="lw-text lw-text--strong" x="52" y="182">Clients</text>
      <text class="lw-text lw-text--muted lw-text--small lw-mono" x="52" y="206">203.0.113.10:443</text>
      <text class="lw-text lw-text--muted lw-text--small lw-mono" x="52" y="228">203.0.113.10:5432</text>

      <!-- Old path to the failed node -->
      <path class="lw-edge lw-edge--blocked" d="M202 184 C 280 184, 300 100, 380 100" />
      <!-- New path to the takeover node -->
      <path class="lw-edge lw-edge--gold lw-edge--flow" d="M202 220 C 280 220, 300 304, 380 304" />

      <!-- Failed node -->
      <rect class="lw-card lw-card--down" x="380" y="40" width="300" height="120" rx="14" />
      <circle class="lw-dot lw-dot--danger" cx="404" cy="70" r="6" />
      <text class="lw-text lw-text--strong" x="420" y="76">n1</text>
      <text class="lw-text lw-text--muted" x="446" y="76">fra1</text>
      <rect class="lw-pill lw-pill--danger" x="560" y="56" width="100" height="24" rx="12" />
      <text class="lw-text lw-text--danger lw-text--small" x="574" y="72">unhealthy</text>
      <text class="lw-text lw-text--muted lw-text--small lw-mono" x="404" y="112">203.0.113.10 released</text>
      <text class="lw-text lw-text--muted lw-text--small" x="404" y="136">role = ingress</text>

      <!-- Takeover node -->
      <rect class="lw-card lw-card--gold" x="380" y="244" width="300" height="120" rx="14" />
      <circle class="lw-dot lw-dot--ok" cx="404" cy="274" r="6" />
      <text class="lw-text lw-text--strong" x="420" y="280">n4</text>
      <text class="lw-text lw-text--muted" x="446" y="280">ams1</text>
      <rect class="lw-pill lw-pill--ok" x="560" y="260" width="100" height="24" rx="12" />
      <text class="lw-text lw-text--ok lw-text--small" x="580" y="276">serving</text>
      <text class="lw-text lw-text--gold lw-text--small lw-mono" x="404" y="316">203.0.113.10 failover IP</text>
      <text class="lw-text lw-text--muted lw-text--small" x="404" y="340">certificates already on the node</text>

      <!-- Mechanisms -->
      <rect class="lw-card" x="740" y="40" width="428" height="324" rx="16" />
      <text class="lw-text lw-text--muted" x="764" y="76">HOW THE IP MOVES</text>
      @for (mechanism of mechanisms; track mechanism.title; let i = $index) {
        <g>
          <rect
            class="lw-pill"
            [class.lw-pill--gold-soft]="i === 1"
            x="764"
            [attr.y]="94 + i * 64"
            width="380"
            height="52"
            rx="10"
          />
          <text class="lw-text lw-text--small lw-text--strong" x="780" [attr.y]="115 + i * 64">
            {{ mechanism.title }}
          </text>
          <text class="lw-text lw-text--muted lw-text--small" x="780" [attr.y]="135 + i * 64">
            {{ mechanism.detail }}
          </text>
        </g>
      }

      <!-- Timeline -->
      <path class="lw-edge" d="M60 440 L 1140 440" />
      @for (step of steps; track step.title; let i = $index) {
        <g>
          <circle [class]="i === 0 ? 'lw-dot lw-dot--danger' : 'lw-dot'" [attr.cx]="80 + i * 300" cy="440" r="8" />
          <text class="lw-text lw-text--small lw-text--strong" [attr.x]="100 + i * 300" y="432">{{ step.title }}</text>
          <text class="lw-text lw-text--muted lw-text--small" [attr.x]="100 + i * 300" y="466">{{ step.detail }}</text>
        </g>
      }
    </svg>
  `,
  styleUrl: './scene.scss',
})
export class FailoverIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly mechanisms: readonly FailoverStep[] = [
    { title: 'Same L2 segment', detail: 'VRRP-style floating IP' },
    { title: 'Routed or multi-site', detail: 'announced via BGP from the healthy node' },
    { title: 'Hosting provider', detail: "the provider's failover IP API" },
    { title: 'IP cannot float', detail: 'DNS failover with probes from two sites' },
  ];

  protected readonly steps: readonly FailoverStep[] = [
    { title: 'n1 goes down', detail: 'its ingress stops answering' },
    { title: 'IP moves to n4', detail: 'a healthy member of role = ingress' },
    { title: 'Traffic continues', detail: 'HTTP and L4 port forwards' },
    { title: 'Takeover logged', detail: 'with its reason' },
  ];
}
