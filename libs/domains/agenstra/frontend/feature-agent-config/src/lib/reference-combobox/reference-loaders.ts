import type { OpencodeConfigService } from '@forepath/agenstra/frontend/data-access-agent-console';
import { map } from 'rxjs';

import type { ReferenceComboboxLoader } from './reference-combobox.component';

/**
 * Command `agent` suggestions of one environment (2026-10-29): its runtime agents (built-in + configured) from the
 * environment-scoped `listAgentAgents`.
 */
export function commandAgentLoader(
  service: Pick<OpencodeConfigService, 'listAgentAgents'>,
  clientId: string,
  agentId: string,
  builtInLabel: string,
): ReferenceComboboxLoader {
  return () =>
    service.listAgentAgents(clientId, agentId).pipe(
      map((list) =>
        (list.agents ?? []).map((agent) => ({
          value: agent.name,
          detail: agent.description || (agent.builtIn ? builtInLabel : undefined),
        })),
      ),
    );
}
