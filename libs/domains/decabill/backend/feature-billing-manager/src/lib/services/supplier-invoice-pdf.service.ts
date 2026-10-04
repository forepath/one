import { Injectable } from '@nestjs/common';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';

import { SupplierDocumentSource } from '../constants/supplier-document-source.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { SupplierInvoiceLineItemEntity } from '../entities/supplier-invoice-line-item.entity';
import type { SupplierInvoiceEntity } from '../entities/supplier-invoice.entity';
import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';
import { buildSupplierInvoicePdfStorageKey } from '../utils/supplier-invoice-pdf-storage.util';

import type { BillingIssuerConfig } from './billing-issuer-config.service';
import { InvoicePdfHtmlRendererService } from './invoice-pdf-html-renderer.service';
import { buildInvoicePdfPresentation } from './invoice-pdf-presentation.util';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';
import { StoredFileRegistryService } from './stored-file-registry.service';

@Injectable()
export class SupplierInvoicePdfService {
  constructor(
    private readonly invoicePdfTemplateService: InvoicePdfTemplateService,
    private readonly invoicePdfHtmlRendererService: InvoicePdfHtmlRendererService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  async generateAndStore(
    invoice: SupplierInvoiceEntity,
    lineItems: SupplierInvoiceLineItemEntity[],
    supplier: SupplierProfileEntity,
    recipient: BillingIssuerConfig,
  ): Promise<string> {
    const pdfBytes = await this.renderPdf(invoice, lineItems, supplier, recipient);
    const storageKey = buildSupplierInvoicePdfStorageKey(invoice, '.pdf');
    const content = Buffer.from(pdfBytes);

    await this.fileStorage.writeSupplierInvoiceFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: supplier.tenantId || getTenantIdOrDefault(),
      scope: FileStorageScope.supplierInvoices,
      storageKey,
      content,
    });

    return storageKey;
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    return await this.fileStorage.readSupplierInvoiceFile(storageKey);
  }

  private async renderPdf(
    invoice: SupplierInvoiceEntity,
    lineItems: SupplierInvoiceLineItemEntity[],
    supplier: SupplierProfileEntity,
    recipient: BillingIssuerConfig,
  ): Promise<Uint8Array> {
    const issuer = this.supplierAsIssuer(supplier);
    const buyer = this.recipientAsBuyer(recipient, invoice);
    const invoiceView = this.toInvoiceView(invoice);
    const lineItemViews = lineItems.map((line) => this.toLineItemView(line));
    const presentation = buildInvoicePdfPresentation(invoiceView, {
      documentIssueDate: invoice.issueDate,
    });
    const html = this.invoicePdfTemplateService.buildHtml(invoiceView, lineItemViews, issuer, buyer, presentation);

    return await this.invoicePdfHtmlRendererService.renderHtmlToPdf(html);
  }

  private supplierAsIssuer(supplier: SupplierProfileEntity): BillingIssuerConfig {
    const name =
      supplier.company?.trim() ||
      [supplier.firstName, supplier.lastName].filter(Boolean).join(' ').trim() ||
      supplier.supplierNumber;

    return {
      name,
      vatId: supplier.vatId ?? '',
      addressLine1: supplier.addressLine1 ?? '',
      postalCode: supplier.postalCode ?? '',
      city: supplier.city ?? '',
      country: supplier.country ?? '',
      email: supplier.email,
    };
  }

  private recipientAsBuyer(recipient: BillingIssuerConfig, invoice: SupplierInvoiceEntity): CustomerProfileEntity {
    return {
      company: recipient.name,
      vatId: recipient.vatId,
      addressLine1: recipient.addressLine1,
      postalCode: recipient.postalCode,
      city: recipient.city,
      country: recipient.country,
      email: recipient.email,
      buyerVatId: recipient.vatId,
      buyerCountry: recipient.country,
    } as CustomerProfileEntity & { buyerVatId?: string; buyerCountry?: string };
  }

  private toInvoiceView(invoice: SupplierInvoiceEntity): InvoiceEntity {
    return {
      ...invoice,
      userId: invoice.supplierId,
      pdfStorageKey: invoice.documentStorageKey,
    } as unknown as InvoiceEntity;
  }

  private toLineItemView(line: SupplierInvoiceLineItemEntity): InvoiceLineItemEntity {
    return line as unknown as InvoiceLineItemEntity;
  }
}
