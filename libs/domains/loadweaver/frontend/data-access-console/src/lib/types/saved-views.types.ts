/** A saved view (3.37): the caller's own console state of one list (`scope`) under a name, stored server-side. */
export interface SavedView {
  id: string;
  /** A list id (`contents`, `audit`, `plans`, `tree`, …) or `settings` for console settings. */
  scope: string;
  name: string;
  /** Opaque console state (query, filters, columns, sort, tree view, density …); at most 16 KiB serialized. */
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedViewRequest {
  scope: string;
  name: string;
  state: Record<string, unknown>;
}

export interface UpdateSavedViewRequest {
  name?: string;
  state?: Record<string, unknown>;
}
