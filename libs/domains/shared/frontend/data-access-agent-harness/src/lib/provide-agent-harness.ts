import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type { AgentHarnessCredential, AgentToolApprovalRequest } from '@forepath/shared/shared/util-agent-harness';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import {
  createAgentConversation$,
  openAgentConversation$,
  sendAgentMessage$,
} from './state/agent-harness/agent-harness.effects';
import { AGENT_HARNESS_FEATURE_KEY, agentHarnessReducer } from './state/agent-harness/agent-harness.reducer';
import {
  AGENT_HARNESS_APPROVAL,
  AGENT_HARNESS_CREDENTIAL,
  AGENT_HARNESS_ENVIRONMENT,
  type AgentHarnessEnvironment,
} from './tokens/agent-harness-environment';

export interface ProvideAgentHarnessOptions {
  /** Credential of the `direct` mode. */
  credential?: AgentHarnessCredential;
  /** Approval of browser tools with `requiresApproval`. */
  approve?: (request: AgentToolApprovalRequest<unknown>) => boolean | Promise<boolean>;
}

/**
 * Registers the agent chat state (`agentHarness` feature), its effects and the environment. Requires the root store,
 * root effects and `HttpClient` of the application (route- or app-level providers).
 */
export function provideAgentHarness(
  environment: AgentHarnessEnvironment,
  options: ProvideAgentHarnessOptions = {},
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: AGENT_HARNESS_ENVIRONMENT, useValue: environment },
    ...(options.credential ? [{ provide: AGENT_HARNESS_CREDENTIAL, useValue: options.credential }] : []),
    ...(options.approve ? [{ provide: AGENT_HARNESS_APPROVAL, useValue: options.approve }] : []),
    provideState(AGENT_HARNESS_FEATURE_KEY, agentHarnessReducer),
    provideEffects({ createAgentConversation$, openAgentConversation$, sendAgentMessage$ }),
  ]);
}
