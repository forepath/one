import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { FPC_CONTROL_SIZE } from '../control-size/control-size';

export type FpcInputGroupSize = 'sm' | 'md' | 'lg';

/**
 * Bootstrap input group. Mark projected add-ons with `fpcInputGroupPrefix` / `fpcInputGroupSuffix`
 * so they land on the correct side; everything else is projected between them.
 */
@Component({
  selector: 'fpc-input-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-input-group' },
  template: `
    <div [class]="groupClasses()">
      <ng-content select="[fpcInputGroupPrefix]" />
      <ng-content />
      <ng-content select="[fpcInputGroupSuffix]" />
    </div>
  `,
  styleUrl: './input-group.component.scss',
})
export class FpcInputGroupComponent {
  private readonly defaultSize = inject(FPC_CONTROL_SIZE);

  /** Defaults to `FPC_CONTROL_SIZE` (`xl` contexts fall back to `lg`); projected controls and buttons resolve the same tier. */
  readonly size = input<FpcInputGroupSize | undefined>(undefined);
  readonly bordered = input(true);

  protected readonly groupClasses = computed(() => {
    const classes = ['input-group', 'fpc-input-group__group'];
    const size = this.size() ?? (this.defaultSize === 'xl' ? 'lg' : this.defaultSize);

    if (size === 'sm' || size === 'lg') {
      classes.push(`input-group-${size}`);
    }

    if (!this.bordered()) {
      classes.push('fpc-input-group__group--borderless');
    }

    return classes.join(' ');
  });
}
