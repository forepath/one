import { applyDecorators } from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/**
 * Optional customer-notification switch on finalizing actions (issue invoice, void, archive / revoke offer, bill
 * project time). Omitted means `true`, so API clients that never send it keep the previous behaviour (the customer is
 * emailed right away). `false` finalizes the document silently; it can be sent later through the matching send action.
 */
export function IsOptionalNotifyFlag(property = 'notifyCustomer'): PropertyDecorator {
  return applyDecorators(IsOptional(), IsBoolean({ message: `${property} must be a boolean` }));
}

/** `true` unless the caller explicitly passed `false`. */
export function shouldNotify(flag: boolean | null | undefined): boolean {
  return flag !== false;
}

/**
 * `POST …/mark-sent` (invoice, credit note, offer): the document was sent outside Decabill (printed and posted by
 * hand, handed over in person …). Records `sent_via = manual`; nothing is sent to the customer.
 */
export class MarkDocumentSentDto {
  /** When it was sent (ISO 8601); default now. Not in the future, not before the document was finalized. */
  @IsOptional()
  @IsDateString({}, { message: 'sentAt must be an ISO 8601 date or datetime' })
  sentAt?: string;
}

/** Parsed `sentAt` of a mark-sent request (`undefined` = now). */
export function parseMarkSentAt(dto: MarkDocumentSentDto | null | undefined): Date | undefined {
  return dto?.sentAt ? new Date(dto.sentAt) : undefined;
}
