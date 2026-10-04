import { Injectable } from '@nestjs/common';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { getTenantIdOrDefault } from '@forepath/shared/backend';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { TaxCategory } from '../constants/tax-category.constants';
import type { BillingIssuerConfig } from './billing-issuer-config.service';
import {
  buildCreditNoteDocumentOptions,
  buildCreditNoteNumber,
  buildInvoiceDocumentOptions,
  buildPartialCreditNoteDocumentOptions,
  buildPartialCreditNoteNumber,
  buildZeroBalancePromotionalInvoiceDocumentOptions,
} from './e-invoice-document-options';
import { EInvoiceEmbedService } from './e-invoice-embed.service';
import { EInvoiceXmlService } from './e-invoice-xml.service';
import { InvoicePdfHtmlRendererService } from './invoice-pdf-html-renderer.service';
import {
  buildCreditNotePdfPresentation,
  buildInvoicePdfPresentation,
  buildPartialCreditNotePdfPresentation,
} from './invoice-pdf-presentation.util';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';
import type { InvoicingPeriod } from './invoicing-period.util';
import { buildInvoicePdfStorageKey } from '../utils/invoice-pdf-storage.util';
import { InvoicePromotionApplicationsRepository } from '../repositories/invoice-promotion-applications.repository';
import { StoredFileRegistryService } from './stored-file-registry.service';

export interface VoidDocumentGenerationResult {
  storageKey: string;
  documentNumber: string;
}

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly eInvoiceXmlService: EInvoiceXmlService,
    private readonly eInvoiceEmbedService: EInvoiceEmbedService,
    private readonly invoicePdfTemplateService: InvoicePdfTemplateService,
    private readonly invoicePdfHtmlRendererService: InvoicePdfHtmlRendererService,
    private readonly invoicePromotionApplicationsRepository: InvoicePromotionApplicationsRepository,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  async generateAndStore(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
  ): Promise<string> {
    const hasPromotionApplications = await this.invoicePromotionApplicationsRepository.hasApplicationsForInvoice(
      invoice.id,
    );
    const zeroBalancePromotional = Number(invoice.balanceDue) === 0 && hasPromotionApplications;
    const documentOptions = zeroBalancePromotional
      ? buildZeroBalancePromotionalInvoiceDocumentOptions(invoice)
      : buildInvoiceDocumentOptions(invoice);
    const xml = this.eInvoiceXmlService.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      documentOptions,
    );
    const storageKey = buildInvoicePdfStorageKey(invoice, '.pdf');
    const authenticityShortSha = await this.reserveAuthenticityShortSha(storageKey);
    const pdfBytes = await this.renderPdf(
      invoice,
      lineItems,
      issuer,
      buyer,
      buildInvoicePdfPresentation(invoice, { zeroBalancePromotional }),
      authenticityShortSha,
    );
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);

    const content = Buffer.from(embedded);
    await this.fileStorage.writeCustomerInvoiceFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.customerInvoices,
      storageKey,
      content,
    });

    return storageKey;
  }

  async generateVoidDocumentAndStore(
    invoice: InvoiceEntity,
    voidedAt: Date,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
  ): Promise<VoidDocumentGenerationResult> {
    const originalInvoiceNumber = invoice.invoiceNumber;

    if (!originalInvoiceNumber) {
      throw new Error('Cannot generate void document without an invoice number');
    }

    const documentNumber = buildCreditNoteNumber(originalInvoiceNumber);
    const documentOptions = buildCreditNoteDocumentOptions(documentNumber, voidedAt, originalInvoiceNumber);
    const xml = this.eInvoiceXmlService.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      documentOptions,
    );
    const presentation = buildCreditNotePdfPresentation(documentNumber, voidedAt, originalInvoiceNumber);
    const storageKey = buildInvoicePdfStorageKey(invoice, '-void.pdf');
    const authenticityShortSha = await this.reserveAuthenticityShortSha(storageKey);
    const pdfBytes = await this.renderPdf(invoice, lineItems, issuer, buyer, presentation, authenticityShortSha);
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);

    const content = Buffer.from(embedded);
    await this.fileStorage.writeCustomerInvoiceFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.customerInvoices,
      storageKey,
      content,
    });

    return { storageKey, documentNumber };
  }

  async generatePartialCreditDocumentAndStore(
    invoice: InvoiceEntity,
    issuedAt: Date,
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
    creditNet: number,
    creditGross: number,
    lineDescription: string,
    suffix: string,
    taxCategory: TaxCategory = TaxCategory.STANDARD,
  ): Promise<{ storageKey: string; documentNumber: string }> {
    const originalInvoiceNumber = invoice.invoiceNumber;

    if (!originalInvoiceNumber) {
      throw new Error('Cannot generate partial credit document without an invoice number');
    }

    const documentNumber = buildPartialCreditNoteNumber(originalInvoiceNumber, suffix);
    const syntheticLine = {
      id: 'synthetic-credit-line',
      invoiceId: invoice.id,
      position: 0,
      description: lineDescription,
      quantity: 1,
      unitPriceNet: creditNet,
      taxCategory,
      taxRate: creditNet > 0 ? Math.round(((creditGross - creditNet) / creditNet) * 10000) / 100 : 0,
      lineNet: creditNet,
      lineTax: Math.round((creditGross - creditNet) * 100) / 100,
      lineGross: creditGross,
    } as InvoiceLineItemEntity;
    const documentOptions = buildPartialCreditNoteDocumentOptions(
      documentNumber,
      issuedAt,
      originalInvoiceNumber,
      creditGross,
    );
    const xml = this.eInvoiceXmlService.buildEn16931Xml(
      invoice,
      [syntheticLine],
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      documentOptions,
    );
    const presentation = buildPartialCreditNotePdfPresentation(
      documentNumber,
      issuedAt,
      originalInvoiceNumber,
      creditGross,
    );
    const storageKey = buildInvoicePdfStorageKey(invoice, `-credit-${suffix}.pdf`);
    const authenticityShortSha = await this.reserveAuthenticityShortSha(storageKey);
    const pdfBytes = await this.renderPdf(invoice, [syntheticLine], issuer, buyer, presentation, authenticityShortSha);
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);

    const content = Buffer.from(embedded);
    await this.fileStorage.writeCustomerInvoiceFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.customerInvoices,
      storageKey,
      content,
    });

    return { storageKey, documentNumber };
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    return await this.fileStorage.readCustomerInvoiceFile(storageKey);
  }

  private async reserveAuthenticityShortSha(storageKey: string): Promise<string | undefined> {
    if (!this.storedFileRegistry.isSigningEnabled()) {
      return undefined;
    }

    const reserved = await this.storedFileRegistry.reserve(
      getTenantIdOrDefault(),
      FileStorageScope.customerInvoices,
      storageKey,
    );

    return reserved.shas.short;
  }

  private async renderPdf(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation = buildInvoicePdfPresentation(invoice),
    authenticityShortSha?: string,
  ): Promise<Uint8Array> {
    const html = this.invoicePdfTemplateService.buildHtml(
      invoice,
      lineItems,
      issuer,
      buyer,
      presentation,
      authenticityShortSha,
    );

    return await this.invoicePdfHtmlRendererService.renderHtmlToPdf(html);
  }
}
