/** Periodic reports (3.25): `/reports` and their file tree. */

export type ReportStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ReportFile {
  name: string;
  /** Path in the file tree (`cluster/2026/09/report.html`). */
  path: string;
  bytes: number;
  sha256: string;
}

/** One report: a scope (`cluster` or a project) and month. */
export interface Report {
  id: string;
  scope: string;
  year: number;
  month: number;
  status: ReportStatus;
  files: ReportFile[];
  error: string | null;
  completedAt: string | null;
}

/** `POST /reports/run`: a finished month. */
export interface RunReport {
  scope: string;
  year: number;
  month: number;
}

/** `GET /reports/files?path=`: one entry of a folder. */
export interface ReportFileEntry {
  name: string;
  path: string;
  type: 'folder' | 'file';
  bytes?: number;
  updatedAt?: string;
}
