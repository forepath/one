/** Initiative context pre-granted to a session (controller-resolved; index-aligned contexts and refs). */
export interface InitiativeSessionContext {
  initiativeContexts: string[];
  initiativeContextRefs: Array<{ kind: 'initiative' | 'artifact'; sha: string; title?: string }>;
}

/**
 * What ticket automation asks Initiatives (optional dependency: automation behaves exactly as before for tickets that
 * are not linked to an initiative work item, and when the feature is absent).
 */
export abstract class InitiativeAutomationHooks {
  /** True when the ticket's work item waits for prerequisites or was dropped (authoritative, shared rules). */
  abstract isTicketBlocked(ticketId: string, clientId: string): Promise<boolean>;

  /** Planning context of the ticket's initiative (read-only, pre-granted to the run), or null when not linked. */
  abstract automationContext(ticketId: string, clientId: string): Promise<InitiativeSessionContext | null>;
}
