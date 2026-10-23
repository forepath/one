import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface PolicyGroup {
  id: string;
  kind: string;
  selector: string;
  x: number;
  y: number;
  highlight?: boolean;
}

interface CompiledLayer {
  layer: string;
  effect: string;
}

const GROUP_WIDTH = 170;
const GROUP_HEIGHT = 74;

/**
 * Policy model scene (3.3): groups as boxes, allow policies as edges, a flow without a policy that has
 * no tunnel and no route, and the compiled effect of one policy per enforcement layer.
 */
@Component({
  selector: 'loadweaver-portal-policy-graph-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <svg viewBox="0 0 1200 600" aria-hidden="true" focusable="false">
      <text class="lw-text lw-text--muted" x="32" y="48">GROUPS AND POLICIES</text>

      <!-- Allowed edges (one policy = one edge) -->
      <path class="lw-edge lw-edge--gold lw-edge--flow" d="M202 157 L 300 157" />
      <path class="lw-edge lw-edge--gold lw-edge--flow" d="M470 157 L 580 157" />
      <path class="lw-edge lw-edge--gold" d="M665 194 L 665 290" />
      <path class="lw-edge lw-edge--gold" d="M202 433 C 300 433, 300 194, 385 194" />

      <rect class="lw-pill lw-pill--gold-soft" x="212" y="110" width="78" height="24" rx="12" />
      <text class="lw-text lw-text--gold lw-text--small lw-mono" x="223" y="126">443/tcp</text>
      <rect class="lw-pill lw-pill--gold-soft" x="480" y="110" width="90" height="24" rx="12" />
      <text class="lw-text lw-text--gold lw-text--small lw-mono" x="489" y="126">GET /v1/*</text>
      <rect class="lw-pill lw-pill--gold-soft" x="678" y="230" width="84" height="24" rx="12" />
      <text class="lw-text lw-text--gold lw-text--small lw-mono" x="688" y="246">5432/tcp</text>
      <rect class="lw-pill lw-pill--warn" x="290" y="318" width="116" height="24" rx="12" />
      <text class="lw-text lw-text--warn lw-text--small" x="301" y="334">mode: monitor</text>

      <!-- Flow without a matching policy: no tunnel, no route -->
      <path class="lw-edge lw-edge--blocked" d="M440 194 C 470 270, 520 327, 580 327" />
      <circle class="lw-dot lw-dot--danger" cx="490" cy="282" r="11" />
      <text class="lw-text lw-text--dark" x="485" y="287" style="fill: #121214">×</text>
      <text class="lw-text lw-text--danger lw-text--small" x="430" y="392">web → db: no policy, no route</text>

      @for (group of groups; track group.id) {
        <g>
          <rect
            class="lw-card"
            [class.lw-card--gold]="group.highlight"
            [attr.x]="group.x"
            [attr.y]="group.y"
            [attr.width]="groupWidth"
            [attr.height]="groupHeight"
            rx="14"
          />
          <text class="lw-text lw-text--strong" [attr.x]="group.x + 18" [attr.y]="group.y + 30">{{ group.id }}</text>
          <text
            class="lw-text lw-text--muted lw-text--small"
            text-anchor="end"
            [attr.x]="group.x + groupWidth - 16"
            [attr.y]="group.y + 30"
          >
            {{ group.kind }}
          </text>
          <text class="lw-text lw-text--muted lw-text--small lw-mono" [attr.x]="group.x + 18" [attr.y]="group.y + 56">
            {{ group.selector }}
          </text>
        </g>
      }

      <!-- Compiled effect of the selected policy -->
      <rect class="lw-card" x="836" y="72" width="336" height="456" rx="16" />
      <text class="lw-text lw-text--muted" x="860" y="108">COMPILED FROM</text>
      <text class="lw-text lw-text--strong lw-text--gold lw-mono" x="860" y="136">api → db</text>
      <rect class="lw-pill lw-pill--ok" x="860" y="152" width="78" height="24" rx="12" />
      <text class="lw-text lw-text--ok lw-text--small" x="872" y="168">enforce</text>
      <rect class="lw-pill lw-pill--gold-soft" x="946" y="152" width="84" height="24" rx="12" />
      <text class="lw-text lw-text--gold lw-text--small lw-mono" x="956" y="168">5432/tcp</text>
      @for (item of compiled; track item.layer; let i = $index) {
        <g>
          <rect class="lw-pill" x="860" [attr.y]="196 + i * 64" width="288" height="52" rx="10" />
          <text class="lw-text lw-text--small lw-text--strong" x="876" [attr.y]="217 + i * 64">{{ item.layer }}</text>
          <text class="lw-text lw-text--muted lw-text--small lw-mono" x="876" [attr.y]="237 + i * 64">
            {{ item.effect }}
          </text>
        </g>
      }

      @for (rule of rules; track rule.text) {
        <rect class="lw-pill" [attr.x]="rule.x" y="540" [attr.width]="rule.width" height="26" rx="13" />
        <text class="lw-text lw-text--muted lw-text--small" [attr.x]="rule.x + 14" y="557">{{ rule.text }}</text>
      }
    </svg>
  `,
  styleUrl: './scene.scss',
})
export class PolicyGraphIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly groupWidth = GROUP_WIDTH;
  protected readonly groupHeight = GROUP_HEIGHT;

  protected readonly groups: readonly PolicyGroup[] = [
    { id: 'internet', kind: 'built-in', selector: '0.0.0.0/0, ::/0', x: 32, y: 120 },
    { id: 'web', kind: 'workloads', selector: 'app = shop-web', x: 300, y: 120 },
    { id: 'api', kind: 'workloads', selector: 'app = shop-api', x: 580, y: 120, highlight: true },
    { id: 'db', kind: 'workloads', selector: 'app = shop-db', x: 580, y: 290 },
    { id: 'office-berlin', kind: 'clients', selector: '192.168.10.0/24', x: 32, y: 396 },
  ];

  /** Rules of the model as separate chips (no separator characters). */
  protected readonly rules = [
    { text: 'Default deny between groups', x: 32, width: 196 },
    { text: 'Allow-only and stateful', x: 240, width: 170 },
    { text: 'Never transitive', x: 422, width: 124 },
  ];

  protected readonly compiled: readonly CompiledLayer[] = [
    { layer: 'Tunneling', effect: 'adds WireGuard peer n2 ↔ n3' },
    { layer: 'Routing', effect: 'exports 10.20.3.0/24 to n2' },
    { layer: 'Filtering', effect: 'nftables accept 5432/tcp' },
    { layer: 'Proxy (L7)', effect: 'not needed for this port' },
    { layer: 'Exposure', effect: 'none, stays internal' },
  ];
}
