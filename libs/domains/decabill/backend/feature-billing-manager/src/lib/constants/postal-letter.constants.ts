/**
 * Lifecycle of a letter handed to a postal provider, normalized across providers:
 *
 * - `submitted`       — accepted by the provider (validated, printed and posted asynchronously)
 * - `action_required` — the provider could not process it (e.g. address not recognized); the document counts as unsent
 * - `sent`            — handed over to the postal service
 * - `delivered`       — delivery confirmed (only some delivery products report it)
 * - `undeliverable`   — returned / could not be delivered
 * - `cancelled`       — cancelled at the provider
 */
export enum PostalLetterStatus {
  SUBMITTED = 'submitted',
  ACTION_REQUIRED = 'action_required',
  SENT = 'sent',
  DELIVERED = 'delivered',
  UNDELIVERABLE = 'undeliverable',
  CANCELLED = 'cancelled',
}

export const POSTAL_LETTER_STATUSES = Object.values(PostalLetterStatus);

/**
 * Order of the states: a late or replayed provider event never moves a letter back (e.g. `sent` after `delivered`).
 * `action_required` can still be fixed at the provider and sent afterwards, so it ranks below `sent`.
 */
const STATUS_RANK: Record<PostalLetterStatus, number> = {
  [PostalLetterStatus.SUBMITTED]: 0,
  [PostalLetterStatus.ACTION_REQUIRED]: 1,
  [PostalLetterStatus.SENT]: 2,
  [PostalLetterStatus.DELIVERED]: 3,
  [PostalLetterStatus.UNDELIVERABLE]: 3,
  [PostalLetterStatus.CANCELLED]: 3,
};

/** Whether a letter in `current` may move to `next` (forward only; terminal states stay). */
export function canTransitionPostalLetter(current: PostalLetterStatus, next: PostalLetterStatus): boolean {
  if (current === next) {
    return false;
  }

  if (STATUS_RANK[current] === 3) {
    return false;
  }

  return STATUS_RANK[next] > STATUS_RANK[current];
}

/** Statuses an admin has to look at (action center). */
export const POSTAL_LETTER_ATTENTION_STATUSES: readonly PostalLetterStatus[] = [
  PostalLetterStatus.ACTION_REQUIRED,
  PostalLetterStatus.UNDELIVERABLE,
];

/** Default postal provider when `BILLING_DEFAULT_POSTAL_PROVIDER` is not set. */
export const DEFAULT_POSTAL_PROVIDER = 'pingen';

/** Upper bound for a provider's reason text stored on a letter (provider messages are short; never trusted as HTML). */
export const POSTAL_LETTER_REASON_MAX_LENGTH = 500;
