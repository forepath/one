import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

import {
  DEFAULT_PRESENTATION_EDITOR_MODE,
  type PresentationEditorMode,
} from './presentation-editor-mode';

@Injectable({
  providedIn: 'root',
})
export class PresentationEditorModeService {
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = 'marpdown-presentation-editor-mode';

  readonly mode = signal<PresentationEditorMode>(this.readStoredMode());

  setMode(mode: PresentationEditorMode): void {
    this.mode.set(mode);
    this.document.defaultView?.localStorage?.setItem(this.storageKey, mode);
  }

  private readStoredMode(): PresentationEditorMode {
    const stored = this.document.defaultView?.localStorage?.getItem(this.storageKey);

    if (stored === 'monaco' || stored === 'milkdown') {
      return stored;
    }

    return DEFAULT_PRESENTATION_EDITOR_MODE;
  }
}
