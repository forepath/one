/** Socket.IO event names on the `inventory` namespace (server → client). Payloads mirror the REST responses. */
export const INVENTORY_EVENTS = {
  warehouseUpsert: 'warehouseUpsert',
  warehouseRemoved: 'warehouseRemoved',
  compartmentUpsert: 'compartmentUpsert',
  compartmentRemoved: 'compartmentRemoved',
  articleUpsert: 'articleUpsert',
  articleRemoved: 'articleRemoved',
  stockUpsert: 'stockUpsert',
  stockRemoved: 'stockRemoved',
  movementCreated: 'movementCreated',
  requestUpsert: 'requestUpsert',
  /** Requests changed outside this API process (e.g. raised by a billing run); clients reload request views. */
  requestsChanged: 'requestsChanged',
  lendingUpsert: 'lendingUpsert',
  /** Serial units of an article moved (payload `{ articleId }`); clients reload serial views of that article. */
  serialUnitsChanged: 'serialUnitsChanged',
} as const;

export type InventoryEventName = (typeof INVENTORY_EVENTS)[keyof typeof INVENTORY_EVENTS];
