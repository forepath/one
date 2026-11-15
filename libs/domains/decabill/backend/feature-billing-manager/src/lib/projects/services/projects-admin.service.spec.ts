import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ProjectPricingModel } from '../entities/project.enums';

import { ProjectsAdminService } from './projects-admin.service';

describe('ProjectsAdminService', () => {
  const projectsRepository = {
    findAll: jest.fn(),
    findByIdOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    countBilledTimeEntries: jest.fn(),
    countUnbilledTimeEntries: jest.fn(),
  };
  const projectsService = {
    mapResponse: jest.fn((p) => p),
    buildSummary: jest.fn(),
  };
  const usersRepository = {
    findByIdForTenant: jest.fn(),
  };
  const projectBillingService = {
    billUnbilledTime: jest.fn(),
    getUnbilledTimeBounds: jest.fn(),
  };
  const projectTimeReportService = {
    generateLivePdf: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishProject: jest.fn(),
  };
  const billingSearchIndexService = { scheduleUpsert: jest.fn(), scheduleDelete: jest.fn() };
  let service: ProjectsAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectsAdminService(
      projectsRepository as never,
      projectsService as never,
      usersRepository as never,
      projectBillingService as never,
      projectTimeReportService as never,
      billingNotificationPublisher as never,
      billingSearchIndexService as never,
    );
  });

  it('create requires tenant user via findByIdForTenant', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(service.create({ userId: 'missing', name: 'P', hourlyRateNet: 100 } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create persists optional targetHours', async () => {
    const created = { id: 'p1', targetHours: 40 };

    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'u1' });
    projectsRepository.create.mockResolvedValue(created);
    projectsService.mapResponse.mockReturnValue(created);

    await service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100, targetHours: 40 } as never);

    expect(projectsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ targetHours: 40 }));
    expect(billingNotificationPublisher.publishProject).toHaveBeenCalledWith('project.created', created);
  });

  it('create stores null targetHours when omitted', async () => {
    const created = { id: 'p1', targetHours: null };

    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'u1' });
    projectsRepository.create.mockResolvedValue(created);
    projectsService.mapResponse.mockReturnValue(created);

    await service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100 } as never);

    expect(projectsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ targetHours: null }));
  });

  it('update clears targetHours when null is sent', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(0);
    projectsRepository.update.mockResolvedValue({ id: 'p1', targetHours: null });
    projectsService.mapResponse.mockReturnValue({ id: 'p1', targetHours: null });

    await service.update('p1', { targetHours: null } as never);

    expect(projectsRepository.update).toHaveBeenCalledWith('p1', expect.objectContaining({ targetHours: null }));
  });

  it('update omits targetHours when undefined', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(0);
    projectsRepository.update.mockResolvedValue({ id: 'p1' });
    projectsService.mapResponse.mockReturnValue({ id: 'p1' });

    await service.update('p1', { name: 'Renamed' } as never);

    expect(projectsRepository.update).toHaveBeenCalledWith('p1', expect.objectContaining({ targetHours: undefined }));
  });

  it('delete blocked when unbilled time entries exist', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1' });
    projectsRepository.countUnbilledTimeEntries.mockResolvedValue(2);

    await expect(service.delete('p1')).rejects.toThrow(BadRequestException);
  });

  it('update blocks userId change after billed time', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

    await expect(service.update('p1', { userId: 'u2' })).rejects.toThrow(BadRequestException);
  });

  it('update blocks hourly rate change after first bill', async () => {
    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
    projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

    await expect(service.update('p1', { hourlyRateNet: 120 })).rejects.toThrow(BadRequestException);
  });

  it('billTime delegates dto to billing service', async () => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      lineItems: [{ description: 'Extra', quantity: 1, unitPriceNet: 10 }],
    };

    projectBillingService.billUnbilledTime.mockResolvedValue({ invoiceId: 'inv-1', billedMinutes: 60, amountNet: 110 });

    const result = await service.billTime('p1', 'admin-1', dto);

    expect(result.invoiceId).toBe('inv-1');
    expect(projectBillingService.billUnbilledTime).toHaveBeenCalledWith('p1', 'admin-1', dto);
  });

  it('getUnbilledTimeBounds delegates to billing service', async () => {
    const from = new Date('2026-06-01T08:00:00.000Z');
    const to = new Date('2026-06-01T17:00:00.000Z');

    projectBillingService.getUnbilledTimeBounds.mockResolvedValue({ from, to, entryCount: 2 });

    const bounds = await service.getUnbilledTimeBounds('p1');

    expect(bounds.entryCount).toBe(2);
  });

  it('generateTimeReport delegates to time report service', async () => {
    const dto = {
      from: '2026-06-01T08:00:00.000Z',
      to: '2026-06-01T17:00:00.000Z',
      unbilledOnly: true,
    };
    const buffer = Buffer.from('pdf');

    projectTimeReportService.generateLivePdf.mockResolvedValue(buffer);

    await expect(service.generateTimeReport('p1', dto)).resolves.toBe(buffer);
    expect(projectTimeReportService.generateLivePdf).toHaveBeenCalledWith('p1', dto);
  });

  describe('pricing models', () => {
    beforeEach(() => {
      usersRepository.findByIdForTenant.mockResolvedValue({ id: 'u1' });
      projectsRepository.create.mockImplementation(async (dto) => ({ id: 'p1', ...dto }));
      projectsRepository.update.mockImplementation(async (id, dto) => ({ id, ...dto }));
    });

    it('create defaults to hourly without a price limit', async () => {
      await service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100, priceLimitNet: 500 } as never);

      expect(projectsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ pricingModel: ProjectPricingModel.HOURLY, priceLimitNet: null }),
      );
    });

    it('create stores capped and fixed pricing with a limit', async () => {
      await service.create({
        userId: 'u1',
        name: 'P',
        hourlyRateNet: 100,
        pricingModel: ProjectPricingModel.CAPPED,
        priceLimitNet: 4800,
      } as never);

      expect(projectsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 4800 }),
      );
    });

    it.each([ProjectPricingModel.CAPPED, ProjectPricingModel.FIXED])(
      'create rejects %s without a price limit',
      async (pricingModel) => {
        await expect(
          service.create({ userId: 'u1', name: 'P', hourlyRateNet: 100, pricingModel } as never),
        ).rejects.toThrow(BadRequestException);
        expect(projectsRepository.create).not.toHaveBeenCalled();
      },
    );

    it('update leaves pricing untouched when not sent', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(0);

      await service.update('p1', { name: 'Renamed' } as never);

      expect(projectsRepository.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ pricingModel: undefined, priceLimitNet: undefined }),
      );
    });

    it('update switches to fixed before the first bill and keeps the stored limit when only the model changes', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        hourlyRateNet: 100,
        pricingModel: ProjectPricingModel.CAPPED,
        priceLimitNet: '3000.0000',
      });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(0);

      await service.update('p1', { pricingModel: ProjectPricingModel.FIXED } as never);

      expect(projectsRepository.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ pricingModel: ProjectPricingModel.FIXED, priceLimitNet: 3000 }),
      );
    });

    it('update rejects capped pricing without a limit', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(0);

      await expect(service.update('p1', { pricingModel: ProjectPricingModel.CAPPED } as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('update locks the pricing model after the first bill', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        hourlyRateNet: 100,
        pricingModel: ProjectPricingModel.HOURLY,
        priceLimitNet: null,
        billedAmountNet: 200,
      });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

      await expect(
        service.update('p1', { pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 1000 } as never),
      ).rejects.toThrow(/Pricing model is locked/);
    });

    it('update allows raising the limit after the first bill but not below the billed amount', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        hourlyRateNet: 100,
        pricingModel: ProjectPricingModel.CAPPED,
        priceLimitNet: '1000.0000',
        billedAmountNet: '800.0000',
      });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(1);

      await service.update('p1', {
        hourlyRateNet: 100,
        pricingModel: ProjectPricingModel.CAPPED,
        priceLimitNet: 1500,
      } as never);

      expect(projectsRepository.update).toHaveBeenCalledWith('p1', expect.objectContaining({ priceLimitNet: 1500 }));

      await expect(
        service.update('p1', { pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 700 } as never),
      ).rejects.toThrow(/cannot be lower than the already billed amount/);
    });

    it('update never writes the billed amount counter', async () => {
      projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'u1', hourlyRateNet: 100 });
      projectsRepository.countBilledTimeEntries.mockResolvedValue(0);

      await service.update('p1', { name: 'X', billedAmountNet: 0 } as never);

      expect(projectsRepository.update.mock.calls[0][1]).not.toHaveProperty('billedAmountNet');
    });
  });
});
