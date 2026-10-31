import type { VcsService } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { ReferenceComboboxLoader } from '@forepath/agenstra/frontend/feature-agent-config';
import { map } from 'rxjs';

/** The environment an automation run starts in: the chat environment when it may run, else the first allowed one. */
export function automationBranchEnvironmentId(allowedIds: readonly string[], chatId: string | null): string | null {
  if (chatId && (allowedIds.length === 0 || allowedIds.includes(chatId))) {
    return chatId;
  }

  return allowedIds[0] ?? chatId ?? null;
}

/**
 * Default branch override suggestions (2026-10-29): that environment's branches from its scoped VCS listing, one
 * entry per name (local first as the API lists them; a remote-only branch is labelled remote).
 */
export function automationBranchLoader(
  service: Pick<VcsService, 'getBranches'>,
  clientId: string,
  agentId: string,
  labels: { local: string; remote: string },
): ReferenceComboboxLoader {
  return () =>
    service.getBranches(clientId, agentId).pipe(
      map((branches) => {
        const seen = new Set<string>();
        const options: { value: string; detail: string }[] = [];

        for (const b of [...branches.filter((x) => !x.isRemote), ...branches.filter((x) => x.isRemote)]) {
          if (!seen.has(b.name)) {
            seen.add(b.name);
            options.push({ value: b.name, detail: b.isRemote ? labels.remote : labels.local });
          }
        }

        return options;
      }),
    );
}
