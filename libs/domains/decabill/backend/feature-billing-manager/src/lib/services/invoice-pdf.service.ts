import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

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
  ) {}

  getStorageRoot(): string {
    return process.env.BILLING_INVOICE_PDF_STORAGE_PATH ?? path.join(process.cwd(), 'data', 'invoices');
  }

  resolveAbsolutePath(storageKey: string): string {
    const root = path.resolve(this.getStorageRoot());
    const absolute = path.resolve(root, storageKey);

    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      throw new Error('Invalid invoice PDF path');
    }

    return absolute;
  }

  async generateAndStore(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
  ): Promise<string> {
    const documentOptions = buildInvoiceDocumentOptions(invoice);
    const xml = this.eInvoiceXmlService.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      documentOptions,
    );
    const pdfBytes = await this.renderPdf(invoice, lineItems, issuer, buyer, buildInvoicePdfPresentation(invoice));
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);
    const storageKey = buildInvoicePdfStorageKey(invoice, '.pdf');
    const absolute = this.resolveAbsolutePath(storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, embedded);

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
    const pdfBytes = await this.renderPdf(invoice, lineItems, issuer, buyer, presentation);
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);
    const storageKey = buildInvoicePdfStorageKey(invoice, '-void.pdf');
    const absolute = this.resolveAbsolutePath(storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, embedded);

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
    const pdfBytes = await this.renderPdf(invoice, [syntheticLine], issuer, buyer, presentation);
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(pdfBytes, xml);
    const storageKey = buildInvoicePdfStorageKey(invoice, `-credit-${suffix}.pdf`);
    const absolute = this.resolveAbsolutePath(storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, embedded);

    return { storageKey, documentNumber };
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    const absolute = this.resolveAbsolutePath(storageKey);

    return await fs.promises.readFile(absolute);
  }

  private async renderPdf(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation = buildInvoicePdfPresentation(invoice),
  ): Promise<Uint8Array> {
    const html = this.invoicePdfTemplateService.buildHtml(invoice, lineItems, issuer, buyer, presentation);

    return await this.invoicePdfHtmlRendererService.renderHtmlToPdf(html);
  }
}
