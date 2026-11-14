import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';
import { AFRelationship, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { buildSrgbIccProfile, SRGB_ICC_PROFILE_DESCRIPTION } from '../utils/srgb-icc-profile.util';

/** Factur-X 1.0 / ZUGFeRD 2.x: fixed attachment name and XMP extension namespace. */
export const FACTUR_X_FILENAME = 'factur-x.xml';
export const FACTUR_X_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';
export const FACTUR_X_CONFORMANCE_LEVEL = 'EN 16931';

const PRODUCER = 'Decabill';
/** XMP packet header byte-order mark (escaped: a literal U+FEFF is irregular whitespace). */
const XMP_BOM = '\uFEFF';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

export interface FacturXDocumentMetadata {
  /** Document title (Info /Title and dc:title), e.g. "Invoice INV-2026-00001". */
  title: string;
  /** Issuer name (Info /Author and dc:creator). */
  author: string;
}

@Injectable()
export class EInvoiceEmbedService {
  /**
   * Turns a rendered PDF into a Factur-X (ZUGFeRD 2.x) EN 16931 hybrid invoice: PDF/A-3b identification and Factur-X
   * XMP metadata, an sRGB output intent, and the CII XML attached as `factur-x.xml` (AFRelationship Alternative).
   */
  async embedXmlInPdf(
    pdfBytes: Uint8Array,
    xmlContent: string,
    metadata: FacturXDocumentMetadata = { title: 'Invoice', author: PRODUCER },
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const title = sanitizeMetadataText(metadata.title) || 'Invoice';
    const author = sanitizeMetadataText(metadata.author) || PRODUCER;

    await pdfDoc.attach(new TextEncoder().encode(xmlContent), FACTUR_X_FILENAME, {
      mimeType: 'text/xml',
      description: 'Factur-X / ZUGFeRD EN 16931 invoice data',
      creationDate: now,
      modificationDate: now,
      afRelationship: AFRelationship.Alternative,
    });

    // Document information dictionary; every entry is mirrored in the XMP packet (PDF/A metadata consistency).
    pdfDoc.setTitle(title);
    pdfDoc.setAuthor(author);
    pdfDoc.setCreator(PRODUCER);
    pdfDoc.setProducer(PRODUCER);
    pdfDoc.setCreationDate(now);
    pdfDoc.setModificationDate(now);
    removeInfoEntries(pdfDoc, ['Subject', 'Keywords', 'Trapped']);

    // Uncompressed UTF-8 packet (PDF/A forbids filters on the metadata stream).
    const metadataStream = pdfDoc.context.stream(new TextEncoder().encode(buildXmp({ title, author, date: now })), {
      Type: 'Metadata',
      Subtype: 'XML',
    });

    pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(metadataStream));

    const iccStream = pdfDoc.context.flateStream(buildSrgbIccProfile(), { N: 3 });
    const outputIntent = pdfDoc.context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of(SRGB_ICC_PROFILE_DESCRIPTION),
      Info: PDFString.of(SRGB_ICC_PROFILE_DESCRIPTION),
      DestOutputProfile: pdfDoc.context.register(iccStream),
    });

    pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([pdfDoc.context.register(outputIntent)]));

    // PDF/A (ISO 19005-3, 6.1.3): the trailer needs a file identifier; both parts are equal for a newly written file.
    const fileId = PDFHexString.of(
      createHash('md5').update(xmlContent).update(title).update(now.toISOString()).digest('hex'),
    );

    pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([fileId, fileId]);

    return await pdfDoc.save({ useObjectStreams: false });
  }
}

function removeInfoEntries(pdfDoc: PDFDocument, keys: string[]): void {
  const infoRef = pdfDoc.context.trailerInfo.Info;
  const info = infoRef ? pdfDoc.context.lookup(infoRef) : undefined;

  if (info && 'delete' in info && typeof info.delete === 'function') {
    for (const key of keys) {
      info.delete(PDFName.of(key));
    }
  }
}

/** Single-line text without control characters (Info strings and XMP values must stay consistent). */
function sanitizeMetadataText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmpDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildXmp({ title, author, date }: { title: string; author: string; date: Date }): string {
  const fxProperty = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;

  return `<?xpacket begin="${XMP_BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escapeXml(author)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${PRODUCER}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${PRODUCER}</xmp:CreatorTool>
      <xmp:CreateDate>${xmpDate(date)}</xmp:CreateDate>
      <xmp:ModifyDate>${xmpDate(date)}</xmp:ModifyDate>
      <xmp:MetadataDate>${xmpDate(date)}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="${FACTUR_X_NAMESPACE}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTUR_X_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${FACTUR_X_CONFORMANCE_LEVEL}</fx:ConformanceLevel>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FACTUR_X_NAMESPACE}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProperty('DocumentFileName', 'The name of the embedded XML document')}${fxProperty(
                'DocumentType',
                'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER',
              )}${fxProperty('Version', 'The actual version of the standard applying to the embedded XML document')}${fxProperty(
                'ConformanceLevel',
                'The conformance level of the embedded XML document',
              )}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
