import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** Hero scene: workspaces, their agents and an agent chat that runs tests and opens a PR. */
@Component({
  selector: 'framework-portal-console-illustration',
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
    <shared-app-illustration [label]="label()" address="app.agenstra.com/clients" [width]="1200" [height]="680">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-robot"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-chat-square-text"></i></span>
        <span class="sai-rail__item"><i class="bi bi-kanban"></i></span>
        <span class="sai-rail__item"><i class="bi bi-journal-text"></i></span>
        <span class="sai-rail__item"><i class="bi bi-graph-up"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col console-illustration__workspaces">
        <fpc-lane-header title="Workspaces" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (workspace of workspaces; track workspace.name) {
            <fpc-list-item [active]="workspace.active">
              <span fpcListItemTitle>{{ workspace.name }}</span>
              <span fpcListItemMeta>{{ workspace.meta }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>

      <section class="sai-col console-illustration__agents">
        <fpc-lane-header title="Agents" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (agent of agents; track agent.name) {
            <fpc-list-item [active]="agent.active">
              <span fpcListItemTitle>{{ agent.name }}</span>
              <span fpcListItemMeta>{{ agent.model }}</span>
              <fpc-badge fpcListItemActions [color]="agent.color" variant="info" size="sm">{{ agent.state }}</fpc-badge>
            </fpc-list-item>
          }
        </fpc-list>
      </section>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle>builder</span>
          <fpc-badge fpcLaneHeaderActions color="success" variant="info" size="sm">Running</fpc-badge>
        </fpc-lane-header>
        <div class="sai-body d-flex flex-column gap-3 p-4">
          <div class="sai-bubble sai-bubble--user">Fix the flaky checkout test and open a pull request.</div>
          <div class="sai-bubble sai-bubble--agent">
            The cart total was rounded before the discount was applied. I will fix the order and add a regression test.
          </div>
          <div class="d-flex flex-column gap-2">
            <div class="sai-tool"><i class="bi bi-pencil-square"></i>Edited <code>src/checkout/cart.ts</code></div>
            <div class="sai-tool"><i class="bi bi-terminal"></i>Ran <code>npm test</code>: 42 passed</div>
            <div class="sai-tool">
              <i class="bi bi-git"></i>Opened pull request <code>#128 Fix discount rounding</code>
            </div>
          </div>
          <div class="sai-bubble sai-bubble--agent">
            <span class="sai-typing"><i></i><i></i><i></i></span>
          </div>
        </div>
        <div class="sai-input">
          Message builder or type / for commands
          <span class="sai-input__send"><i class="bi bi-send"></i></span>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .console-illustration__workspaces {
        flex: 0 0 15rem;
      }

      .console-illustration__agents {
        flex: 0 0 16rem;
      }
    `,
  ],
})
export class ConsoleIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly workspaces = [
    { name: 'platform-api', meta: '3 agents', active: true },
    { name: 'web-app', meta: '2 agents', active: false },
    { name: 'data-pipeline', meta: '1 agent', active: false },
    { name: 'docs', meta: 'No agents yet', active: false },
  ];

  protected readonly agents = [
    { name: 'builder', model: 'claude-opus-5-5', state: 'Running', color: 'success' as const, active: true },
    { name: 'reviewer', model: 'claude-sonnet-5-5', state: 'Idle', color: 'secondary' as const, active: false },
    { name: 'release', model: 'claude-haiku-5-5', state: 'Idle', color: 'secondary' as const, active: false },
  ];
}
