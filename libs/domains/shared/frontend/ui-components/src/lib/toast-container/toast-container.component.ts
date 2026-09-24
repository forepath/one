import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcToastPlacement =
  | 'top-start'
  | 'top-center'
  | 'top-end'
  | 'middle-center'
  | 'bottom-start'
  | 'bottom-center'
  | 'bottom-end';

const PLACEMENT_CLASSES: Record<FpcToastPlacement, string> = {
  'top-start': 'top-0 start-0',
  'top-center': 'top-0 start-50 translate-middle-x',
  'top-end': 'top-0 end-0',
  'middle-center': 'top-50 start-50 translate-middle',
  'bottom-start': 'bottom-0 start-0',
  'bottom-center': 'bottom-0 start-50 translate-middle-x',
  'bottom-end': 'bottom-0 end-0',
};

/** Fixed-position stack host for one or more `fpc-toast` children. */
@Component({
  selector: 'fpc-toast-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-toast-container' },
  template: `
    <div [class]="containerClasses()" aria-live="polite" aria-atomic="true">
      <ng-content />
    </div>
  `,
  styleUrl: './toast-container.component.scss',
})
export class FpcToastContainerComponent {
  readonly placement = input<FpcToastPlacement>('bottom-end');
  /** Fixed to the viewport; set to `false` to anchor inside a positioned ancestor instead. */
  readonly fixed = input(true);

  protected readonly containerClasses = computed(() =>
    [
      'toast-container',
      'fpc-toast-container__stack',
      this.fixed() ? 'position-fixed' : 'position-absolute',
      PLACEMENT_CLASSES[this.placement()],
      'p-3',
    ].join(' '),
  );
}
