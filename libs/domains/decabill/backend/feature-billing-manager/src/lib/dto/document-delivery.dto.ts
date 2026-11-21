import { applyDecorators } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';

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
