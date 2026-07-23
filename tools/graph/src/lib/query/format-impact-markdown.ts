import { ImpactResult } from './impact';

/** Marker used by CI to find/update the sticky PR comment. */
export const IMPACT_COMMENT_MARKER = '<!-- knowledge-graph-blast-radius -->';

const MAX_SHARED = 12;
const MAX_DOCS = 12;
const MAX_UNMAPPED = 10;

/**
 * Compact blast-radius overview for PR comments (not a full R1 dump).
 */
export function formatImpactMarkdown(result: ImpactResult): string {
  const lines: string[] = [IMPACT_COMMENT_MARKER, '## Knowledge graph blast radius', ''];

  const baseLabel = result.baseRef ? `\`${result.baseRef}\` … \`HEAD\`` : 'working tree';
  lines.push(`**Diff:** ${baseLabel}`);
  lines.push(
    `**Changed files:** ${result.paths.length} · **Owning projects:** ${result.projects.length}` +
      (result.unmappedPaths.length ? ` · **Unmapped:** ${result.unmappedPaths.length}` : ''),
  );
  lines.push('');

  if (result.projects.length === 0) {
    lines.push('_No owning projects mapped from changed paths._');
    lines.push('');
  } else {
    lines.push('### Touched projects');
    lines.push('');
    lines.push('| Project | Type | Files | Deps in | Deps out | Endpoints | Channels | Docs |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const entry of result.projects) {
      const name = entry.project.label || entry.project.id.replace(/^project:/, '');
      const type = entry.project.type ?? '—';
      lines.push(
        `| \`${escapeCell(name)}\` | ${escapeCell(type)} | ${entry.matchedPaths.length} | ` +
          `${entry.r1.dependsOn.in.length} | ${entry.r1.dependsOn.out.length} | ` +
          `${entry.r1.endpointCount} | ${entry.r1.channelCount} | ${entry.r1.documentCount} |`,
      );
    }
    lines.push('');
  }

  if (result.sharedDependencyIds.length > 0) {
    lines.push('### Shared dependencies');
    lines.push('');
    lines.push('Dependencies linked to **2+** touched projects:');
    lines.push('');
    for (const id of result.sharedDependencyIds.slice(0, MAX_SHARED)) {
      lines.push(`- \`${id.replace(/^project:/, '')}\``);
    }
    if (result.sharedDependencyIds.length > MAX_SHARED) {
      lines.push(`- _…and ${result.sharedDependencyIds.length - MAX_SHARED} more_`);
    }
    lines.push('');
  }

  if (result.docPaths.length > 0) {
    lines.push('### Docs to review');
    lines.push('');
    for (const doc of result.docPaths.slice(0, MAX_DOCS)) {
      lines.push(`- \`${doc}\``);
    }
    if (result.docPaths.length > MAX_DOCS) {
      lines.push(`- _…and ${result.docPaths.length - MAX_DOCS} more_`);
    }
    lines.push('');
  }

  if (result.unmappedPaths.length > 0) {
    lines.push('### Unmapped paths');
    lines.push('');
    for (const p of result.unmappedPaths.slice(0, MAX_UNMAPPED)) {
      lines.push(`- \`${p}\``);
    }
    if (result.unmappedPaths.length > MAX_UNMAPPED) {
      lines.push(`- _…and ${result.unmappedPaths.length - MAX_UNMAPPED} more_`);
    }
    lines.push('');
  }

  lines.push('_Overview from `nx run graph:impact`._');
  lines.push('');
  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
