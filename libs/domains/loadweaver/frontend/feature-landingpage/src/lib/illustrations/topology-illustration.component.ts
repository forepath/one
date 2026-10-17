import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface TopologyService {
  name: string;
  /** Replica label, e.g. `×2` or `primary`. */
  detail: string;
  tone: 'default' | 'gold' | 'ok';
}

interface TopologyNode {
  id: string;
  x: number;
  y: number;
  roles: readonly string[];
  /** Failover IP held by (or on standby on) this node. */
  ip?: { address: string; state: 'holder' | 'standby' };
  services: readonly TopologyService[];
}

const NODE_WIDTH = 230;
const NODE_HEIGHT = 158;

/**
 * Hero scene of the topology map (3.9): two sites, their nodes and services, the WireGuard tunnels
 * between them, the failover IP and its standby, a replicated volume and live traffic from the
 * internet. Decorative drawing; the host carries the accessible label.
 */
@Component({
  selector: 'loadweaver-portal-topology-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <svg viewBox="0 0 1200 600" aria-hidden="true" focusable="false">
      <!-- External side: client entry point and DNS answer -->
      <g>
        <rect class="lw-card" x="24" y="196" width="150" height="118" rx="14" />
        <text class="lw-text lw-text--strong" x="44" y="226">Internet</text>
        <text class="lw-text lw-text--muted lw-mono lw-text--small" x="44" y="252">app.example.com</text>
        <text class="lw-text lw-text--muted lw-text--small" x="44" y="274">A 203.0.113.10</text>
        <text class="lw-text lw-text--muted lw-text--small" x="44" y="296">via Cloudflare</text>
      </g>

      <!-- Sites -->
      <rect class="lw-site" x="206" y="40" width="530" height="470" rx="20" />
      <text class="lw-text lw-text--muted" x="230" y="72">SITE fra1</text>
      <rect class="lw-site" x="770" y="40" width="406" height="470" rx="20" />
      <text class="lw-text lw-text--muted" x="794" y="72">SITE ams1</text>

      <!-- Live traffic: internet → failover IP holder -->
      <path class="lw-edge lw-edge--gold lw-edge--flow" d="M174 255 C 200 255, 206 176, 236 176" />

      <!-- WireGuard tunnels across sites (only where policies need them) -->
      <path class="lw-edge lw-edge--gold lw-edge--tunnel" d="M716 176 L 800 176" />
      <path class="lw-edge lw-edge--gold lw-edge--tunnel" d="M596 406 L 800 406" />
      <rect class="lw-pill lw-pill--gold-soft" x="716" y="150" width="84" height="22" rx="11" />
      <text class="lw-text lw-text--gold lw-text--small" x="728" y="165">WireGuard</text>

      <!-- Volume replication: sync inside the site, async across sites -->
      <path class="lw-edge lw-edge--ok" d="M600 254 C 600 290, 520 290, 520 328" />
      <rect class="lw-pill lw-pill--ok" x="574" y="282" width="52" height="22" rx="11" />
      <text class="lw-text lw-text--ok lw-text--small" x="586" y="297">sync</text>
      <path class="lw-edge lw-edge--warn" d="M596 470 C 700 470, 760 470, 800 470" />
      <rect class="lw-pill lw-pill--warn" x="640" y="482" width="56" height="22" rx="11" />
      <text class="lw-text lw-text--warn lw-text--small" x="651" y="497">async</text>
      <rect class="lw-pill lw-pill--warn" x="702" y="482" width="46" height="22" rx="11" />
      <text class="lw-text lw-text--warn lw-text--small" x="713" y="497">RPO</text>

      @for (node of nodes; track node.id) {
        <g>
          <rect
            class="lw-card"
            [class.lw-card--gold]="node.ip?.state === 'holder'"
            [attr.x]="node.x"
            [attr.y]="node.y"
            [attr.width]="nodeWidth"
            [attr.height]="nodeHeight"
            rx="14"
          />
          <circle class="lw-dot lw-dot--ok" [attr.cx]="node.x + 22" [attr.cy]="node.y + 26" r="5" />
          <text class="lw-text lw-text--strong" [attr.x]="node.x + 36" [attr.y]="node.y + 31">{{ node.id }}</text>
          @for (role of node.roles; track role; let i = $index) {
            <rect
              class="lw-pill"
              [attr.x]="node.x + 74 + i * 76"
              [attr.y]="node.y + 14"
              width="70"
              height="22"
              rx="11"
            />
            <text class="lw-text lw-text--muted lw-text--small" [attr.x]="node.x + 84 + i * 76" [attr.y]="node.y + 29">
              {{ role }}
            </text>
          }
          @if (node.ip; as ip) {
            <text
              class="lw-text lw-mono lw-text--small"
              [class.lw-text--gold]="ip.state === 'holder'"
              [class.lw-text--muted]="ip.state === 'standby'"
              [attr.x]="node.x + 18"
              [attr.y]="node.y + 60"
            >
              {{ ip.address }}
            </text>
            <rect
              class="lw-pill"
              [class.lw-pill--gold-soft]="ip.state === 'holder'"
              [attr.x]="node.x + 124"
              [attr.y]="node.y + 45"
              width="88"
              height="20"
              rx="10"
            />
            <text
              class="lw-text lw-text--small"
              [class.lw-text--gold]="ip.state === 'holder'"
              [class.lw-text--muted]="ip.state === 'standby'"
              text-anchor="middle"
              [attr.x]="node.x + 168"
              [attr.y]="node.y + 59"
            >
              {{ ip.state === 'holder' ? 'failover IP' : 'standby' }}
            </text>
          }
          @for (service of node.services; track service.name; let i = $index) {
            <rect
              class="lw-pill"
              [class.lw-pill--gold-soft]="service.tone === 'gold'"
              [class.lw-pill--ok]="service.tone === 'ok'"
              [attr.x]="node.x + 18"
              [attr.y]="node.y + 76 + i * 34"
              [attr.width]="nodeWidth - 36"
              height="26"
              rx="8"
            />
            <text class="lw-text lw-text--small" [attr.x]="node.x + 30" [attr.y]="node.y + 94 + i * 34">
              {{ service.name }}
            </text>
            <text
              class="lw-text lw-text--muted lw-text--small"
              text-anchor="end"
              [attr.x]="node.x + nodeWidth - 30"
              [attr.y]="node.y + 94 + i * 34"
            >
              {{ service.detail }}
            </text>
          }
        </g>
      }

      <!-- Legend -->
      <g>
        <path class="lw-edge lw-edge--gold lw-edge--flow" d="M230 556 L 262 556" />
        <text class="lw-text lw-text--muted lw-text--small" x="272" y="560">live traffic</text>
        <path class="lw-edge lw-edge--gold lw-edge--tunnel" d="M380 556 L 412 556" />
        <text class="lw-text lw-text--muted lw-text--small" x="422" y="560">encrypted tunnel</text>
        <path class="lw-edge lw-edge--ok" d="M560 556 L 592 556" />
        <text class="lw-text lw-text--muted lw-text--small" x="602" y="560">volume replica</text>
        <circle class="lw-dot lw-dot--ok" cx="726" cy="556" r="5" />
        <text class="lw-text lw-text--muted lw-text--small" x="738" y="560">healthy, no single point of failure</text>
      </g>
    </svg>
  `,
  styleUrl: './scene.scss',
})
export class TopologyIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly nodeWidth = NODE_WIDTH;
  protected readonly nodeHeight = NODE_HEIGHT;

  protected readonly nodes: readonly TopologyNode[] = [
    {
      id: 'n1',
      x: 236,
      y: 96,
      roles: ['ingress', 'control'],
      ip: { address: '203.0.113.10', state: 'holder' },
      services: [
        { name: 'shop / web', detail: '×2', tone: 'gold' },
        { name: 'shop / api', detail: '×2', tone: 'default' },
      ],
    },
    {
      id: 'n2',
      x: 486,
      y: 96,
      roles: ['control'],
      services: [
        { name: 'shop / db', detail: 'primary', tone: 'default' },
        { name: 'volume db-data', detail: 'replica 1', tone: 'ok' },
      ],
    },
    {
      id: 'n3',
      x: 366,
      y: 328,
      roles: ['control'],
      services: [
        { name: 'shop / api', detail: '×2', tone: 'default' },
        { name: 'volume db-data', detail: 'replica 2', tone: 'ok' },
      ],
    },
    {
      id: 'n4',
      x: 800,
      y: 96,
      roles: ['ingress'],
      ip: { address: '203.0.113.10', state: 'standby' },
      services: [
        { name: 'shop / web', detail: '×2', tone: 'gold' },
        { name: 'agents / runner', detail: 'sandboxed', tone: 'default' },
      ],
    },
    {
      id: 'n5',
      x: 800,
      y: 328,
      roles: ['worker'],
      services: [
        { name: 'platform / logs', detail: 'replica', tone: 'default' },
        { name: 'volume db-data', detail: 'replica 3', tone: 'ok' },
      ],
    },
  ];
}
