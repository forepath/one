import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcLaneHeaderComponent } from '@forepath/shared/frontend/ui-components';

interface CodeLine {
  no: number;
  html: string;
  diff?: 'added' | 'removed';
}

/** Engineering scene: file tree, an editor showing the agent's diff, agent chat and Git status. */
@Component({
  selector: 'framework-portal-ide-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcBadgeComponent, FpcLaneHeaderComponent],
  template: `
    <shared-app-illustration [label]="label()" address="app.agenstra.com/editor" [width]="1100" [height]="620">
      <div class="d-flex flex-column flex-grow-1 min-w-0">
        <div class="d-flex flex-grow-1 min-h-0">
          <section class="sai-col ide-illustration__tree">
            <fpc-lane-header title="Explorer" flush />
            <ul class="ide-illustration__files list-unstyled mb-0 py-2">
              @for (entry of files; track entry.name) {
                <li [class.ide-illustration__file--active]="entry.active" [style.padding-left.rem]="0.75 + entry.depth">
                  <i class="bi" [class]="entry.icon"></i>{{ entry.name }}
                  @if (entry.status) {
                    <span class="ide-illustration__status">{{ entry.status }}</span>
                  }
                </li>
              }
            </ul>
          </section>

          <section class="sai-col sai-col--grow">
            <div class="ide-illustration__tabs">
              <span class="ide-illustration__tab ide-illustration__tab--active">
                <i class="bi bi-filetype-tsx"></i>cart.ts
              </span>
              <span class="ide-illustration__tab"><i class="bi bi-filetype-tsx"></i>cart.spec.ts</span>
            </div>
            <div class="sai-code sai-body py-2">
              @for (line of code; track line.no) {
                <div
                  class="sai-code__line"
                  [class.sai-code__line--added]="line.diff === 'added'"
                  [class.sai-code__line--removed]="line.diff === 'removed'"
                >
                  <span class="sai-code__no">{{ line.no }}</span
                  ><span [innerHTML]="line.html"></span>
                </div>
              }
            </div>
          </section>

          <section class="sai-col ide-illustration__chat">
            <fpc-lane-header flush>
              <span fpcLaneHeaderTitle>builder</span>
              <fpc-badge fpcLaneHeaderActions color="success" variant="info" size="sm">Running</fpc-badge>
            </fpc-lane-header>
            <div class="sai-body d-flex flex-column gap-2 p-3">
              <div class="sai-bubble sai-bubble--user">Apply the discount before rounding.</div>
              <div class="sai-tool"><i class="bi bi-pencil-square"></i>Edited <code>cart.ts</code></div>
              <div class="sai-tool"><i class="bi bi-terminal"></i><code>npm test</code>: 42 passed</div>
              <div class="sai-bubble sai-bubble--agent">Done. Ready to commit on <code>fix/discount</code>.</div>
            </div>
          </section>
        </div>
        <footer class="ide-illustration__statusbar">
          <span><i class="bi bi-git"></i>fix/discount</span>
          <span><i class="bi bi-arrow-up"></i>1</span>
          <span class="ms-auto">TypeScript</span>
          <span>UTF-8</span>
        </footer>
      </div>
    </shared-app-illustration>
  `,
  styles: [
    `
      .ide-illustration__tree {
        flex: 0 0 14rem;
      }

      .ide-illustration__chat {
        flex: 0 0 17rem;
        border-right: 0;
        border-left: var(--bs-border-width) solid var(--bs-border-color);
      }

      .ide-illustration__files {
        font-size: 0.8125rem;

        li {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.75rem;
          color: var(--bs-secondary-color);
        }

        .bi {
          color: var(--bs-secondary-color);
        }
      }

      .ide-illustration__file--active {
        color: var(--bs-body-color) !important;
        background-color: color-mix(in srgb, var(--bs-primary) 14%, transparent);
      }

      .ide-illustration__status {
        margin-left: auto;
        font-weight: 600;
        color: var(--bs-warning);
      }

      .ide-illustration__tabs {
        display: flex;
        background-color: var(--bs-tertiary-bg);
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .ide-illustration__tab {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.8125rem;
        color: var(--bs-secondary-color);
        border-right: var(--bs-border-width) solid var(--bs-border-color);
      }

      .ide-illustration__tab--active {
        color: var(--bs-body-color);
        background-color: var(--bs-body-bg);
        box-shadow: inset 0 2px 0 var(--bs-primary);
      }

      .ide-illustration__statusbar {
        display: flex;
        gap: 1.25rem;
        padding: 0.25rem 1rem;
        font-size: 0.75rem;
        color: #fff;
        background-color: var(--bs-primary);

        .bi {
          margin-right: 0.25rem;
        }
      }
    `,
  ],
})
export class IdeIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly files = [
    { name: 'src', icon: 'bi-folder2-open', depth: 0, active: false, status: '' },
    { name: 'checkout', icon: 'bi-folder2-open', depth: 0.75, active: false, status: '' },
    { name: 'cart.ts', icon: 'bi-filetype-tsx', depth: 1.5, active: true, status: 'M' },
    { name: 'cart.spec.ts', icon: 'bi-filetype-tsx', depth: 1.5, active: false, status: 'M' },
    { name: 'pricing.ts', icon: 'bi-filetype-tsx', depth: 1.5, active: false, status: '' },
    { name: 'shared', icon: 'bi-folder2', depth: 0.75, active: false, status: '' },
    { name: 'package.json', icon: 'bi-filetype-json', depth: 0, active: false, status: '' },
    { name: 'README.md', icon: 'bi-markdown', depth: 0, active: false, status: '' },
  ];

  protected readonly code: CodeLine[] = [
    {
      no: 12,
      html: '<span class="sai-tok-key">export function</span> <span class="sai-tok-fn">cartTotal</span>(items: CartItem[], discount: Discount) {',
    },
    {
      no: 13,
      html: '  <span class="sai-tok-key">const</span> subtotal = items.<span class="sai-tok-fn">reduce</span>((sum, item) =&gt; sum + item.price * item.qty, 0);',
    },
    {
      no: 14,
      html: '  <span class="sai-tok-key">return</span> <span class="sai-tok-fn">applyDiscount</span>(<span class="sai-tok-fn">roundCents</span>(subtotal), discount);',
      diff: 'removed',
    },
    { no: 14, html: '  <span class="sai-tok-com">// Discount first, then round once.</span>', diff: 'added' },
    {
      no: 15,
      html: '  <span class="sai-tok-key">return</span> <span class="sai-tok-fn">roundCents</span>(<span class="sai-tok-fn">applyDiscount</span>(subtotal, discount));',
      diff: 'added',
    },
    { no: 16, html: '}' },
    { no: 17, html: '' },
    {
      no: 18,
      html: '<span class="sai-tok-key">export function</span> <span class="sai-tok-fn">roundCents</span>(value: <span class="sai-tok-key">number</span>) {',
    },
    {
      no: 19,
      html: '  <span class="sai-tok-key">return</span> Math.<span class="sai-tok-fn">round</span>(value * <span class="sai-tok-str">100</span>) / <span class="sai-tok-str">100</span>;',
    },
    { no: 20, html: '}' },
    { no: 21, html: '' },
    {
      no: 22,
      html: '<span class="sai-tok-key">export const</span> CURRENCY = <span class="sai-tok-str">&#39;EUR&#39;</span>;',
    },
  ];
}
