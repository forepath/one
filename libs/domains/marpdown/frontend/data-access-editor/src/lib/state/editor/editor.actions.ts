import { createAction, props } from '@ngrx/store';

export const openEditor = createAction('[Editor] Open Editor', props<{ presentationId: string }>());

export const closeEditor = createAction('[Editor] Close Editor');

export const setEditorMarkdown = createAction('[Editor] Set Markdown', props<{ markdown: string }>());

export const resetEditorMarkdown = createAction('[Editor] Reset Markdown', props<{ markdown: string }>());

export const saveEditor = createAction('[Editor] Save');

export const saveEditorSuccess = createAction('[Editor] Save Success', props<{ markdown: string }>());

export const saveEditorFailure = createAction('[Editor] Save Failure', props<{ error: string }>());

export const importEditorMarkdown = createAction('[Editor] Import Markdown', props<{ markdown: string }>());

export const importEditorSuccess = createAction('[Editor] Import Success', props<{ markdown: string }>());

export const importEditorFailure = createAction('[Editor] Import Failure', props<{ error: string }>());
