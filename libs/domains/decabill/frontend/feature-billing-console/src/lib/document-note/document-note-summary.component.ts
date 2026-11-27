import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { FpcLaneHeaderComponent } from '@forepath/shared/frontend/ui-components';

/** Read-only document note for invoice and offer details. Renders nothing without a note. */
@Component({
  selector: 'framework-document-note-summary',
  standalone: true,
  imports: [FpcLaneHeaderComponent],
  templateUrl: './document-note-summary.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ['.document-note-summary__text { white-space: pre-line; }'],
})
export class DocumentNoteSummaryComponent {
  @Input() note: string | null | undefined = null;

  get text(): string | null {
    return this.note?.trim() || null;
  }
}
