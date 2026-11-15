import { EInvoiceInboundParseService } from './e-invoice-inbound-parse.service';

describe('EInvoiceInboundParseService', () => {
  const service = new EInvoiceInboundParseService();

  it('parses minimal EN16931 XML', async () => {
    const xml = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocument>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260115</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:Name>Hosting</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>100.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity>1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
    const result = await service.parseDocument(Buffer.from(xml, 'utf8'), 'application/xml');

    expect(result.issueDate).toBe('2026-01-15');
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]?.description).toBe('Hosting');
  });

  it('returns warnings for unsupported content', async () => {
    const result = await service.parseDocument(Buffer.from('not-an-invoice', 'utf8'), 'text/plain');

    expect(result.lineItems).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
