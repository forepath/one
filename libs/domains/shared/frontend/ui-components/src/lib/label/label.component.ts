import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Bootstrap form label with optional required marker. Prefer `fpc-form-field` when hints/errors are needed. */
@Component({
  selector: 'fpc-label',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-label' },
  template: `
    <label class="form-label" [attr.for]="forId()">
      <ng-content />
      @if (required()) {
        <span class="fpc-label__required text-danger" aria-hidden="true">*</span>
        <span class="visually-hidden">{{ requiredText() }}</span>
      }
    </label>
  `,
  styleUrl: './label.component.scss',
})
export class FpcLabelComponent {
  /** `for` attribute of the rendered label; must match the control id. */
  readonly forId = input<string | null>(null);
  readonly required = input(false);
  /** Screen-reader text appended after the asterisk. */
  readonly requiredText = input('required');
}
