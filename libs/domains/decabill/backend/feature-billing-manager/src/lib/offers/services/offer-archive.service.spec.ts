import { BadRequestException, NotFoundException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';

import { OfferArchiveService } from './offer-archive.service';

describe('OfferArchiveService.getPdfBuffer', () => {
  const offersRepository = { update: jest.fn() };
  const offerLineItemsRepository = { findByOfferId: jest.fn() };
  const customerProfilesService = { getByUserId: jest.fn() };
  const billingIssuerConfig = { assertConfigured: jest.fn(), getConfig: jest.fn(() => ({ name: 'Issuer' })) };
  const offerPdfService = { readPdf: jest.fn(), generateAndStore: jest.fn() };

  const service = new OfferArchiveService(
    offersRepository as never,
    offerLineItemsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    customerProfilesService as never,
    billingIssuerConfig as never,
    offerPdfService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const sent = (pdfStorageKey: string | null): OfferEntity =>
    ({ id: 'offer-1', userId: 'user-1', status: OfferStatus.ARCHIVED, pdfStorageKey }) as OfferEntity;
  const pdf = Buffer.from('%PDF');

  beforeEach(() => {
    jest.clearAllMocks();
    customerProfilesService.getByUserId.mockResolvedValue({ userId: 'user-1' });
    offerLineItemsRepository.findByOfferId.mockResolvedValue([{ id: 'line-1' }]);
    offerPdfService.generateAndStore.mockResolvedValue('user-1/offer-1.pdf');
  });

  it('serves the stored file without rendering', async () => {
    offerPdfService.readPdf.mockResolvedValue(pdf);

    await expect(service.getPdfBuffer(sent('user-1/offer-1.pdf'))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).not.toHaveBeenCalled();
  });

  it('renders and stores the PDF of a sent offer that has none (e.g. data created outside the send flow)', async () => {
    offerPdfService.readPdf.mockResolvedValue(pdf);

    await expect(service.getPdfBuffer(sent(null))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'offer-1' }),
      [{ id: 'line-1' }],
      { name: 'Issuer' },
      { userId: 'user-1' },
    );
    expect(offersRepository.update).toHaveBeenCalledWith('offer-1', { pdfStorageKey: 'user-1/offer-1.pdf' });
    expect(offerPdfService.readPdf).toHaveBeenCalledWith('user-1/offer-1.pdf');
  });

  it('re-renders when the stored file is missing or unreadable', async () => {
    offerPdfService.readPdf.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(pdf);

    await expect(service.getPdfBuffer(sent('user-1/gone.pdf'))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).toHaveBeenCalledTimes(1);
  });

  it('never renders a draft, and needs the customer profile to render', async () => {
    await expect(
      service.getPdfBuffer({ ...sent('user-1/offer-1.pdf'), status: OfferStatus.DRAFT } as OfferEntity),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(offerPdfService.readPdf).not.toHaveBeenCalled();

    customerProfilesService.getByUserId.mockResolvedValue(null);
    await expect(service.getPdfBuffer(sent(null))).rejects.toBeInstanceOf(NotFoundException);
    expect(offerPdfService.generateAndStore).not.toHaveBeenCalled();
  });
});
