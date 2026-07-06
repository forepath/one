import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  closeEditor,
  importEditorMarkdown,
  openEditor,
  resetEditorMarkdown,
  saveEditor,
  setEditorMarkdown,
} from './editor.actions';
import {
  selectEditorError,
  selectEditorImporting,
  selectEditorIsDirty,
  selectEditorLoadingAny,
  selectEditorMarkdown,
  selectEditorPresentationId,
  selectEditorSavedMarkdown,
  selectEditorSaving,
} from './editor.selectors';

@Injectable({
  providedIn: 'root',
})
export class EditorFacade {
  private readonly store = inject(Store);

  readonly presentationId$: Observable<string | null> = this.store.select(selectEditorPresentationId);
  readonly markdown$: Observable<string> = this.store.select(selectEditorMarkdown);
  readonly savedMarkdown$: Observable<string> = this.store.select(selectEditorSavedMarkdown);
  readonly isDirty$: Observable<boolean> = this.store.select(selectEditorIsDirty);
  readonly saving$: Observable<boolean> = this.store.select(selectEditorSaving);
  readonly importing$: Observable<boolean> = this.store.select(selectEditorImporting);
  readonly loadingAny$: Observable<boolean> = this.store.select(selectEditorLoadingAny);
  readonly error$: Observable<string | null> = this.store.select(selectEditorError);

  openEditor(presentationId: string): void {
    this.store.dispatch(openEditor({ presentationId }));
  }

  closeEditor(): void {
    this.store.dispatch(closeEditor());
  }

  setMarkdown(markdown: string): void {
    this.store.dispatch(setEditorMarkdown({ markdown }));
  }

  resetMarkdown(markdown: string): void {
    this.store.dispatch(resetEditorMarkdown({ markdown }));
  }

  save(): void {
    this.store.dispatch(saveEditor());
  }

  importMarkdown(markdown: string): void {
    this.store.dispatch(importEditorMarkdown({ markdown }));
  }
}
