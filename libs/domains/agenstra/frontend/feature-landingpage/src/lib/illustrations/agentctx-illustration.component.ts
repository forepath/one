import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** AgentCTX scene: the `.agenstra/` context in the repository and the assistant configs it keeps in sync. */
@Component({
  selector: 'framework-portal-agentctx-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <shared-app-illustration [label]="label()" address="app.agenstra.com/editor" [width]="1100" [height]="600">
      <section class="sai-col agentctx-illustration__tree">
        <fpc-lane-header title="Explorer" flush />
        <ul class="agentctx-illustration__files list-unstyled mb-0 py-2">
          @for (entry of files; track entry.name) {
            <li
              [class.agentctx-illustration__file--active]="entry.active"
              [class.agentctx-illustration__file--generated]="entry.generated"
              [style.padding-left.rem]="0.75 + entry.depth"
            >
              <i class="bi" [class]="entry.icon"></i>{{ entry.name }}
            </li>
          }
        </ul>
      </section>

      <section class="sai-col agentctx-illustration__targets">
        <fpc-lane-header title="Assistant configs" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (target of targets; track target.name) {
            <fpc-list-item>
              <span fpcListItemTitle>{{ target.name }}</span>
              <span fpcListItemMeta class="font-monospace">{{ target.file }}</span>
              <fpc-badge fpcListItemActions color="success" variant="info" size="sm">In sync</fpc-badge>
            </fpc-list-item>
          }
        </fpc-list>
        <div class="sai-tool m-3">
          <i class="bi bi-arrow-repeat"></i>Regenerated 2 configs from <code>.agenstra/</code>
        </div>
      </section>

      <section class="sai-col sai-col--grow">
        <div class="agentctx-illustration__tabs">
          <span class="agentctx-illustration__tab"><i class="bi bi-markdown"></i>security.md</span>
        </div>
        <div class="agentctx-illustration__doc sai-body">
          <p class="agentctx-illustration__h1"># Security</p>
          <p>Never commit secrets. Services read them from the vault at runtime.</p>
          <p class="agentctx-illustration__h2">## Never change automatically</p>
          <ul>
            <li>Database migrations in <code>db/migrations</code></li>
            <li>Payment provider configuration</li>
            <li>Authentication and session handling</li>
          </ul>
          <p class="agentctx-illustration__h2">## Needs a human review</p>
          <ul>
            <li>Major dependency upgrades</li>
            <li>Changes to access policies</li>
          </ul>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .agentctx-illustration__tree {
        flex: 0 0 15rem;
      }

      .agentctx-illustration__targets {
        flex: 0 0 17rem;
      }

      .agentctx-illustration__files {
        font-size: 0.8125rem;

        li {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.75rem;
          color: var(--bs-secondary-color);
        }
      }

      .agentctx-illustration__file--active {
        color: var(--bs-body-color) !important;
        background-color: color-mix(in srgb, var(--bs-primary) 14%, transparent);
      }

      .agentctx-illustration__file--generated {
        font-style: italic;
      }

      .agentctx-illustration__tabs {
        display: flex;
        background-color: var(--bs-tertiary-bg);
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .agentctx-illustration__tab {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.8125rem;
        background-color: var(--bs-body-bg);
        border-right: var(--bs-border-width) solid var(--bs-border-color);
        box-shadow: inset 0 2px 0 var(--bs-primary);
      }

      .agentctx-illustration__doc {
        padding: 1.25rem 1.5rem;
        font-family: var(--bs-font-monospace);
        font-size: 0.8125rem;
        line-height: 1.8;

        p,
        ul {
          margin-bottom: 0.5rem;
        }

        ul {
          padding-left: 1.25rem;
        }
      }

      .agentctx-illustration__h1,
      .agentctx-illustration__h2 {
        font-weight: 600;
        color: var(--bs-primary);
      }

      .agentctx-illustration__h1 {
        font-size: 1rem;
      }
    `,
  ],
})
export class AgentctxIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly files = [
    { name: '.agenstra', icon: 'bi-folder2-open', depth: 0, active: false, generated: false },
    { name: 'context', icon: 'bi-folder2-open', depth: 0.75, active: false, generated: false },
    { name: 'architecture.md', icon: 'bi-markdown', depth: 1.5, active: false, generated: false },
    { name: 'coding-style.md', icon: 'bi-markdown', depth: 1.5, active: false, generated: false },
    { name: 'security.md', icon: 'bi-markdown', depth: 1.5, active: true, generated: false },
    { name: 'documentation.md', icon: 'bi-markdown', depth: 1.5, active: false, generated: false },
    { name: '.github', icon: 'bi-folder2', depth: 0, active: false, generated: false },
    { name: 'copilot-instructions.md', icon: 'bi-markdown', depth: 0.75, active: false, generated: true },
    { name: 'AGENTS.md', icon: 'bi-markdown', depth: 0, active: false, generated: true },
    { name: 'opencode.json', icon: 'bi-filetype-json', depth: 0, active: false, generated: true },
  ];

  protected readonly targets = [
    { name: 'OpenCode', file: 'opencode.json, AGENTS.md' },
    { name: 'GitHub Copilot', file: 'copilot-instructions.md' },
  ];
}
