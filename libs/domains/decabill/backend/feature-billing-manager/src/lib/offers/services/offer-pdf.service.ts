import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { Injectable } from '@nestjs/common';

import type { CustomerProfileEntity } from '../../entities/customer-profile.entity';
import type { BillingIssuerConfig } from '../../services/billing-issuer-config.service';
import { buildOfferDocumentOptions } from '../../services/e-invoice-document-options';
import { EInvoiceEmbedService } from '../../services/e-invoice-embed.service';
import { EInvoiceXmlService } from '../../services/e-invoice-xml.service';
import { InvoicePdfHtmlRendererService } from '../../services/invoice-pdf-html-renderer.service';
import { facturXMetadata } from '../../services/invoice-pdf.service';
import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';
import type { OfferEntity } from '../entities/offer.entity';
import { buildOfferPdfStorageKey } from '../utils/offer-pdf-storage.util';

import { buildOfferPdfPresentation } from './offer-pdf-presentation.util';
import {
  mapOfferLinesToInvoiceLineItems,
  mapOfferToInvoiceDocument,
  OfferPdfTemplateService,
} from './offer-pdf-template.service';


@Injectable()
export class OfferPdfService {
  constructor(
    private readonly eInvoiceXmlService: EInvoiceXmlService,
    private readonly eInvoiceEmbedService: EInvoiceEmbedService,
    private readonly offerPdfTemplateService: OfferPdfTemplateService,
    private readonly invoicePdfHtmlRendererService: InvoicePdfHtmlRendererService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  async generateAndStore(
    offer: OfferEntity,
    lineItems: OfferLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
  ): Promise<string> {
    const invoiceDocument = mapOfferToInvoiceDocument(offer);
    const invoiceLines = mapOfferLinesToInvoiceLineItems(offer.id, lineItems);
    const archivedAt = offer.archivedAt ?? new Date();
    const documentOptions = buildOfferDocumentOptions(offer);
    const xml = this.eInvoiceXmlService.buildEn16931Xml(
      invoiceDocument,
      invoiceLines,
      issuer,
      buyer,
      offer.offerNumber ?? offer.id,
      { periodStart: archivedAt, periodEnd: archivedAt },
      documentOptions,
    );
    const presentation = buildOfferPdfPresentation(offer);
    const storageKey = buildOfferPdfStorageKey(offer);
    let authenticityShortSha: string | undefined;

    if (this.storedFileRegistry.isSigningEnabled()) {
      const reserved = await this.storedFileRegistry.reserve(
        getTenantIdOrDefault(),
        FileStorageScope.customerOffers,
        storageKey,
      );

      authenticityShortSha = reserved.shas.short;
    }

    const html = this.offerPdfTemplateService.buildHtml(
      offer,
      lineItems,
      issuer,
      buyer,
      presentation,
      authenticityShortSha,
    );
    const pdfBytes = await this.invoicePdfHtmlRendererService.renderHtmlToPdf(html);
    const embedded = await this.eInvoiceEmbedService.embedXmlInPdf(
      pdfBytes,
      xml,
      facturXMetadata(presentation.documentTitle, presentation.documentNumber, issuer),
    );
    const content = Buffer.from(embedded);

    await this.fileStorage.writeCustomerOfferFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.customerOffers,
      storageKey,
      content,
    });

    return storageKey;
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    return await this.fileStorage.readCustomerOfferFile(storageKey);
  }
}
