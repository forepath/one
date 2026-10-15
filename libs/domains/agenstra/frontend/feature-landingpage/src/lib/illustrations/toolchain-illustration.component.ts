import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent } from '@forepath/shared/frontend/ui-components';

/** Toolchain scene: your editor with Agenstra Desktop docked beside it. */
@Component({
  selector: 'framework-portal-toolchain-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcBadgeComponent],
  template: `
    <shared-app-illustration [label]="label()" [chrome]="false" [width]="760" [height]="440">
      <div class="sai-window toolchain-illustration__editor">
        <div class="sai-window__bar">Your editor: src/checkout/cart.ts</div>
        <div class="sai-code py-2 flex-grow-1">
          @for (line of code; track line.no) {
            <div class="sai-code__line" [class.sai-code__line--added]="line.added">
              <span class="sai-code__no">{{ line.no }}</span
              ><span [innerHTML]="line.html"></span>
            </div>
          }
        </div>
        <div class="toolchain-illustration__terminal">
          <div class="toolchain-illustration__terminal-tab">Terminal</div>
          <div class="sai-code px-3 pb-3">
            <div><span class="sai-tok-str">~/platform-api</span> git pull</div>
            <div class="sai-tok-com">Fast-forward: 2 files changed (fix/discount)</div>
            <div><span class="sai-tok-str">~/platform-api</span> npm test</div>
            <div class="sai-tok-com">Tests: 42 passed, 42 total</div>
          </div>
        </div>
      </div>

      <div class="sai-window toolchain-illustration__desktop">
        <div class="sai-window__bar">Agenstra Desktop</div>
        <div class="d-flex flex-column gap-2 p-3 sai-body">
          <div class="d-flex align-items-center justify-content-between">
            <span class="fw-semibold">builder on platform-api</span>
            <fpc-badge color="success" variant="info" size="sm">Running</fpc-badge>
          </div>
          <div class="sai-tool"><i class="bi bi-pencil-square"></i>Edited <code>cart.ts</code></div>
          <div class="sai-tool"><i class="bi bi-terminal"></i><code>npm test</code>: 42 passed</div>
          <div class="sai-tool"><i class="bi bi-git"></i>Pushed <code>fix/discount</code></div>
          <div class="sai-bubble sai-bubble--agent">Branch is ready. Pull it locally to try the fix.</div>
          <div class="sai-bubble sai-bubble--user">Looks good, open the pull request.</div>
        </div>
      </div>
    </shared-app-illustration>
  `,
  styles: [
    `
      .toolchain-illustration__editor {
        top: 0;
        left: 0;
        width: 440px;
        height: 440px;
      }

      // The editor's built-in terminal panel.
      .toolchain-illustration__terminal {
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }

      .toolchain-illustration__terminal-tab {
        padding: 0.5rem 1rem;
        font-size: 0.75rem;
        color: var(--bs-secondary-color);
      }

      .toolchain-illustration__desktop {
        top: 0;
        left: 456px;
        width: 304px;
        height: 440px;
      }
    `,
  ],
})
export class ToolchainIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly code = [
    {
      no: 12,
      added: false,
      html: '<span class="sai-tok-key">export function</span> <span class="sai-tok-fn">cartTotal</span>(items, discount) {',
    },
    {
      no: 13,
      added: false,
      html: '  <span class="sai-tok-key">const</span> subtotal = <span class="sai-tok-fn">sum</span>(items);',
    },
    { no: 14, added: true, html: '  <span class="sai-tok-com">// Discount first, then round once.</span>' },
    {
      no: 15,
      added: true,
      html: '  <span class="sai-tok-key">return</span> <span class="sai-tok-fn">roundCents</span>(subtotal * (<span class="sai-tok-str">1</span> - discount));',
    },
    { no: 16, added: false, html: '}' },
    { no: 17, added: false, html: '' },
    {
      no: 18,
      added: false,
      html: '<span class="sai-tok-key">export function</span> <span class="sai-tok-fn">roundCents</span>(value) {',
    },
    {
      no: 19,
      added: false,
      html: '  <span class="sai-tok-key">return</span> Math.<span class="sai-tok-fn">round</span>(value * <span class="sai-tok-str">100</span>) / <span class="sai-tok-str">100</span>;',
    },
    { no: 20, added: false, html: '}' },
  ];
}
