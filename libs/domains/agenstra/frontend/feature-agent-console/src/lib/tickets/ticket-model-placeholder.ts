/** Empty-option text of the ticket model pickers: loading, failed (timeout / agent unreachable) or no agent yet. */
export interface TicketModelPickerState {
  readonly hasAgent: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
}

export function ticketModelPlaceholder({ hasAgent, loading, failed }: TicketModelPickerState): string {
  if (!hasAgent) {
    return $localize`:@@featureTicketsBoard-modelSelectAgentFirst:Select an environment to load models`;
  }

  if (loading) {
    return $localize`:@@featureTicketsBoard-modelLoading:Loading models…`;
  }

  if (failed) {
    return $localize`:@@featureTicketsBoard-modelUnavailable:Models unavailable (environment not reachable)`;
  }

  return $localize`:@@featureTicketsBoard-modelNone:No models available`;
}
