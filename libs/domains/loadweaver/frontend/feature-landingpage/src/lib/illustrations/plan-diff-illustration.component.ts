import { ChangeDetectionStrategy, Component, input } from '@angular/core';

type PlanLineTone = 'prompt' | 'heading' | 'added' | 'changed' | 'ok' | 'warning' | 'muted' | 'plain';

interface PlanLine {
  tone: PlanLineTone;
  /** Leading marker column (`+`, `~`, `✓`, `!`). */
  marker?: string;
  text: string;
  detail?: string;
}

/**
 * Plan review scene (3.8, 3.12): a `loadweaver plan` run with the diff per resource and layer, the
 * failure analysis and an unacknowledged pin that blocks a plain apply.
 */
@Component({
  selector: 'loadweaver-portal-plan-diff-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <div class="plan-diff" aria-hidden="true">
      <div class="plan-diff__chrome">
        <span class="plan-diff__lights"><i></i><i></i><i></i></span>
        <span class="plan-diff__title">loadweaver plan</span>
      </div>
      <div class="plan-diff__body lw-mono">
        @for (line of lines; track $index) {
          <div class="plan-diff__line" [class]="'plan-diff__line--' + line.tone">
            <span class="plan-diff__marker">{{ line.marker ?? '' }}</span>
            <span class="plan-diff__text">{{ line.text }}</span>
            @if (line.detail) {
              <span class="plan-diff__detail">{{ line.detail }}</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './scene.scss',
  styles: [
    `
      .plan-diff__chrome {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid rgb(255 255 255 / 0.1);
        background: #18181b;
      }

      .plan-diff__lights {
        display: inline-flex;
        gap: 0.375rem;

        i {
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 50%;
          background: rgb(255 255 255 / 0.18);
        }
      }

      .plan-diff__title {
        font-size: 0.8125rem;
        color: #9ca3af;
      }

      .plan-diff__body {
        padding: 1.25rem 1.5rem 1.5rem;
        font-size: 0.8125rem;
        line-height: 1.75;
        color: #e7e7ea;
        overflow-x: auto;
      }

      .plan-diff__line {
        display: grid;
        grid-template-columns: 1.25rem minmax(0, auto) 1fr;
        column-gap: 0.75rem;
        white-space: pre;
      }

      .plan-diff__detail {
        color: #9ca3af;
      }

      .plan-diff__line--prompt .plan-diff__text {
        color: #ffc21a;
      }

      .plan-diff__line--heading {
        margin-top: 0.75rem;
        font-weight: 700;
      }

      .plan-diff__line--added .plan-diff__marker,
      .plan-diff__line--ok .plan-diff__marker {
        color: #34d399;
      }

      .plan-diff__line--changed .plan-diff__marker {
        color: #ffc21a;
      }

      .plan-diff__line--warning {
        color: #fb923c;
      }

      .plan-diff__line--muted {
        color: #9ca3af;
      }
    `,
  ],
})
export class PlanDiffIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly lines: readonly PlanLine[] = [
    { tone: 'prompt', marker: '$', text: 'loadweaver plan shop/compose.yaml' },
    { tone: 'muted', text: 'locks deployment shop, policy web-to-api' },
    { tone: 'heading', text: 'Changes' },
    { tone: 'added', marker: '+', text: 'deployment shop', detail: 'web ×2, api ×2, db ×1' },
    { tone: 'changed', marker: '~', text: 'policy web-to-api', detail: 'adds WireGuard peer n1 ↔ n3' },
    { tone: 'plain', text: '', detail: 'exports 10.20.3.0/24 to fra1' },
    { tone: 'added', marker: '+', text: 'dns A shop.example.com', detail: '→ 203.0.113.10 at Cloudflare' },
    { tone: 'added', marker: '+', text: 'certificate shop.example.com', detail: 'ACME, on every ingress node' },
    { tone: 'heading', text: 'Failure analysis' },
    { tone: 'ok', marker: '✓', text: 'loss of n1, n3, n4 or n5', detail: 'data, deployment and traffic survive' },
    { tone: 'ok', marker: '✓', text: 'capacity N+1', detail: 'remaining nodes can take over' },
    { tone: 'warning', marker: '!', text: 'volume db-data has no replica outside n2', detail: 'pin, not acknowledged' },
    { tone: 'muted', text: 'Apply needs an explicit confirm for 1 pin.' },
  ];
}
