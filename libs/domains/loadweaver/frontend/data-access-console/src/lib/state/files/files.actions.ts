import { createAction, props } from '@ngrx/store';

import type { LiveFileEntry, LiveFileOperation, LiveFileTarget } from '../../types/live.types';

/** Lists a directory of a replica's filesystem or a volume. */
export const openFilesDirectory = createAction(
  '[ConsoleFiles] Open Directory',
  props<{ target: LiveFileTarget; path: string }>(),
);
export const openFilesDirectorySuccess = createAction(
  '[ConsoleFiles] Open Directory Success',
  props<{ target: LiveFileTarget; path: string; entries: LiveFileEntry[] }>(),
);
export const openFilesDirectoryFailure = createAction(
  '[ConsoleFiles] Open Directory Failure',
  props<{ target: LiveFileTarget; path: string; error: string }>(),
);
/** Lists the current directory again. */
export const refreshFiles = createAction('[ConsoleFiles] Refresh');

export const runFileOperation = createAction(
  '[ConsoleFiles] Run Operation',
  props<{ target: LiveFileTarget; operation: LiveFileOperation }>(),
);
export const fileOperationSuccess = createAction(
  '[ConsoleFiles] Operation Success',
  props<{ operation: LiveFileOperation; warning: string | null }>(),
);
export const fileOperationFailure = createAction('[ConsoleFiles] Operation Failure', props<{ error: string }>());

/** `X-Loadweaver-Warning` of a write done outside the slice (uploads). */
export const setFilesWarning = createAction('[ConsoleFiles] Set Warning', props<{ warning: string | null }>());
export const dismissFilesMessages = createAction('[ConsoleFiles] Dismiss Messages');
