import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** Desktop hero scene: connected agent managers, an agent's live activity and a terminal. */
@Component({
  selector: 'framework-portal-desktop-illustration',
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
    <shared-app-illustration [label]="label()" windowTitle="Agenstra Desktop" [width]="960" [height]="640">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-robot"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-hdd-network"></i></span>
        <span class="sai-rail__item"><i class="bi bi-chat-square-text"></i></span>
        <span class="sai-rail__item"><i class="bi bi-terminal"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col desktop-illustration__connections">
        <fpc-lane-header title="Connections" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (connection of connections; track connection.name) {
            <fpc-list-item [active]="connection.active">
              <span fpcListItemTitle>{{ connection.name }}</span>
              <span fpcListItemMeta>{{ connection.host }}</span>
              <fpc-badge fpcListItemActions [color]="connection.color" variant="info" size="sm">{{
                connection.state
              }}</fpc-badge>
            </fpc-list-item>
          }
        </fpc-list>
      </section>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle>reviewer on production</span>
          <fpc-badge fpcLaneHeaderActions color="success" variant="info" size="sm">Running</fpc-badge>
        </fpc-lane-header>
        <div class="sai-body d-flex flex-column gap-2 p-3">
          <div class="sai-tool"><i class="bi bi-eye"></i>Reviewing pull request <code>#128</code></div>
          <div class="sai-tool"><i class="bi bi-file-earmark-diff"></i>Read 3 changed files</div>
          <div class="sai-tool"><i class="bi bi-chat-left-text"></i>Left 2 review comments</div>
          <div class="sai-bubble sai-bubble--agent">
            Looks good. One suggestion: cover the zero discount case in the new test.
          </div>
        </div>
        <div class="desktop-illustration__terminal sai-code">
          <div><span class="sai-tok-str">agent@production</span>:~/platform-api$ npm test</div>
          <div class="sai-tok-com">Test Suites: 12 passed, 12 total</div>
          <div class="sai-tok-com">Tests: 42 passed, 42 total</div>
          <div><span class="sai-tok-str">agent@production</span>:~/platform-api$ <span class="desktop-illustration__caret"></span></div>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .desktop-illustration__connections {
        flex: 0 0 20rem;
      }

      .desktop-illustration__terminal {
        padding: 0.75rem 1rem;
        line-height: 1.6;
        color: var(--bs-body-color);
        background-color: var(--bs-tertiary-bg);
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }

      .desktop-illustration__caret {
        display: inline-block;
        width: 0.5rem;
        height: 1rem;
        vertical-align: text-bottom;
        background-color: var(--bs-body-color);
        animation: desktop-illustration-caret 1s steps(1) infinite;
      }

      @keyframes desktop-illustration-caret {
        50% {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .desktop-illustration__caret {
          animation: none;
        }
      }
    `,
  ],
})
export class DesktopIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly connections = [
    { name: 'Production', host: 'agents.example.com', state: 'Connected', color: 'success' as const, active: true },
    { name: 'Staging', host: 'staging.example.com', state: 'Connected', color: 'success' as const, active: false },
    { name: 'Workstation', host: 'localhost:3100', state: 'Offline', color: 'secondary' as const, active: false },
  ];
}
