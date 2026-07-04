/** sessionStorage key for one-shot contact form message prefill (e.g. instant quote → contact). */
export const CONTACT_MESSAGE_PREFILL_STORAGE_KEY = 'shared.contactMessagePrefill.v1';

interface ContactMessagePrefillPayload {
  v: 1;
  message: string;
}

export function storeContactMessagePrefill(message: string): void {
  if (typeof sessionStorage === 'undefined' || message.trim().length === 0) {
    return;
  }

  const payload: ContactMessagePrefillPayload = {
    v: 1,
    message: message.trim(),
  };

  sessionStorage.setItem(CONTACT_MESSAGE_PREFILL_STORAGE_KEY, JSON.stringify(payload));
}

/** Reads and removes a stored contact message prefill, if present. */
export function readAndClearContactMessagePrefill(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const raw = sessionStorage.getItem(CONTACT_MESSAGE_PREFILL_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  sessionStorage.removeItem(CONTACT_MESSAGE_PREFILL_STORAGE_KEY);

  try {
    const data = JSON.parse(raw) as ContactMessagePrefillPayload;

    if (data?.v === 1 && typeof data.message === 'string' && data.message.length > 0) {
      return data.message;
    }
  } catch {
    // ignore invalid payloads
  }

  return null;
}
