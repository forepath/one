import { ContentReportService } from '../services/content-report.service';

import { PublicContentReportsController } from './public-content-reports.controller';

describe('PublicContentReportsController', () => {
  let controller: PublicContentReportsController;
  let contentReportService: jest.Mocked<Pick<ContentReportService, 'submitContentReport'>>;

  beforeEach(() => {
    contentReportService = {
      submitContentReport: jest.fn().mockResolvedValue({ accepted: true, referenceId: '42' }),
    };

    controller = new PublicContentReportsController(contentReportService as unknown as ContentReportService);
  });

  it('delegates submission to ContentReportService', async () => {
    const dto = {
      reportType: 'dsa' as const,
      turnstileToken: 'token',
      name: 'Alex',
      email: 'alex@example.com',
      explanation: 'Illegal',
      contentUrls: 'https://example.com/1',
      goodFaithConfirmed: true,
    };

    await expect(controller.submit(dto)).resolves.toEqual({ accepted: true, referenceId: '42' });
    expect(contentReportService.submitContentReport).toHaveBeenCalledWith(dto, undefined);
  });
});
