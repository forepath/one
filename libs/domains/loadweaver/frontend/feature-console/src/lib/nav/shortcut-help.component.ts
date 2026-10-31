import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FpcModalComponent } from '@forepath/shared/frontend/ui-components';

import { CONSOLE_SHORTCUT_GROUPS } from './shortcuts';

/** The `?` overlay (3.37): every console shortcut, grouped (everywhere, go-to chords, object pages, palette). */
@Component({
  selector: 'loadweaver-shortcut-help',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcModalComponent],
  styles: `
    /* Keys | action in two columns sized to the keys (was col-5 / col-7: the actions started mid-dialog). Group
       titles in the sub-nav group style. */
    .lw-shortcuts__title {
      margin: 0 0 0.375rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--bs-secondary-color);
    }

    .lw-shortcuts__list {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: 1.5rem;
      row-gap: 0.375rem;
      align-items: baseline;
    }
  `,
  template: `
    <fpc-modal [(open)]="open" [title]="title" size="md" [scrollable]="true">
      <div class="d-flex flex-column gap-3" data-testid="shortcut-help">
        @for (group of groups; track group.id) {
          <section [attr.aria-label]="group.title">
            <h3 class="lw-shortcuts__title">{{ group.title }}</h3>
            <dl class="lw-shortcuts__list small mb-0">
              @for (entry of group.entries; track entry.label) {
                <dt class="fw-normal text-nowrap">
                  @for (key of entry.keys; track $index) {
                    @if (!$first) {
                      <span class="text-body-secondary mx-1">{{
                        entry.join === 'sequence' ? thenLabel : entry.join === 'alternatives' ? orLabel : '+'
                      }}</span>
                    }
                    <kbd>{{ key }}</kbd>
                  }
                </dt>
                <dd class="mb-0">{{ entry.label }}</dd>
              }
            </dl>
          </section>
        }
      </div>
    </fpc-modal>
  `,
})
export class LoadweaverShortcutHelpComponent {
  readonly open = model(false);
  readonly groups = CONSOLE_SHORTCUT_GROUPS;
  readonly title = $localize`:@@lwConsoleShortcuts-title:Keyboard shortcuts`;
  readonly thenLabel = $localize`:@@lwConsoleShortcuts-then:then`;
  readonly orLabel = $localize`:@@lwConsoleShortcuts-or:or`;
}
