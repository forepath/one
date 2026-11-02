import { createAction, props } from '@ngrx/store';

import type {
  AccessExportTarget,
  AccessImportResult,
  ClusterMember,
  CrossProjectRequest,
  ProjectAccess,
  ProjectSettings,
  ProjectSettingsPatch,
} from '../../types/access-management.types';
import type { ClusterRole, ProjectRole } from '../../types/console.types';

/** Projects the caller can pick (memberships plus, for cluster roles, every `Project` resource). */
export const loadAccessProjects = createAction('[ConsoleAccessManagement] Load Projects');
export const loadAccessProjectsSuccess = createAction(
  '[ConsoleAccessManagement] Load Projects Success',
  props<{ projects: string[] }>(),
);

export const loadClusterMembers = createAction('[ConsoleAccessManagement] Load Cluster Members');
export const loadClusterMembersSuccess = createAction(
  '[ConsoleAccessManagement] Load Cluster Members Success',
  props<{ members: ClusterMember[] }>(),
);
export const loadClusterMembersFailure = createAction(
  '[ConsoleAccessManagement] Load Cluster Members Failure',
  props<{ error: string }>(),
);

export const setClusterMember = createAction(
  '[ConsoleAccessManagement] Set Cluster Member',
  props<{ userId: string; role: ClusterRole }>(),
);
export const removeClusterMember = createAction(
  '[ConsoleAccessManagement] Remove Cluster Member',
  props<{ userId: string }>(),
);

export const loadProjectAccess = createAction(
  '[ConsoleAccessManagement] Load Project',
  props<{ project: string; silent?: boolean }>(),
);
export const loadProjectAccessSuccess = createAction(
  '[ConsoleAccessManagement] Load Project Success',
  props<{ access: ProjectAccess }>(),
);
export const loadProjectAccessFailure = createAction(
  '[ConsoleAccessManagement] Load Project Failure',
  props<{ project: string; error: string }>(),
);

export const setProjectMember = createAction(
  '[ConsoleAccessManagement] Set Project Member',
  props<{ project: string; userId: string; role: ProjectRole }>(),
);
export const removeProjectMember = createAction(
  '[ConsoleAccessManagement] Remove Project Member',
  props<{ project: string; userId: string }>(),
);

export const updateProjectSettings = createAction(
  '[ConsoleAccessManagement] Update Settings',
  props<{ project: string; patch: ProjectSettingsPatch }>(),
);
export const updateProjectSettingsSuccess = createAction(
  '[ConsoleAccessManagement] Update Settings Success',
  props<{ settings: ProjectSettings }>(),
);

export const acceptCrossProjectRequest = createAction(
  '[ConsoleAccessManagement] Accept Request',
  props<{ project: string; request: CrossProjectRequest }>(),
);

/** A membership change / acceptance went through (the affected list is reloaded). */
export const accessChangeSuccess = createAction('[ConsoleAccessManagement] Change Success');
export const accessChangeFailure = createAction('[ConsoleAccessManagement] Change Failure', props<{ error: string }>());
export const clearAccessChangeError = createAction('[ConsoleAccessManagement] Clear Change Error');

export const exportAccess = createAction('[ConsoleAccessManagement] Export', props<{ target: AccessExportTarget }>());
export const exportAccessSuccess = createAction(
  '[ConsoleAccessManagement] Export Success',
  props<{ yaml: string; target: AccessExportTarget }>(),
);
export const exportAccessFailure = createAction('[ConsoleAccessManagement] Export Failure', props<{ error: string }>());
/** The exported YAML was handed over (downloaded or put into the editor). */
export const clearAccessExport = createAction('[ConsoleAccessManagement] Clear Export');

export const importAccess = createAction('[ConsoleAccessManagement] Import', props<{ yaml: string }>());
export const importAccessSuccess = createAction(
  '[ConsoleAccessManagement] Import Success',
  props<{ result: AccessImportResult }>(),
);
export const importAccessFailure = createAction('[ConsoleAccessManagement] Import Failure', props<{ error: string }>());
export const clearAccessImport = createAction('[ConsoleAccessManagement] Clear Import');
