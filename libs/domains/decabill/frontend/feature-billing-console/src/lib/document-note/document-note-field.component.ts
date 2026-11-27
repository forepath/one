import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DOCUMENT_NOTE_MAX_LENGTH } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcFormControlComponent, FpcFormFieldComponent } from '@forepath/shared/frontend/ui-components';

/**
 * Optional free-text document note for invoice, credit note and offer forms. The note is printed on the PDF and
 * embedded in the e-invoice XML (EN 16931 invoice note, BT-22).
 */
@Component({
  selector: 'framework-document-note-field',
  standalone: true,
  imports: [FormsModule, FpcFormFieldComponent, FpcFormControlComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './document-note-field.component.html',
})
export class DocumentNoteFieldComponent {
  @Input() value = '';
  @Output() readonly valueChange = new EventEmitter<string>();
  /** Control id (unique per page). */
  @Input() controlId = 'documentNote';
  @Input() label = $localize`:@@featureDocumentNote-label:Note (optional)`;
  @Input() hint = $localize`:@@featureDocumentNote-hint:Printed on the document and embedded in its e-invoice data.`;
  @Input() disabled = false;
  @Input() rows = 3;

  readonly maxLength = DOCUMENT_NOTE_MAX_LENGTH;

  onValueChange(value: string): void {
    this.value = value;
    this.valueChange.emit(value);
  }
}
