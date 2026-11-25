export const SPOOLER_ENQUEUE = Symbol('SPOOLER_ENQUEUE');

export interface SpoolerUnitPayload {
  spoolJobId: string;
  tenantId: string;
}

/** Hands a spool job to the background queue (BullMQ in the billing manager app). */
export interface SpoolerEnqueuePort {
  enqueueUnit(payload: SpoolerUnitPayload): Promise<void>;
}
