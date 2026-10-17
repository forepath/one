import { ChangeDetectionStrategy, Component, input } from '@angular/core';

type Posture = 'ok' | 'failing' | 'machine';

interface RemoteClient {
  name: string;
  group: string;
  posture: Posture;
  postureLabel: string;
  y: number;
}

interface InternalService {
  name: string;
  allowed: string;
  y: number;
}

/**
 * Remote access scene (3.31): users, a machine and an office connect through one endpoint to the
 * `vpn` gateways and reach only what their group policies allow; a device with failing posture lands
 * in a restricted group.
 */
@Component({
  selector: 'loadweaver-portal-remote-access-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <svg viewBox="0 0 1200 560" aria-hidden="true" focusable="false">
      <text class="lw-text lw-text--muted" x="32" y="44">REMOTE CLIENTS</text>
      <text class="lw-text lw-text--muted" x="474" y="44">VPN GATEWAYS</text>
      <text class="lw-text lw-text--muted" x="872" y="44">INTERNAL SERVICES</text>

      <!-- Client → endpoint -->
      @for (client of clients; track client.name) {
        <path
          class="lw-edge"
          [class.lw-edge--gold]="client.posture !== 'failing'"
          [class.lw-edge--flow]="client.posture !== 'failing'"
          [class.lw-edge--warn]="client.posture === 'failing'"
          [attr.d]="'M332 ' + (client.y + 37) + ' C 400 ' + (client.y + 37) + ', 410 270, 474 270'"
        />
      }

      @for (client of clients; track client.name) {
        <g>
          <rect class="lw-card" [attr.x]="32" [attr.y]="client.y" width="300" height="74" rx="14" />
          <text class="lw-text lw-text--strong" x="52" [attr.y]="client.y + 30">{{ client.name }}</text>
          <text class="lw-text lw-text--muted lw-text--small" x="52" [attr.y]="client.y + 54">
            group {{ client.group }}
          </text>
          <rect
            class="lw-pill"
            [class.lw-pill--ok]="client.posture === 'ok'"
            [class.lw-pill--warn]="client.posture === 'failing'"
            x="200"
            [attr.y]="client.y + 14"
            width="116"
            height="24"
            rx="12"
          />
          <text
            class="lw-text lw-text--small"
            [class.lw-text--ok]="client.posture === 'ok'"
            [class.lw-text--warn]="client.posture === 'failing'"
            [class.lw-text--muted]="client.posture === 'machine'"
            x="212"
            [attr.y]="client.y + 30"
          >
            {{ client.postureLabel }}
          </text>
        </g>
      }

      <!-- One endpoint, several gateways -->
      <rect class="lw-card lw-card--gold" x="474" y="196" width="300" height="148" rx="16" />
      <text class="lw-text lw-text--strong lw-text--gold lw-mono" x="494" y="228">vpn.example.com</text>
      <text class="lw-text lw-text--muted lw-text--small" x="494" y="252">failover IP, anycast or DNS failover</text>
      <rect class="lw-pill" x="494" y="270" width="124" height="54" rx="10" />
      <circle class="lw-dot lw-dot--ok" cx="512" cy="290" r="5" />
      <text class="lw-text lw-text--small lw-text--strong" x="524" y="295">gw1</text>
      <text class="lw-text lw-text--muted lw-text--small" x="556" y="295">fra1</text>
      <text class="lw-text lw-text--muted lw-text--small" x="510" y="314">WireGuard</text>
      <rect class="lw-pill" x="630" y="270" width="124" height="54" rx="10" />
      <circle class="lw-dot lw-dot--ok" cx="648" cy="290" r="5" />
      <text class="lw-text lw-text--small lw-text--strong" x="660" y="295">gw2</text>
      <text class="lw-text lw-text--muted lw-text--small" x="692" y="295">ams1</text>
      <text class="lw-text lw-text--muted lw-text--small" x="646" y="314">WireGuard</text>

      <!-- Gateway → services (split tunnel: only what policies allow) -->
      @for (service of services; track service.name) {
        <path class="lw-edge lw-edge--gold" [attr.d]="'M774 270 C 820 270, 820 ' + (service.y + 30) + ', 872 ' + (service.y + 30)" />
      }
      @for (service of services; track service.name) {
        <g>
          <rect class="lw-card" x="872" [attr.y]="service.y" width="296" height="60" rx="14" />
          <text class="lw-text lw-text--strong" x="892" [attr.y]="service.y + 26">{{ service.name }}</text>
          <text class="lw-text lw-text--muted lw-text--small" x="892" [attr.y]="service.y + 46">{{ service.allowed }}</text>
        </g>
      }

      <text class="lw-text lw-text--muted lw-text--small" x="32" y="516">
        Split tunnel by default: AllowedIPs come from the policies, never more.
      </text>
      <text class="lw-text lw-text--muted lw-text--small" x="32" y="538">Every log names alice@laptop instead of an IP.</text>
    </svg>
  `,
  styleUrl: './scene.scss',
})
export class RemoteAccessIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly clients: readonly RemoteClient[] = [
    { name: 'alice@laptop', group: 'sales', posture: 'ok', postureLabel: 'posture ok', y: 68 },
    { name: 'bob@phone', group: 'restricted', posture: 'failing', postureLabel: 'OS outdated', y: 166 },
    { name: 'office-berlin', group: 'office-berlin', posture: 'machine', postureLabel: 'site-to-site', y: 264 },
    { name: 'ci-runner', group: 'ci', posture: 'machine', postureLabel: 'machine', y: 362 },
  ];

  protected readonly services: readonly InternalService[] = [
    { name: 'crm', allowed: 'sales → 443/tcp', y: 80 },
    { name: 'intranet', allowed: 'office-berlin → 443/tcp', y: 178 },
    { name: 'registry', allowed: 'ci → 443/tcp', y: 276 },
    { name: 'helpdesk', allowed: 'restricted → 443/tcp', y: 374 },
  ];
}
