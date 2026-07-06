import { createReducer, on } from '@ngrx/store';

import { loadPresentationSuccess, updatePresentationSuccess, importPresentationMarkdownSuccess } from '../presentations/presentations.actions';

import {
  closeEditor,
  importEditorFailure,
  importEditorSuccess,
  importEditorMarkdown,
  openEditor,
  resetEditorMarkdown,
  saveEditor,
  saveEditorFailure,
  saveEditorSuccess,
  setEditorMarkdown,
} from './editor.actions';

export interface EditorState {
  presentationId: string | null;
  markdown: string;
  savedMarkdown: string;
  saving: boolean;
  importing: boolean;
  error: string | null;
}

export const initialEditorState: EditorState = {
  presentationId: null,
  markdown: '',
  savedMarkdown: '',
  saving: false,
  importing: false,
  error: null,
};

export const editorReducer = createReducer(
  initialEditorState,
  on(openEditor, (state, { presentationId }) => ({
    ...state,
    presentationId,
    error: null,
  })),
  on(closeEditor, () => initialEditorState),
  on(setEditorMarkdown, (state, { markdown }) => ({
    ...state,
    markdown,
    error: null,
  })),
  on(resetEditorMarkdown, (state, { markdown }) => ({
    ...state,
    markdown,
    savedMarkdown: markdown,
    error: null,
  })),
  on(saveEditor, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(saveEditorSuccess, (state, { markdown }) => ({
    ...state,
    markdown,
    savedMarkdown: markdown,
    saving: false,
    error: null,
  })),
  on(saveEditorFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(importEditorMarkdown, (state) => ({
    ...state,
    importing: true,
    error: null,
  })),
  on(importEditorSuccess, (state, { markdown }) => ({
    ...state,
    markdown,
    savedMarkdown: markdown,
    importing: false,
    error: null,
  })),
  on(importEditorFailure, (state, { error }) => ({
    ...state,
    importing: false,
    error,
  })),
  on(loadPresentationSuccess, (state, { presentation }) => {
    if (state.presentationId !== presentation.id) {
      return state;
    }

    return {
      ...state,
      markdown: presentation.markdown,
      savedMarkdown: presentation.markdown,
      error: null,
    };
  }),
  on(updatePresentationSuccess, importPresentationMarkdownSuccess, (state, { presentation }) => {
    if (state.presentationId !== presentation.id) {
      return state;
    }

    return {
      ...state,
      markdown: presentation.markdown,
      savedMarkdown: presentation.markdown,
      saving: false,
      importing: false,
      error: null,
    };
  }),
);
