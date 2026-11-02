import {
  isSensitiveVariable,
  redactCompose,
  type DiscoveryReport,
} from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Defense in depth (3.21): the agent redacts its report, the control plane checks again before anything is stored or
 * shown — compose files go through `redactCompose` once more (a file that doesn't parse is dropped), `.env` values of
 * sensitive names or with URL credentials are removed, container labels other than compose's / Loadweaver's dropped.
 */
export function sanitizeDiscovery(report: DiscoveryReport): DiscoveryReport {
  return {
    ...report,
    // Only compose's and Loadweaver's own labels (others may carry secrets).
    containers: report.containers.map((c) => ({
      ...c,
      labels: Object.fromEntries(
        Object.entries(c.labels).filter(
          ([k]) => k.startsWith('com.docker.compose.') || k.startsWith('loadweaver.com/'),
        ),
      ),
    })),
    composeProjects: report.composeProjects.map((p) => ({
      ...p,
      configFiles: p.configFiles.map((f) => {
        if (f.content === undefined) return f;

        const again = redactCompose(f.content);

        if (!again) return { path: f.path, error: 'not valid YAML; not stored' };

        return {
          path: f.path,
          content: again.content,
          ...(f.redacted?.length || again.redacted.length
            ? { redacted: [...(f.redacted ?? []), ...again.redacted].slice(0, 1024) }
            : {}),
          ...(f.error ? { error: f.error } : {}),
        };
      }),
      ...(p.envFile
        ? {
            envFile: {
              ...p.envFile,
              variables: p.envFile.variables.map((v) =>
                v.sensitive || isSensitiveVariable(v.name, v.value ?? '') ? { name: v.name, sensitive: true } : v,
              ),
            },
          }
        : {}),
    })),
  };
}
