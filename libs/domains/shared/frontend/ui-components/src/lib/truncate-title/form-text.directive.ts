import { Directive, inject } from '@angular/core';

import { FPC_CONTROL_SIZE } from '../control-size/control-size';
import { FpcTruncateTitleDirective } from './truncate-title.directive';

/**
 * Subtexts of fields and form sections (`.form-text` hints, `.invalid-feedback` errors) follow the label concept: one
 * line, ellipsized, full text on hover, one text step below the tier's label (`FPC_CONTROL_SIZE`: `sm` behind an auth
 * guard). Matches the classes, so importing it is all a template needs; single-line styles are global
 * (`styles/_controls.scss`). Form-section descriptions add `fpc-form-text--wrap` and wrap instead (no tooltip needed).
 */
@Directive({
  // Class selector on purpose: every Bootstrap subtext in an importing template follows the concept, no extra markup.
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '.form-text, .invalid-feedback',
  standalone: true,
  hostDirectives: [FpcTruncateTitleDirective],
  host: { '[class.fpc-form-text--sm]': 'compact' },
})
export class FpcFormTextDirective {
  protected readonly compact = inject(FPC_CONTROL_SIZE) === 'sm';
}
