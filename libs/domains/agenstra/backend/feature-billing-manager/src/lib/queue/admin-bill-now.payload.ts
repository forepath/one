export interface AdminBillNowCoordinatorPayload {
  requestId: string;
  adminUserId: string;
  tenantId: string;
  scope: 'all' | 'user';
  userId?: string;
}

export interface AdminBillNowUnitPayload extends AdminBillNowCoordinatorPayload {
  userId: string;
}
