import { BadGatewayException, BadRequestException } from '@nestjs/common';

import { CreateContentReportDto } from '../dto/create-content-report.dto';

import { ChatwootApiError, ChatwootApiService } from './chatwoot-api.service';
import { ContentReportService } from './content-report.service';

describe('ContentReportService', () => {
  const dsaDto = {
    reportType: 'dsa',
    turnstileToken: 'token',
    name: 'Alex',
    email: 'alex@example.com',
    explanation: 'Illegal content explanation',
    contentUrls: 'https://example.com/post/1',
    goodFaithConfirmed: true,
    csamAnonymous: false,
  } as CreateContentReportDto;
  const tcoDto = {
    reportType: 'tco',
    turnstileToken: 'token',
    name: 'Officer',
    email: 'authority@example.gov',
    authorityName: 'Example Authority',
    memberState: 'DE',
    officialName: 'Officer',
    officialRole: 'Analyst',
    orderReference: 'TCO-1',
    orderIssuedAt: '2026-09-09T12:00:00Z',
    contentUrls: 'https://example.com/terror',
    statementOfReasons: 'Reasons',
    redressInformation: 'Redress',
    preferredLanguage: 'en',
    emergencyCase: false,
    authorityAttestation: true,
  } as CreateContentReportDto;
  const validPdf = {
    originalname: 'order.pdf',
    mimetype: 'application/pdf',
    size: 12,
    buffer: Buffer.from('%PDF-1.4 rest'),
  };
  let chatwootApiService: jest.Mocked<
    Pick<
      ChatwootApiService,
      | 'isConfigured'
      | 'getInboxId'
      | 'searchContacts'
      | 'createContact'
      | 'createContactInbox'
      | 'createConversation'
      | 'createMessage'
    >
  >;
  let service: ContentReportService;

  beforeEach(() => {
    chatwootApiService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getInboxId: jest.fn().mockReturnValue(7),
      searchContacts: jest.fn().mockResolvedValue([]),
      createContact: jest.fn().mockResolvedValue({
        id: 10,
        name: 'Alex',
        email: 'alex@example.com',
        phone_number: null,
        identifier: null,
        contact_inboxes: [{ source_id: 'src-10', inbox: { id: 7 } }],
      }),
      createContactInbox: jest.fn(),
      createConversation: jest.fn().mockResolvedValue(123),
      createMessage: jest.fn().mockResolvedValue(456),
    };

    service = new ContentReportService(chatwootApiService as unknown as ChatwootApiService);
  });

  it('submits a DSA notice without attaching a PDF', async () => {
    const result = await service.submitContentReport(dsaDto);

    expect(chatwootApiService.createConversation).toHaveBeenCalled();
    expect(chatwootApiService.createMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: true, referenceId: '123' });
  });

  it('rejects DSA notices that include a PDF', async () => {
    await expect(service.submitContentReport(dsaDto, validPdf)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a valid PDF for TCO reports and attaches it on the incoming user message', async () => {
    chatwootApiService.createContact.mockResolvedValue({
      id: 11,
      name: 'Officer',
      email: 'authority@example.gov',
      phone_number: null,
      identifier: null,
      contact_inboxes: [{ source_id: 'src-11', inbox: { id: 7 } }],
    });

    const result = await service.submitContentReport(tcoDto, validPdf);

    expect(chatwootApiService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 11,
        status: 'open',
      }),
    );
    expect(chatwootApiService.createConversation.mock.calls[0]?.[0]).not.toHaveProperty('message');
    expect(chatwootApiService.createMessage).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        message_type: 'incoming',
        private: false,
        content: expect.stringContaining('TCO'),
        attachments: [
          expect.objectContaining({
            filename: 'order.pdf',
            contentType: 'application/pdf',
          }),
        ],
      }),
    );
    expect(result.referenceId).toBe('123');
  });

  it('rejects TCO reports without a PDF', async () => {
    await expect(service.submitContentReport(tcoDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an anonymous DSA contact when CSAM waiver is set', async () => {
    await service.submitContentReport({
      ...dsaDto,
      name: undefined,
      email: undefined,
      csamAnonymous: true,
    });

    expect(chatwootApiService.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dsa-anonymous@forepath.io',
      }),
    );
  });

  it('does not reuse non-exact email search hits', async () => {
    chatwootApiService.searchContacts.mockResolvedValue([
      {
        id: 99,
        name: 'Other',
        email: 'other@example.com',
        phone_number: null,
        identifier: null,
        contact_inboxes: [{ source_id: 'src-99', inbox: { id: 7 } }],
      },
    ]);

    await service.submitContentReport(dsaDto);

    expect(chatwootApiService.createContact).toHaveBeenCalled();
  });

  it('maps ChatwootApiError to BadGatewayException', async () => {
    chatwootApiService.searchContacts.mockRejectedValue(new ChatwootApiError('failed', 500));

    await expect(service.submitContentReport(dsaDto)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
