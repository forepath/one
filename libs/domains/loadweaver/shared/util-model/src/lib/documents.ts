import { parseAllDocuments, stringify } from 'yaml';

import { parseResource, type Resource, type ResourceIssue } from './resource';

/** Max size of one submitted YAML bundle; larger configurations are split into several plans. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export interface DocumentIssue extends ResourceIssue {
  /** Zero-based index of the YAML document in the bundle. */
  document: number;
}

export type ParseDocumentsResult = { ok: true; resources: Resource[] } | { ok: false; issues: DocumentIssue[] };

/**
 * Parses a multi-document YAML bundle (`---` separated) into validated resources (3.8).
 * Aliases are capped to prevent alias-expansion attacks; duplicate keys are errors.
 */
export function parseResourceDocuments(text: string): ParseDocumentsResult {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      issues: [{ document: 0, path: '', message: `document bundle exceeds ${MAX_DOCUMENT_BYTES} bytes` }],
    };
  }

  const docs = parseAllDocuments(text, { uniqueKeys: true, prettyErrors: true, strict: true });
  const list = Array.isArray(docs) ? docs : [docs];
  const issues: DocumentIssue[] = [];
  const resources: Resource[] = [];
  const seen = new Set<string>();

  list.forEach((doc, index) => {
    if (doc.errors.length > 0) {
      doc.errors.forEach((e) => issues.push({ document: index, path: '', message: e.message.split('\n')[0] }));

      return;
    }

    let value: unknown;

    try {
      value = doc.toJS({ maxAliasCount: 50 });
    } catch (error) {
      issues.push({ document: index, path: '', message: error instanceof Error ? error.message : 'invalid document' });

      return;
    }

    if (value === null || value === undefined) return;

    const result = parseResource(value);

    if (result.ok === false) {
      result.issues.forEach((issue) => issues.push({ document: index, ...issue }));

      return;
    }

    const key = `${result.resource.kind}/${result.resource.metadata.project ?? ''}/${result.resource.metadata.name}`;

    if (seen.has(key)) {
      issues.push({ document: index, path: 'metadata.name', message: `duplicate resource ${key}` });

      return;
    }

    seen.add(key);
    resources.push(result.resource);
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, resources };
}

/** Renders resources as a YAML bundle, the same format the UI and Git use (3.8, 3.29). */
export function stringifyResourceDocuments(resources: readonly Resource[]): string {
  return resources.map((r) => stringify(r, { sortMapEntries: false, lineWidth: 0 })).join('---\n');
}
