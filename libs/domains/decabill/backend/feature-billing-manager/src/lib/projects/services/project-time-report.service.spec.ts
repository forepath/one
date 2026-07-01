import { BadRequestException } from '@nestjs/common';

import type { InvoiceEntity } from '../../entities/invoice.entity';

import { ProjectTimeReportService } from './project-time-report.service';

describe('ProjectTimeReportService', () => {
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const timeEntriesRepository = {
    findByProjectInRange: jest.fn(),
    findByInvoiceId: jest.fn(),
  };
  const ticketsRepository = { findTitlesByIds: jest.fn() };
  const timeReportPdfService = {
    renderPdf: jest.fn(),
    generateAndStore: jest.fn(),
    readPdf: jest.fn(),
  };
  const billingIssuerConfig = {
    getConfig: jest.fn().mockReturnValue({ name: 'Forepath GmbH' }),
  };

  let service: ProjectTimeReportService;

  const project = {
    id: 'p1',
    name: 'Website redesign',
  };

  const from = '2026-06-01T08:00:00.000Z';
  const to = '2026-06-01T17:00:00.000Z';

  beforeEach(() => {
    jest.resetAllMocks();
    billingIssuerConfig.getConfig.mockReturnValue({ name: 'Forepath GmbH' });
    service = new ProjectTimeReportService(
      projectsRepository as never,
      timeEntriesRepository as never,
      ticketsRepository as never,
      timeReportPdfService as never,
      billingIssuerConfig as never,
    );
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    ticketsRepository.findTitlesByIds.mockResolvedValue(new Map());
    timeReportPdfService.renderPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  describe('generateLivePdf', () => {
    it('renders PDF for entries in range', async () => {
      timeEntriesRepository.findByProjectInRange.mockResolvedValue([
        {
          startedAt: new Date('2026-06-01T08:00:00.000Z'),
          endedAt: new Date('2026-06-01T09:00:00.000Z'),
          durationMinutes: 60,
          description: 'Planning',
          ticketId: null,
          billedAt: null,
        },
      ]);

      const buffer = await service.generateLivePdf('p1', { from, to });

      expect(buffer).toEqual(Buffer.from(new Uint8Array([1, 2, 3])));
      expect(timeEntriesRepository.findByProjectInRange).toHaveBeenCalledWith(
        'p1',
        expect.any(Date),
        expect.any(Date),
        { unbilledOnly: false },
      );
      expect(timeReportPdfService.renderPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Time report',
          companyName: 'Forepath GmbH',
          projectName: 'Website redesign',
          entries: [
            expect.objectContaining({
              description: 'Planning',
              billingStatus: 'Unbilled',
            }),
          ],
        }),
      );
    });

    it('filters unbilled entries when unbilledOnly is true', async () => {
      timeEntriesRepository.findByProjectInRange.mockResolvedValue([]);

      await service.generateLivePdf('p1', { from, to, unbilledOnly: true });

      expect(timeEntriesRepository.findByProjectInRange).toHaveBeenCalledWith(
        'p1',
        expect.any(Date),
        expect.any(Date),
        { unbilledOnly: true },
      );
    });
  });

  describe('generateAndStoreForBilling', () => {
    it('stores PDF and returns storage key', async () => {
      const invoice = { id: 'inv-1', invoiceNumber: 'INV-1' } as InvoiceEntity;
      const entries = [
        {
          startedAt: new Date('2026-06-01T08:00:00.000Z'),
          endedAt: new Date('2026-06-01T09:00:00.000Z'),
          durationMinutes: 60,
          description: 'Work',
          ticketId: null,
          billedAt: null,
        },
      ];

      timeReportPdfService.generateAndStore.mockResolvedValue('sub-1/inv-1-time-report.pdf');

      const storageKey = await service.generateAndStoreForBilling(
        invoice,
        project as never,
        entries as never,
        new Date(from),
        new Date(to),
      );

      expect(storageKey).toBe('sub-1/inv-1-time-report.pdf');
      expect(timeReportPdfService.generateAndStore).toHaveBeenCalledWith(
        invoice,
        expect.objectContaining({ invoiceNumber: 'INV-1' }),
      );
    });
  });

  describe('getPdfBufferForInvoice', () => {
    it('reads stored PDF when available', async () => {
      const invoice = {
        id: 'inv-1',
        projectId: 'p1',
        timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
      } as InvoiceEntity;
      const buffer = Buffer.from('stored');

      timeReportPdfService.readPdf.mockResolvedValue(buffer);

      await expect(service.getPdfBufferForInvoice(invoice)).resolves.toBe(buffer);
    });

    it('regenerates from billed entries when stored file is missing', async () => {
      const invoice = {
        id: 'inv-1',
        projectId: 'p1',
        invoiceNumber: 'INV-1',
        timeReportStorageKey: 'sub-1/inv-1-time-report.pdf',
      } as InvoiceEntity;

      timeReportPdfService.readPdf.mockRejectedValue(new Error('missing'));
      timeEntriesRepository.findByInvoiceId.mockResolvedValue([
        {
          startedAt: new Date('2026-06-01T08:00:00.000Z'),
          endedAt: new Date('2026-06-01T09:00:00.000Z'),
          durationMinutes: 60,
          description: 'Work',
          ticketId: null,
          billedAt: new Date(),
        },
      ]);
      timeReportPdfService.generateAndStore.mockResolvedValue('sub-1/inv-1-time-report.pdf');

      const buffer = await service.getPdfBufferForInvoice(invoice);

      expect(buffer).toEqual(Buffer.from(new Uint8Array([1, 2, 3])));
      expect(timeReportPdfService.generateAndStore).toHaveBeenCalled();
    });

    it('rejects non-project invoices', async () => {
      await expect(
        service.getPdfBufferForInvoice({ id: 'inv-1', projectId: null } as InvoiceEntity),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
