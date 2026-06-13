import type { AdminBillNowCoordinatorPayload } from './admin-bill-now.payload';

export const ADMIN_BILL_NOW_ENQUEUE = Symbol('ADMIN_BILL_NOW_ENQUEUE');

export interface AdminBillNowEnqueuePort {
  enqueueCoordinator(payload: AdminBillNowCoordinatorPayload): Promise<void>;
}
