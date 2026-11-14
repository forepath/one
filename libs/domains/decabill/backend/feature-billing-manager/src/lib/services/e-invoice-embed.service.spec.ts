import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';

import { EInvoiceEmbedService, FACTUR_X_FILENAME, FACTUR_X_NAMESPACE } from './e-invoice-embed.service';

describe('EInvoiceEmbedService', () => {
  const service = new EInvoiceEmbedService();
  const xml = '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:x"/>';
  const embed = async (title = 'Invoice INV-2026-00001', author = 'Müller & Söhne <GmbH>') => {
    const basePdf = await PDFDocument.create();

    basePdf.addPage();

    return await PDFDocument.load(await service.embedXmlInPdf(await basePdf.save(), xml, { title, author }), {
      updateMetadata: false,
    });
  };

  it('attaches the CII XML as factur-x.xml (text/xml, AFRelationship Alternative) and references it in /AF', async () => {
    const doc = await embed();
    const names = doc.catalog
      .lookup(PDFName.of('Names'), PDFDict)
      .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
      .lookup(PDFName.of('Names'), PDFArray);
    const fileSpec = names.lookup(1, PDFDict);
    const af = doc.catalog.lookup(PDFName.of('AF'), PDFArray);
    const stream = fileSpec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;

    expect((names.lookup(0) as PDFString).decodeText()).toBe(FACTUR_X_FILENAME);
    expect(fileSpec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Alternative'));
    expect(af.size()).toBe(1);
    expect(stream.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
    expect(Buffer.from(decodePDFRawStream(stream).decode()).toString('utf8')).toBe(xml);
  });

  it('writes PDF/A-3b + Factur-X XMP metadata consistent with the info dictionary', async () => {
    const doc = await embed();
    const metadata = doc.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
    const xmp = Buffer.from(metadata.contents).toString('utf8');

    expect(metadata.dict.has(PDFName.of('Filter'))).toBe(false);
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain(`xmlns:fx="${FACTUR_X_NAMESPACE}"`);
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(xmp).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>');
    expect(xmp).toContain('<rdf:li>Müller &amp; Söhne &lt;GmbH&gt;</rdf:li>');
    expect(doc.getTitle()).toBe('Invoice INV-2026-00001');
    expect(doc.getAuthor()).toBe('Müller & Söhne <GmbH>');
    expect(doc.getProducer()).toBe('Decabill');
    expect(xmp).toContain(
      `<xmp:CreateDate>${doc
        .getCreationDate()!
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')}`,
    );
  });

  it('declares an sRGB PDF/A output intent', async () => {
    const doc = await embed();
    const intent = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);

    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    expect(intent.lookup(PDFName.of('DestOutputProfile'))).toBeDefined();
  });

  it('writes a file identifier into the trailer (PDF/A 6.1.3)', async () => {
    const basePdf = await PDFDocument.create();

    basePdf.addPage();
    const bytes = await service.embedXmlInPdf(await basePdf.save(), xml, { title: 'Invoice 1', author: 'Issuer' });
    const trailer = Buffer.from(bytes).toString('latin1').split('trailer').pop() ?? '';

    expect(trailer).toMatch(/\/ID\s*\[\s*<[0-9A-F]{32}>\s*<[0-9A-F]{32}>\s*\]/i);
  });

  it('strips control characters from metadata', async () => {
    const doc = await embed('Invoice\u0000 INV-1\n', 'Issuer');

    expect(doc.getTitle()).toBe('Invoice INV-1');
  });
});
