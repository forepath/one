import type { AgentContentWriteOperation } from '@forepath/agenstra/shared/util-opencode-config';

/** Operator-facing label of a content change operation (task / ticket automation opt-ins). */
export function agentContentWriteLabel(operation: AgentContentWriteOperation): string {
  switch (operation) {
    case 'ticket.create':
      return $localize`:@@featureContentWrites-ticketCreate:Create tickets`;
    case 'ticket.update':
      return $localize`:@@featureContentWrites-ticketUpdate:Update tickets`;
    case 'ticket.comment':
      return $localize`:@@featureContentWrites-ticketComment:Comment on tickets`;
    case 'ticket.delete':
      return $localize`:@@featureContentWrites-ticketDelete:Delete tickets`;
    case 'page.create':
      return $localize`:@@featureContentWrites-pageCreate:Create knowledge pages`;
    case 'page.update':
      return $localize`:@@featureContentWrites-pageUpdate:Update knowledge pages`;
    case 'page.delete':
      return $localize`:@@featureContentWrites-pageDelete:Delete knowledge pages`;
  }
}
