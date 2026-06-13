import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

@Injectable()
export class EInvoiceEmbedService {
  /**
   * Embeds EN 16931 XML into a PDF as an attached file (ZUGFeRD / Factur-X style).
   */
  async embedXmlInPdf(pdfBytes: Uint8Array, xmlContent: string, filename = 'zugferd-invoice.xml'): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const xmlBytes = new TextEncoder().encode(xmlContent);

    await pdfDoc.attach(xmlBytes, filename, {
      mimeType: 'application/xml',
      description: 'ZUGFeRD / EN 16931 invoice data',
      creationDate: new Date(),
      modificationDate: new Date(),
    });

    return await pdfDoc.save();
  }
}
