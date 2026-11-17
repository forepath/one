import { BadRequestException, NotFoundException } from '@nestjs/common';

import { InventorySerialUnitStatus } from '../constants/inventory.constants';

import { InventoryLabelsService } from './inventory-labels.service';

describe('InventoryLabelsService', () => {
  const plain = { id: 'a1', articleNumber: 'ART-000001', name: 'Cable', ean: '4006381333931', serialTracking: false };
  const noEan = { id: 'a2', articleNumber: 'ART-000002', name: 'Mouse', ean: null, serialTracking: false };
  const laptop = { id: 'a3', articleNumber: 'ART-000003', name: 'Laptop', ean: null, serialTracking: true };
  const articles = [plain, noEan, laptop];
  const unit = (id: string, serialNumber: string) => ({ id, serialNumber, articleId: 'a3', article: laptop });
  const articlesRepository = {
    findByIds: jest.fn(async (ids: string[]) => articles.filter((article) => ids.includes(article.id))),
  };
  const serialUnits = { findAll: jest.fn() };
  const htmlRenderer = { renderHtmlToPdf: jest.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) };
  const issuer = {
    name: 'ACME GmbH',
    addressLine1: 'Weg 1',
    postalCode: '10115',
    city: 'Berlin',
    email: 'it@acme.test',
  };
  const billingIssuerConfig = { getConfig: jest.fn(() => issuer) };
  const service = new InventoryLabelsService(
    articlesRepository as never,
    serialUnits as never,
    htmlRenderer as never,
    billingIssuerConfig as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    serialUnits.findAll.mockImplementation(
      async (_limit: number, _offset: number, filters: Record<string, unknown>) => {
        if (filters.ids) {
          const all = [unit('u1', 'SN-1'), unit('u2', 'SN-2')];

          return { items: all.filter((entry) => (filters.ids as string[]).includes(entry.id)), total: 0 };
        }

        expect(filters.statuses).toEqual([InventorySerialUnitStatus.IN_STOCK, InventorySerialUnitStatus.LENT]);

        return { items: [unit('u1', 'SN-1'), unit('u2', 'SN-2')], total: 2 };
      },
    );
  });

  it('builds article number and EAN labels, skipping articles without an EAN', async () => {
    const labels = await service.buildLabels({ kinds: ['article_number', 'ean'], articleIds: ['a1', 'a2'] });

    expect(labels.map((label) => `${label.kind}:${label.title}`)).toEqual([
      'article_number:Cable',
      'ean:Cable',
      'article_number:Mouse',
    ]);
    expect(labels[0]!.barcodeSvg).toContain('<svg');
  });

  it('prints property stickers per tracked unit of serial-tracked articles, with the company as owner', async () => {
    const labels = await service.buildLabels({ kinds: ['property'], articleIds: ['a3', 'a1'], copies: 2 });

    expect(labels).toHaveLength(6);
    expect(labels[0]).toEqual(
      expect.objectContaining({
        property: true,
        ownerName: 'ACME GmbH',
        ownerAddress: 'Weg 1, 10115 Berlin',
        ownerContact: 'it@acme.test',
        title: 'Laptop, ART-000003',
      }),
    );
    expect(labels[0]!.barcodeSvg).toContain('SN-1');
    expect(labels[4]!.title).toBe('Cable');
  });

  it('prints labels of selected units with their serial number', async () => {
    const labels = await service.buildLabels({ kinds: ['article_number'], serialUnitIds: ['u2'] });

    expect(labels).toEqual([expect.objectContaining({ title: 'Laptop', serialNumber: 'SN-2' })]);
  });

  it('rejects empty selections, foreign ids, nothing printable and oversized jobs', async () => {
    await expect(service.buildLabels({ kinds: ['ean'] })).rejects.toThrow(BadRequestException);
    await expect(service.buildLabels({ kinds: ['ean'], articleIds: ['foreign'] })).rejects.toThrow(NotFoundException);
    await expect(service.buildLabels({ kinds: ['ean'], serialUnitIds: ['nope'] })).rejects.toThrow(NotFoundException);
    await expect(service.buildLabels({ kinds: ['ean'], articleIds: ['a2'] })).rejects.toThrow(/Nothing to print/);

    serialUnits.findAll.mockResolvedValueOnce({
      items: Array.from({ length: 600 }, (_, index) => unit(`u${index}`, `SN-${index}`)),
      total: 600,
    });

    await expect(service.buildLabels({ kinds: ['property'], articleIds: ['a3'], copies: 2 })).rejects.toThrow(
      /At most 1000/,
    );
  });

  it('needs the company name for property stickers', async () => {
    billingIssuerConfig.getConfig.mockReturnValueOnce({ ...issuer, name: '' });

    await expect(service.buildLabels({ kinds: ['property'], articleIds: ['a1'] })).rejects.toThrow(
      /BILLING_ISSUER_NAME/,
    );
  });

  it('renders one PDF with the label page size', async () => {
    const result = await service.render({ kinds: ['article_number'], articleIds: ['a1'], layout: 'single' });

    expect(result.count).toBe(1);
    expect(result.fileName).toMatch(/^labels-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(htmlRenderer.renderHtmlToPdf).toHaveBeenCalledWith(expect.stringContaining('size: 70mm 37mm'), {
      cssPageSize: true,
    });
  });

  it('exposes the sticker owner for previews', () => {
    expect(service.ownerInfo()).toEqual({ name: 'ACME GmbH', address: 'Weg 1, 10115 Berlin', contact: 'it@acme.test' });

    billingIssuerConfig.getConfig.mockReturnValueOnce({ ...issuer, name: ' ', email: undefined } as never);

    expect(service.ownerInfo()).toEqual({ name: null, address: 'Weg 1, 10115 Berlin', contact: null });
  });
});
