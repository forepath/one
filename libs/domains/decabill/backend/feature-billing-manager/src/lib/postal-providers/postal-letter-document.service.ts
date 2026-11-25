import { Injectable, Optional } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { PDFDocument, PageSizes } from 'pdf-lib';

import type { PostalAddressPosition } from '../constants/postal-provider.constants';
import {
  BillingDocumentBrandingConfigService,
  DEFAULT_DOCUMENT_BRANDING,
} from '../services/billing-document-branding-config.service';
import type { BillingIssuerConfig } from '../services/billing-issuer-config.service';
import { InvoicePdfHtmlRendererService } from '../services/invoice-pdf-html-renderer.service';
import { loadPostalCoverPageTemplate } from '../templates/postal-cover-page-template.loader';
import { resolveCountryDisplayName } from '../utils/country-display-name.util';

import type { PostalLetterRecipient } from './postal-provider.interface';

export interface BuildPostalLetterParams {
  /** The document first, then attachments printed with it (e.g. the time report of a project invoice). */
  documents: Buffer[];
  recipient: PostalLetterRecipient;
  issuer: BillingIssuerConfig;
  /** Shown on the cover page ("Invoice", "Credit note", "Offer"). */
  documentTitle: string;
  documentNumber: string;
  documentDate?: Date | null;
  addressPosition: PostalAddressPosition;
  /** Prepend a cover page with the address in the envelope window (`BILLING_POSTAL_COVER_PAGE`). */
  coverPage: boolean;
  /** Printed on both sides: every part starts on a new sheet (blank back sides are inserted). */
  duplex: boolean;
  /** Print the sender's return-address line above the address (off when the provider prints its own sender block). */
  returnAddress?: boolean;
}

export interface PostalLetterDocument {
  pdf: Buffer;
  pageCount: number;
  coverPage: boolean;
}

/** Postal address lines are short; longer values are cut (the window has room for ~40 characters per line). */
const ADDRESS_LINE_MAX_LENGTH = 60;

/**
 * Builds the print-ready PDF of a letter: the stored document (unchanged, embedded e-invoice data included), its
 * attachments and, unless disabled, a virtual cover page that carries the recipient address in the envelope window.
 * Decabill's documents print issuer and buyer side by side, so without the cover page a postal provider would not
 * find the address where the window is.
 */
@Injectable()
export class PostalLetterDocumentService {
  private readonly coverTemplate = Handlebars.compile(loadPostalCoverPageTemplate());

  constructor(
    private readonly renderer: InvoicePdfHtmlRendererService,
    @Optional() private readonly brandingConfig?: BillingDocumentBrandingConfigService,
  ) {}

  async build(params: BuildPostalLetterParams): Promise<PostalLetterDocument> {
    if (params.documents.length === 0) {
      throw new Error('A letter needs at least one document');
    }

    const letter = await PDFDocument.load(params.documents[0], { updateMetadata: false });

    for (const attachment of params.documents.slice(1)) {
      if (params.duplex && letter.getPageCount() % 2 === 1) {
        letter.addPage(PageSizes.A4);
      }

      const source = await PDFDocument.load(attachment, { updateMetadata: false });
      const pages = await letter.copyPages(source, source.getPageIndices());

      for (const page of pages) {
        letter.addPage(page);
      }
    }

    if (params.coverPage) {
      const coverBytes = await this.renderer.renderHtmlToPdf(this.renderCoverHtml(params), { cssPageSize: true });
      const cover = await PDFDocument.load(coverBytes);
      const [coverPage] = await letter.copyPages(cover, [0]);

      letter.insertPage(0, coverPage);

      if (params.duplex) {
        letter.insertPage(1, PageSizes.A4);
      }
    }

    const bytes = await letter.save();

    return { pdf: Buffer.from(bytes), pageCount: letter.getPageCount(), coverPage: params.coverPage };
  }

  /** Cover page HTML (exposed for tests). Every value is HTML-escaped by Handlebars. */
  renderCoverHtml(params: BuildPostalLetterParams): string {
    const issuer = params.issuer;
    const returnAddress = [issuer.name, issuer.addressLine1, [issuer.postalCode, issuer.city].filter(Boolean).join(' ')]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');

    return this.coverTemplate({
      branding: this.brandingConfig?.getBranding() ?? DEFAULT_DOCUMENT_BRANDING,
      addressPosition: params.addressPosition === 'right' ? 'right' : 'left',
      senderName: issuer.name,
      returnAddress: params.returnAddress === false ? null : returnAddress,
      recipientLines: formatRecipientLines(params.recipient, issuer.country),
      documentTitle: params.documentTitle,
      documentNumber: params.documentNumber,
      dateLabel: params.documentDate ? formatDate(params.documentDate) : null,
      coverNote: `Please find the ${params.documentTitle.toLowerCase()} ${params.documentNumber} enclosed.`,
      footerLine: [issuer.name, issuer.vatId ? `VAT ID ${issuer.vatId}` : '', issuer.email ?? '']
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' | '),
    });
  }
}

/**
 * Address block in postal order: name lines, street lines, postal code + city, and the country in capitals when the
 * letter leaves the sender's country (UPU addressing).
 */
export function formatRecipientLines(recipient: PostalLetterRecipient, senderCountry: string): string[] {
  const lines = [
    ...recipient.nameLines,
    ...recipient.streetLines,
    [recipient.postalCode, recipient.city].filter(Boolean).join(' '),
  ];

  if (recipient.country.toUpperCase() !== (senderCountry || '').toUpperCase()) {
    lines.push((resolveCountryDisplayName(recipient.country) ?? recipient.country).toUpperCase());
  }

  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, ADDRESS_LINE_MAX_LENGTH))
    .filter((line) => line.length > 0);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
