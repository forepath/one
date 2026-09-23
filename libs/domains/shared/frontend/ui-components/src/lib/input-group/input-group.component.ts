import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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
  readonly size = input<FpcInputGroupSize>('md');
  readonly bordered = input(true);

  protected readonly groupClasses = computed(() => {
    const classes = ['input-group', 'fpc-input-group__group'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`input-group-${size}`);
    }

    if (!this.bordered()) {
      classes.push('fpc-input-group__group--borderless');
    }

    return classes.join(' ');
  });
}
