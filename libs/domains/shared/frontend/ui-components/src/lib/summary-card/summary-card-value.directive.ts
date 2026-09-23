import { Directive } from '@angular/core';

/**
 * Marks projected summary-card value content and applies the shared metric typography
 * (`fs-4` + `fw-semibold`) so callers do not need to repeat utility classes.
 */
@Directive({
  selector: '[fpcSummaryCardValue]',
  standalone: true,
  host: { class: 'fs-4 fw-semibold' },
})
export class FpcSummaryCardValueDirective {}
