import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { EditorState } from './editor.reducer';

export const selectEditorState = createFeatureSelector<EditorState>('editor');

export const selectEditorPresentationId = createSelector(selectEditorState, (state) => state.presentationId);

export const selectEditorMarkdown = createSelector(selectEditorState, (state) => state.markdown);

export const selectEditorSavedMarkdown = createSelector(selectEditorState, (state) => state.savedMarkdown);

export const selectEditorIsDirty = createSelector(
  selectEditorMarkdown,
  selectEditorSavedMarkdown,
  (markdown, savedMarkdown) => markdown !== savedMarkdown,
);

export const selectEditorSaving = createSelector(selectEditorState, (state) => state.saving);

export const selectEditorImporting = createSelector(selectEditorState, (state) => state.importing);

export const selectEditorError = createSelector(selectEditorState, (state) => state.error);

export const selectEditorLoadingAny = createSelector(
  selectEditorSaving,
  selectEditorImporting,
  (saving, importing) => saving || importing,
);
