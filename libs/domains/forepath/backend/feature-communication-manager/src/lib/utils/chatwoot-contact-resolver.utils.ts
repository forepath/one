import { ChatwootContactListItem } from '../types/chatwoot.types';

export function resolveContactSourceId(contact: ChatwootContactListItem, inboxId: number): string | null {
  const match = contact.contact_inboxes?.find((entry) => entry.inbox?.id === inboxId);

  return match?.source_id ?? null;
}

export function resolveCreatedContact(response: {
  payload?: { contact?: ChatwootContactListItem } | ChatwootContactListItem[];
}): ChatwootContactListItem | null {
  const payload = response.payload;

  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }

  if ('contact' in payload && payload.contact) {
    return payload.contact;
  }

  return null;
}
