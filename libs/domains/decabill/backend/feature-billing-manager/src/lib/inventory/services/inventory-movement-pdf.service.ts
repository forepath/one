import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import {
  code128Geometry,
  compressSerialNumbers,
  gtinBarcodeGeometry,
  isCode128Encodable,
  isValidGtin,
  renderBarcodeSvg,
} from '@forepath/shared/shared/util-barcode';
import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { InvoicePdfHtmlRendererService } from '../../services/invoice-pdf-html-renderer.service';
import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import { loadInventoryMovementPdfTemplate } from '../../templates/inventory-movement-pdf-template.loader';
import {
  INVENTORY_MOVEMENT_DOCUMENT,
  InventoryMovementReason,
  InventoryMovementType,
} from '../constants/inventory.constants';
import type { InventoryMovementEntity } from '../entities/inventory-movement.entity';

const TITLES: Record<InventoryMovementType, string> = {
  [InventoryMovementType.PUTAWAY]: 'Putaway',
  [InventoryMovementType.TRANSFER]: 'Stock transfer',
  [InventoryMovementType.WITHDRAWAL]: 'Withdrawal',
  [InventoryMovementType.LENDING]: 'Lending',
  [InventoryMovementType.LENDING_RETURN]: 'Lending return',
};
const REASON_LABELS: Record<InventoryMovementReason, string> = {
  [InventoryMovementReason.RECEIPT]: 'Goods receipt',
  [InventoryMovementReason.RETURN]: 'Return',
  [InventoryMovementReason.FULFILLMENT]: 'Fulfilment',
  [InventoryMovementReason.CONSUMPTION]: 'Consumption',
  [InventoryMovementReason.DAMAGE]: 'Damage',
  [InventoryMovementReason.LOSS]: 'Loss',
  [InventoryMovementReason.CORRECTION]: 'Stock correction',
  [InventoryMovementReason.OTHER]: 'Other',
};
const SIGNATURES: Record<InventoryMovementType, [string, string]> = {
  [InventoryMovementType.PUTAWAY]: ['Delivered by', 'Stored by'],
  [InventoryMovementType.TRANSFER]: ['Picked by', 'Stored by'],
  [InventoryMovementType.WITHDRAWAL]: ['Picked by', 'Received by'],
  [InventoryMovementType.LENDING]: ['Handed over by', 'Received by (borrower)'],
  [InventoryMovementType.LENDING_RETURN]: ['Returned by (borrower)', 'Received by'],
};
const BORROWER_KIND_LABELS: Record<'customer' | 'staff', string> = { customer: 'Customer', staff: 'Staff' };
const SOURCE_LABELS: Record<string, string> = {
  offer: 'Offer',
  invoice: 'Invoice',
  subscription: 'Subscription',
};

export interface InventoryMovementPdfViewModel {
  title: string;
  companyName: string;
  documentNumber: string;
  dateLabel: string;
  reasonLabel: string;
  performedBy: string;
  reference: string | null;
  requestLabel: string | null;
  customerLabel: string | null;
  /** Shown under the customer name. */
  customerNumber: string | null;
  source: InventoryMovementEntity['snapshot']['source'];
  target: InventoryMovementEntity['snapshot']['target'];
  /** Shown instead of a missing location (goods receipt / issue, on loan). */
  sourcePlaceholder: string;
  sourcePlaceholderSub: string | null;
  targetPlaceholder: string;
  targetPlaceholderSub: string | null;
  borrower: {
    name: string;
    kindLabel: string;
    email: string | null;
    customerNumber: string | null;
    dueDate: string | null;
  } | null;
  /** Lending a return belongs to. */
  lendingNumber: string | null;
  /** Serial numbers, consecutive runs compressed to ranges. */
  serialNumbers: string[];
  serialCount: number;
  articleNumber: string;
  articleName: string;
  ean: string;
  quantityLabel: string;
  stockLines: Array<{ label: string; value: string }>;
  articleBarcodeSvg: string;
  eanBarcodeSvg: string | null;
  note: string | null;
  signatureLeft: string;
  signatureRight: string;
  authenticityShortSha?: string;
}

/**
 * Storage key of a movement document: `{putaways|transfers|withdrawals|lendings|lending-returns}/{year}/{number}.pdf`.
 */
export function buildInventoryMovementStorageKey(
  movement: Pick<InventoryMovementEntity, 'type' | 'documentNumber' | 'createdAt'>,
): string {
  const folder = INVENTORY_MOVEMENT_DOCUMENT[movement.type].folder;
  // Document numbers are generated (`PUT-2026-00001`); keep the key safe even if that ever changes.
  const fileName = movement.documentNumber.replace(/[^A-Za-z0-9._-]/g, '_');

  return `${folder}/${movement.createdAt.getUTCFullYear()}/${fileName}.pdf`;
}

