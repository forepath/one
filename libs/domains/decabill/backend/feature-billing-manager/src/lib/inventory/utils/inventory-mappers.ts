import { InventoryLendingStatus } from '../constants/inventory.constants';
import type {
  InventoryArticleResponseDto,
  InventoryCompartmentResponseDto,
  InventoryLendingResponseDto,
  InventoryMovementResponseDto,
  InventorySerialUnitResponseDto,
  InventoryStockResponseDto,
  InventoryWarehouseResponseDto,
  InventoryWithdrawalRequestResponseDto,
} from '../dto/inventory.dto';
import type { InventoryArticleEntity } from '../entities/inventory-article.entity';
import type { InventoryCompartmentEntity } from '../entities/inventory-compartment.entity';
import type { InventoryLendingEntity } from '../entities/inventory-lending.entity';
import type { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import type { InventorySerialUnitEntity } from '../entities/inventory-serial-unit.entity';
import type { InventoryStockEntity } from '../entities/inventory-stock.entity';
import type { InventoryWarehouseEntity } from '../entities/inventory-warehouse.entity';
import type { InventoryWithdrawalRequestEntity } from '../entities/inventory-withdrawal-request.entity';
import type { InventoryArticleStockTotals } from '../repositories/inventory-articles.repository';
import type { InventoryCompartmentStats } from '../repositories/inventory-compartments.repository';
import type { InventoryWarehouseStats } from '../repositories/inventory-warehouses.repository';

import { inventoryToday, toNumberOrNull } from './inventory-query.utils';

export function mapWarehouse(
  warehouse: InventoryWarehouseEntity,
  stats?: InventoryWarehouseStats,
): InventoryWarehouseResponseDto {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    description: warehouse.description ?? null,
    addressLine1: warehouse.addressLine1 ?? null,
    addressLine2: warehouse.addressLine2 ?? null,
    postalCode: warehouse.postalCode ?? null,
    city: warehouse.city ?? null,
    country: warehouse.country ?? null,
    isActive: warehouse.isActive,
    compartmentCount: stats?.compartmentCount ?? 0,
    articleCount: stats?.articleCount ?? 0,
    totalQuantity: stats?.totalQuantity ?? 0,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}

export function mapCompartment(
  compartment: InventoryCompartmentEntity,
  stats?: InventoryCompartmentStats,
): InventoryCompartmentResponseDto {
  return {
    id: compartment.id,
    warehouseId: compartment.warehouseId,
    warehouseCode: compartment.warehouse?.code ?? '',
    warehouseName: compartment.warehouse?.name ?? '',
    code: compartment.code,
    name: compartment.name ?? null,
    description: compartment.description ?? null,
    isActive: compartment.isActive,
    articleCount: stats?.articleCount ?? 0,
    totalQuantity: stats?.totalQuantity ?? 0,
    createdAt: compartment.createdAt.toISOString(),
    updatedAt: compartment.updatedAt.toISOString(),
  };
}

export function mapArticle(
  article: InventoryArticleEntity,
  totals?: InventoryArticleStockTotals,
  requestedQuantity = 0,
  lentQuantity = 0,
): InventoryArticleResponseDto {
  const totalQuantity = totals?.totalQuantity ?? 0;
  const reorderPoint = toNumberOrNull(article.reorderPoint);

  return {
    id: article.id,
    articleNumber: article.articleNumber,
    name: article.name,
    description: article.description ?? null,
    ean: article.ean ?? null,
    unit: article.unit,
    manufacturer: article.manufacturer ?? null,
    manufacturerPartNumber: article.manufacturerPartNumber ?? null,
    supplierId: article.supplierId ?? null,
    supplierArticleNumber: article.supplierArticleNumber ?? null,
    purchasePriceNet: toNumberOrNull(article.purchasePriceNet),
    salesPriceNet: toNumberOrNull(article.salesPriceNet),
    currency: article.currency,
    taxCategory: article.taxCategory,
    reorderPoint,
    reorderQuantity: toNumberOrNull(article.reorderQuantity),
    weightKg: toNumberOrNull(article.weightKg),
    lengthCm: toNumberOrNull(article.lengthCm),
    widthCm: toNumberOrNull(article.widthCm),
    heightCm: toNumberOrNull(article.heightCm),
    hsCode: article.hsCode ?? null,
    countryOfOrigin: article.countryOfOrigin ?? null,
    isActive: article.isActive,
    serialTracking: article.serialTracking,
    averageCost: toNumberOrNull(article.averageCost) ?? undefined,
    totalQuantity,
    lentQuantity,
    locationCount: totals?.locationCount ?? 0,
    requestedQuantity,
    lowStock: reorderPoint !== null && totalQuantity <= reorderPoint,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

export function mapStock(stock: InventoryStockEntity): InventoryStockResponseDto {
  const article = stock.article!;
  const compartment = stock.compartment!;
  const warehouse = compartment.warehouse!;

  return {
    id: stock.id,
    quantity: Number(stock.quantity),
    article: {
      id: article.id,
      articleNumber: article.articleNumber,
      name: article.name,
      ean: article.ean ?? null,
      unit: article.unit,
      isActive: article.isActive,
      reorderPoint: toNumberOrNull(article.reorderPoint),
      serialTracking: article.serialTracking,
    },
    compartment: {
      id: compartment.id,
      code: compartment.code,
      name: compartment.name ?? null,
      isActive: compartment.isActive,
    },
    warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, isActive: warehouse.isActive },
    updatedAt: stock.updatedAt.toISOString(),
  };
}

export function mapMovement(movement: InventoryMovementEntity): InventoryMovementResponseDto {
  const location = (snapshot: InventoryMovementEntity['snapshot']['source']) =>
    snapshot
      ? {
          warehouseCode: snapshot.warehouseCode,
          warehouseName: snapshot.warehouseName,
          compartmentId: snapshot.compartmentId,
          compartmentCode: snapshot.compartmentCode,
        }
      : null;

  return {
    id: movement.id,
    type: movement.type,
    documentNumber: movement.documentNumber,
    articleId: movement.articleId,
    articleNumber: movement.snapshot.article.articleNumber,
    articleName: movement.snapshot.article.name,
    unit: movement.snapshot.article.unit,
    quantity: Number(movement.quantity),
    reason: movement.reason ?? null,
    source: location(movement.snapshot.source),
    target: location(movement.snapshot.target),
    sourceQuantityAfter: toNumberOrNull(movement.sourceQuantityAfter),
    targetQuantityAfter: toNumberOrNull(movement.targetQuantityAfter),
    reference: movement.reference ?? null,
    note: movement.note ?? null,
    withdrawalRequestId: movement.withdrawalRequestId ?? null,
    serialNumbers: movement.serialNumbers ?? [],
    lendingId: movement.lendingId ?? null,
    lending: movement.snapshot.lending
      ? {
          documentNumber: movement.snapshot.lending.documentNumber,
          borrowerName: movement.snapshot.lending.borrowerName,
          borrowerKind: movement.snapshot.lending.borrowerKind,
          dueDate: movement.snapshot.lending.dueDate,
        }
      : null,
    performedByEmail: movement.snapshot.performedByEmail ?? null,
    hasPdf: Boolean(movement.pdfStorageKey),
    createdAt: movement.createdAt.toISOString(),
  };
}

export function mapWithdrawalRequest(
  request: InventoryWithdrawalRequestEntity,
  article: InventoryArticleEntity,
  extras: { availableQuantity: number; customerEmail: string | null; movementIds: string[] },
): InventoryWithdrawalRequestResponseDto {
  return {
    id: request.id,
    status: request.status,
    sourceType: request.sourceType,
    sourceLabel: request.sourceLabel,
    quantity: Number(request.quantity),
    article: {
      id: article.id,
      articleNumber: article.articleNumber,
      name: article.name,
      ean: article.ean ?? null,
      unit: article.unit,
      serialTracking: article.serialTracking,
    },
    availableQuantity: extras.availableQuantity,
    userId: request.userId ?? null,
    customerEmail: extras.customerEmail,
    offerId: request.offerId ?? null,
    invoiceId: request.invoiceId ?? null,
    subscriptionId: request.subscriptionId ?? null,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionNote: request.decisionNote ?? null,
    movementIds: extras.movementIds,
    createdAt: request.createdAt.toISOString(),
  };
}

function compartmentLocation(
  compartment: InventoryCompartmentEntity | null | undefined,
): { compartmentId: string; compartmentCode: string; warehouseCode: string; warehouseName: string } | null {
  return compartment
    ? {
        compartmentId: compartment.id,
        compartmentCode: compartment.code,
        warehouseCode: compartment.warehouse?.code ?? '',
        warehouseName: compartment.warehouse?.name ?? '',
      }
    : null;
}

export function mapLending(
  lending: InventoryLendingEntity,
  extras: { outstandingSerialNumbers: string[]; movementIds: string[]; today?: string },
): InventoryLendingResponseDto {
  const quantity = Number(lending.quantity);
  const returnedQuantity = Number(lending.returnedQuantity);
  const article = lending.article!;
  const open = lending.status === InventoryLendingStatus.OPEN;

  return {
    id: lending.id,
    status: lending.status,
    overdue: open && Boolean(lending.dueDate) && lending.dueDate! < (extras.today ?? inventoryToday()),
    documentNumber: lending.documentNumber ?? null,
    article: {
      id: article.id,
      articleNumber: article.articleNumber,
      name: article.name,
      unit: article.unit,
      serialTracking: article.serialTracking,
    },
    quantity,
    returnedQuantity,
    outstandingQuantity: Math.round((quantity - returnedQuantity) * 1000) / 1000,
    borrower: {
      userId: lending.borrowerUserId ?? null,
      name: lending.borrowerName,
      email: lending.borrowerEmail ?? null,
      customerNumber: lending.borrowerCustomerNumber ?? null,
      kind: lending.borrowerKind,
    },
    source: compartmentLocation(lending.sourceCompartment),
    dueDate: lending.dueDate ?? null,
    note: lending.note ?? null,
    outstandingSerialNumbers: extras.outstandingSerialNumbers,
    movementIds: extras.movementIds,
    createdAt: lending.createdAt.toISOString(),
    returnedAt: lending.returnedAt?.toISOString() ?? null,
  };
}

export function mapSerialUnit(unit: InventorySerialUnitEntity): InventorySerialUnitResponseDto {
  const article = unit.article!;

  return {
    id: unit.id,
    serialNumber: unit.serialNumber,
    status: unit.status,
    article: { id: article.id, articleNumber: article.articleNumber, name: article.name },
    location: compartmentLocation(unit.compartment),
    lending: unit.lending
      ? {
          id: unit.lending.id,
          documentNumber: unit.lending.documentNumber ?? null,
          borrowerName: unit.lending.borrowerName,
          borrowerKind: unit.lending.borrowerKind,
          dueDate: unit.lending.dueDate ?? null,
        }
      : null,
    updatedAt: unit.updatedAt.toISOString(),
  };
}
