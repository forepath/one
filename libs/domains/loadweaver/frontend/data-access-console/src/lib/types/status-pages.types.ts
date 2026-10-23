/** Status pages and incident notes (3.25): `StatusPage` resources and `/projects/{project}/incidents`. */

import type { ConsoleResource } from './resources.types';

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export const INCIDENT_STATUSES: readonly IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

export interface IncidentUpdate {
  at: string;
  status: IncidentStatus;
  message: string;
  by?: string | null;
}

export interface Incident {
  id: string;
  project: string;
  title: string;
  status: IncidentStatus;
  /** Oldest first. */
  updates: IncidentUpdate[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** `POST /projects/{project}/incidents`. */
export interface CreateIncident {
  title: string;
  status: IncidentStatus;
  message: string;
}

/** `PUT /projects/{project}/incidents/{id}`: appends an update. */
export interface UpdateIncident {
  status: IncidentStatus;
  message: string;
}

/** The `spec` of a `StatusPage` resource. */
export interface StatusPageSpec {
  host: string;
  title: string;
  description?: string;
  services: { service: string; name: string }[];
  showUptime?: boolean;
}

export type StatusPageResource = ConsoleResource<StatusPageSpec>;