function formatQuantity(value: number | string | null | undefined, unit: string): string {
  const numeric = Number(value ?? 0);

  return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

/**
 * Renders, archives and signs movement documents. Files land in the File Explorer under
 * `inventory/documents/{putaways|transfers|withdrawals|lendings|lending-returns}` and are registered in `billing_stored_files` (signed and
 * stamped with a Document ID when `BILLING_FILE_SIGNING_SECRET` is set), like invoices, offers and time reports.
 */
@Injectable()
export class InventoryMovementPdfService {
  private readonly template = Handlebars.compile(loadInventoryMovementPdfTemplate());

  constructor(
    private readonly htmlRenderer: InvoicePdfHtmlRendererService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
  ) {}

  buildViewModel(movement: InventoryMovementEntity, authenticityShortSha?: string): InventoryMovementPdfViewModel {
    const { snapshot } = movement;
    const unit = snapshot.article.unit;
    const stockLines: Array<{ label: string; value: string }> = [];

    if (movement.sourceQuantityAfter !== null && movement.sourceQuantityAfter !== undefined && snapshot.source) {
      stockLines.push({
        label: `Remaining in ${snapshot.source.compartmentCode}`,
        value: formatQuantity(movement.sourceQuantityAfter, unit),
      });
    }

    if (movement.targetQuantityAfter !== null && movement.targetQuantityAfter !== undefined && snapshot.target) {
      stockLines.push({
        label: `Now in ${snapshot.target.compartmentCode}`,
        value: formatQuantity(movement.targetQuantityAfter, unit),
      });
    }

    const ean = snapshot.article.ean;
    const request = snapshot.request;
    const lending = snapshot.lending ?? null;
    const onLoan = lending ? `On loan: ${lending.borrowerName}` : 'On loan';
    const serials = movement.serialNumbers ?? [];

    return {
      title: TITLES[movement.type],
      companyName: this.billingIssuerConfig.getConfig().name,
      documentNumber: movement.documentNumber,
      dateLabel: movement.createdAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      reasonLabel: movement.reason ? REASON_LABELS[movement.reason] : '–',
      performedBy: snapshot.performedByEmail ?? 'System',
      reference: movement.reference ?? null,
      requestLabel: request ? `${SOURCE_LABELS[request.sourceType] ?? request.sourceType}: ${request.reference}` : null,
      customerLabel: request?.customerName ?? request?.customerNumber ?? null,
      customerNumber: request?.customerName ? (request.customerNumber ?? null) : null,
      source: snapshot.source,
      target: snapshot.target,
      sourcePlaceholder: movement.type === InventoryMovementType.LENDING_RETURN ? onLoan : 'Goods receipt',
      sourcePlaceholderSub:
        movement.type === InventoryMovementType.LENDING_RETURN ? (lending?.documentNumber ?? null) : null,
      targetPlaceholder: movement.type === InventoryMovementType.LENDING ? onLoan : 'Goods issue',
      targetPlaceholderSub:
        movement.type === InventoryMovementType.LENDING && lending?.dueDate ? `Due back ${lending.dueDate}` : null,
      borrower: lending
        ? {
            name: lending.borrowerName,
            kindLabel: BORROWER_KIND_LABELS[lending.borrowerKind] ?? lending.borrowerKind,
            email: lending.borrowerEmail,
            customerNumber: lending.borrowerCustomerNumber,
            dueDate: movement.type === InventoryMovementType.LENDING ? lending.dueDate : null,
          }
        : null,
      lendingNumber: movement.type === InventoryMovementType.LENDING_RETURN ? (lending?.documentNumber ?? null) : null,
      serialNumbers: compressSerialNumbers(serials),
      serialCount: serials.length,
      articleNumber: snapshot.article.articleNumber,
      articleName: snapshot.article.name,
      ean: ean ?? '–',
      quantityLabel: formatQuantity(movement.quantity, unit),
      stockLines,
      articleBarcodeSvg: isCode128Encodable(snapshot.article.articleNumber)
        ? renderBarcodeSvg(code128Geometry(snapshot.article.articleNumber), { moduleWidth: 1.5, height: 48 })
        : '',
      eanBarcodeSvg:
        ean && isValidGtin(ean) ? renderBarcodeSvg(gtinBarcodeGeometry(ean), { moduleWidth: 1.5, height: 48 }) : null,
      note: movement.note ?? null,
      signatureLeft: SIGNATURES[movement.type][0],
      signatureRight: SIGNATURES[movement.type][1],
      authenticityShortSha,
    };
  }

  async generateAndStore(movement: InventoryMovementEntity): Promise<string> {
    const storageKey = buildInventoryMovementStorageKey(movement);
    let authenticityShortSha: string | undefined;

    if (this.storedFileRegistry.isSigningEnabled()) {
      const reserved = await this.storedFileRegistry.reserve(
        getTenantIdOrDefault(),
        FileStorageScope.inventoryDocuments,
        storageKey,
      );

      authenticityShortSha = reserved.shas.short;
    }

    const html = this.template(this.buildViewModel(movement, authenticityShortSha));
    const content = Buffer.from(await this.htmlRenderer.renderHtmlToPdf(html));

    await this.fileStorage.writeInventoryDocumentFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.inventoryDocuments,
      storageKey,
      content,
    });

    return storageKey;
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    return await this.fileStorage.readInventoryDocumentFile(storageKey);
  }
}
