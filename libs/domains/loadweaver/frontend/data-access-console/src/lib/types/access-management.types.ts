/**
 * Access management (3.17): `GET|PUT|DELETE /cluster/members`, `/projects/{project}/members|settings|requests`,
 * `POST /projects/{project}/acceptances`, `GET /access/export` and `POST /access/import`.
 */
import type { ClusterRole, ProjectRole } from './console.types';

export const CLUSTER_ROLES: readonly ClusterRole[] = ['cluster-admin', 'infra-operator', 'auditor'];
export const PROJECT_ROLES: readonly ProjectRole[] = ['viewer', 'developer', 'operator', 'admin'];

/** `developers`: developer plans need an approval; `risky`: also plans with pins or exposure; `everyone`: four-eyes. */
export type ApprovalMode = 'developers' | 'risky' | 'everyone';
export const APPROVAL_MODES: readonly ApprovalMode[] = ['developers', 'risky', 'everyone'];

/** Cluster user ids are platform user ids (UUIDs). */
export const CLUSTER_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Project member ids (platform users, Keycloak subjects, …). */
export const PROJECT_USER_ID_PATTERN = /^[A-Za-z0-9@._:|-]{1,255}$/;

/** `GET /cluster/members`. */
export interface ClusterMember {
  userId: string;
  role: ClusterRole;
  createdBy: string | null;
  createdAt: string;
}

/** `GET /projects/{project}/members`. */
export interface ProjectMember {
  project: string;
  userId: string;
  role: ProjectRole;
  createdBy: string | null;
  createdAt: string;
}

/** `GET|PUT /projects/{project}/settings`. */
export interface ProjectSettings {
  project: string;
  approvalMode: ApprovalMode;
  developerExec: boolean;
  recordTerminals: boolean;
  createdBy: string | null;
}

export type ProjectSettingsPatch = Partial<Pick<ProjectSettings, 'approvalMode' | 'developerExec' | 'recordTerminals'>>;

/** `GET /projects/{project}/requests`: another project's policy reaching into this one (`peer`). */
export interface CrossProjectRequest {
  /** The requesting project. */
  project: string;
  policy: string;
  /** The project asked to accept (the one whose requests are listed). */
  peer: string;
  specHash: string;
  /** Pending plan proposing it; null for an applied policy. */
  planId: string | null;
  accepted: boolean;
}

/** Everything about one project's access the console shows together. */
export interface ProjectAccess {
  project: string;
  members: ProjectMember[];
  settings: ProjectSettings;
  requests: CrossProjectRequest[];
}

/** `POST /access/import`. */
export interface AccessImportResult {
  changed: number;
}

/** What an export is for: a file download or the import editor. */
export type AccessExportTarget = 'download' | 'editor';
