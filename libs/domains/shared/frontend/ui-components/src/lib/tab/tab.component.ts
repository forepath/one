import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

/**
 * A single tab. Used standalone for the panel markup, or (more commonly) projected into
 * `fpc-tab-group`, which renders the tab buttons and drives `active`.
 *
 * `id` is not `input.required` because `fpc-tab-group` reads it via `contentChildren`, which can
 * surface the instance before bindings are applied (NG0950). Always pass a stable id in templates.
 */
@Component({
  selector: 'fpc-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-tab',
    '[attr.role]': '"tabpanel"',
    '[attr.id]': 'panelId()',
    '[attr.aria-labelledby]': 'labelledBy()',
    '[hidden]': '!active()',
  },
  template: `
    @if (active()) {
      <ng-content />
    }
  `,
  styleUrl: './tab.component.scss',
})
export class FpcTabComponent {
  readonly id = input('');
  readonly label = input('');
  readonly icon = input<string | null>(null);
  /** Optional vertical-nav section heading (grouped with consecutive tabs sharing the same value). */
  readonly section = input<string | null>(null);
  readonly active = model(false);
  readonly disabled = input(false);

  /**
   * Optional Bootstrap Icons name for a trailing action on the tab button row
   * (e.g. `lock-fill`). When null/empty, no action is rendered.
   */
  readonly actionIcon = input<string | null>(null);
  /** Accessible name for the trailing action button. */
  readonly actionAriaLabel = input('');
  /** Optional pressed/active state for toggle-style actions. */
  readonly actionPressed = input(false);
  /** Title/tooltip for the trailing action. */
  readonly actionTitle = input('');

  readonly selected = output<string>();
  /** Emitted when the trailing tab action is activated (does not select the tab). */
  readonly action = output<void>();

  /** Host id once `id` is bound; null while empty so we do not emit a bare prefix. */
  protected readonly panelId = computed(() => {
    const id = this.id();

    return id ? `fpc-tabpanel-${id}` : null;
  });

  protected readonly labelledBy = computed(() => {
    const id = this.id();

    return id ? `fpc-tab-${id}` : null;
  });

  select(): void {
    if (this.disabled() || !this.id()) {
      return;
    }

    this.active.set(true);
    this.selected.emit(this.id());
  }
}
