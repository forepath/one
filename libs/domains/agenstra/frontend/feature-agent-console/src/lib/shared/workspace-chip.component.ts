import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

/**
 * Current-workspace chip of the tickets / knowledge (Pages) / tasks boards: a quiet button whose badge (building icon +
 * workspace name) opens the workspace switch. The fill is the tertiary background shifted towards the emphasis colour
 * (darker in light mode, lighter in dark mode), no border, so it stands out on the tertiary page header in both
 * themes (user, 2026-10-29).
 */
@Component({
  selector: 'framework-workspace-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcButtonComponent],
  template: `
    <fpc-button
      variant="link"
      btnClass="text-decoration-none text-body ps-0"
      class="framework-workspace-chip__btn"
      [title]="title()"
      (clicked)="switch.emit()"
      data-testid="workspace-chip"
    >
      <fpc-badge variant="info" color="secondary" class="framework-workspace-chip__badge">
        <i class="bi bi-building" aria-hidden="true"></i>
        <span class="text-truncate framework-workspace-chip__label">{{ name() }}</span>
      </fpc-badge>
    </fpc-button>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      /* Title → chip = the header's own inset (headline → box border, 1rem): the header's 0.5rem context gap plus this
         0.5rem, with no leading button padding (\`ps-0\`) (user, 2026-10-29). */
      margin-inline-start: calc(var(--fpc-edge-inset, 1rem) - 0.5rem);
    }

    .framework-workspace-chip__btn {
      max-width: 100%;
    }

    .framework-workspace-chip__badge {
      max-width: min(20rem, 70vw);
    }

    /* Must out-rank the badge's own \`:host(.fpc-badge--info.fpc-badge--secondary)\` tertiary fill / border, which
       otherwise wins and the chip blends into the tertiary page header again. */
    .framework-workspace-chip__btn .framework-workspace-chip__badge.fpc-badge--info.fpc-badge--secondary {
      background-color: color-mix(in srgb, var(--bs-tertiary-bg) 86%, var(--bs-emphasis-color));
      border-color: transparent;
      color: var(--bs-emphasis-color);
    }

    .framework-workspace-chip__label {
      min-width: 0;
    }
  `,
})
export class WorkspaceChipComponent {
  /** Display name of the current workspace. */
  readonly name = input.required<string>();
  /** Tooltip of the chip (e.g. "Switch workspace"). */
  readonly title = input<string>('');
  /** The chip was clicked: open the workspace switch. */
  readonly switch = output<void>();
}
