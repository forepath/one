import { z } from 'zod';

/**
 * App store (P1): an installed app is a normal `Deployment` whose metadata records where it came from. The record is
 * carried as `metadata.annotations` under `apps.loadweaver.com/*` (stored, diffed, exported to Git and planned like
 * every annotation); the API shows it as `app: { catalog, name, version, channel, digest }`.
 */

export const APP_ANNOTATION_PREFIX = 'apps.loadweaver.com/';

export const APP_ANNOTATIONS = {
  catalog: `${APP_ANNOTATION_PREFIX}catalog`,
  name: `${APP_ANNOTATION_PREFIX}name`,
  version: `${APP_ANNOTATION_PREFIX}version`,
  channel: `${APP_ANNOTATION_PREFIX}channel`,
  digest: `${APP_ANNOTATION_PREFIX}digest`,
} as const;

/**
 * The install inputs, recorded so an update re-renders with them: parameter values (JSON) and the secret references
 * (JSON, `secret://<project>/<name>` — never secret values).
 */
export const APP_PARAMETERS_ANNOTATION = `${APP_ANNOTATION_PREFIX}parameters`;
export const APP_SECRETS_ANNOTATION = `${APP_ANNOTATION_PREFIX}secrets`;

/** Resources an install suggested (groups, policies, ingress, DNS, backups) carry the installing Deployment's name. */
export const APP_INSTALL_ANNOTATION = `${APP_ANNOTATION_PREFIX}installation`;

/**
 * Set by an app update whose manifest declares backups: `{"version":"<target>","volumes":["<volume>",…]}`. Applying
 * the update to that version backs these volumes up first and applies only once the backups succeeded.
 */
export const APP_BACKUP_BEFORE_UPDATE_ANNOTATION = `${APP_ANNOTATION_PREFIX}backup-before-update`;

export interface AppBackupBeforeUpdate {
  version: string;
  /** Compose volume names of the deployment. */
  volumes: string[];
}

/** The backup-before-update marker of a Deployment's annotations, or null (absent / unreadable). */
export function backupBeforeUpdateOf(
  annotations: Record<string, string> | undefined | null,
): AppBackupBeforeUpdate | null {
  const raw = annotations?.[APP_BACKUP_BEFORE_UPDATE_ANNOTATION];

  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<AppBackupBeforeUpdate>;

    if (typeof value?.version !== 'string' || !Array.isArray(value.volumes)) return null;

    const volumes = value.volumes.filter(
      (v): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v),
    );

    return volumes.length ? { version: value.version, volumes } : null;
  } catch {
    return null;
  }
}

/** Where an installed app came from (`Deployment` metadata `app`). */
export const installedAppRefSchema = z
  .object({
    catalog: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    version: z.string().min(1).max(64),
    channel: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();
export type InstalledAppMetadata = z.infer<typeof installedAppRefSchema>;

/** The annotations recording an installed app. */
export function appAnnotations(app: InstalledAppMetadata): Record<string, string> {
  return {
    [APP_ANNOTATIONS.catalog]: app.catalog,
    [APP_ANNOTATIONS.name]: app.name,
    [APP_ANNOTATIONS.version]: app.version,
    [APP_ANNOTATIONS.channel]: app.channel,
    [APP_ANNOTATIONS.digest]: app.digest,
  };
}

/** The installed app a resource's annotations record, or null (not an app, or an incomplete / invalid record). */
export function installedAppOf(annotations: Record<string, string> | undefined | null): InstalledAppMetadata | null {
  if (!annotations?.[APP_ANNOTATIONS.name]) return null;

  const parsed = installedAppRefSchema.safeParse({
    catalog: annotations[APP_ANNOTATIONS.catalog],
    name: annotations[APP_ANNOTATIONS.name],
    version: annotations[APP_ANNOTATIONS.version],
    channel: annotations[APP_ANNOTATIONS.channel],
    digest: annotations[APP_ANNOTATIONS.digest],
  });

  return parsed.success ? parsed.data : null;
}
