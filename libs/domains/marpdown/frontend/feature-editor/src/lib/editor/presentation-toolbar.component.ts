import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { ExportFormat } from '@forepath/marpdown/marpdown/shared';

import { type PresentationEditorMode } from './presentation-editor-mode';
import { PresentationEditorModeService } from './presentation-editor-mode.service';

@Component({
  selector: 'marpdown-presentation-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation-toolbar.component.html',
  styleUrls: ['./presentation-toolbar.component.scss'],
})
export class PresentationToolbarComponent {
  private readonly editorModeService = inject(PresentationEditorModeService);

  @Input() title = 'Presentation';
  @Input() isDirty = false;
  @Input() saving = false;
  @Input() importing = false;
  @Input() exporting = false;
  @Input() persistenceEnabled = true;

  @Output() save = new EventEmitter<void>();
  @Output() importMarkdown = new EventEmitter<void>();
  @Output() exportPdf = new EventEmitter<void>();
  @Output() exportPptx = new EventEmitter<void>();
  @Output() undo = new EventEmitter<void>();
  @Output() redo = new EventEmitter<void>();
  @Output() present = new EventEmitter<void>();

  readonly ExportFormat = ExportFormat;
  readonly editorMode = this.editorModeService.mode;

  setEditorMode(mode: PresentationEditorMode): void {
    this.editorModeService.setMode(mode);
  }
}
