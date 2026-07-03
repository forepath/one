import { BadGatewayException } from '@nestjs/common';

import { CreateContactRequestDto } from '../dto/create-contact-request.dto';
import { ChatwootApiError, ChatwootApiService } from './chatwoot-api.service';
import { ContactRequestService } from './contact-request.service';

describe('ContactRequestService', () => {
  const dto: CreateContactRequestDto = {
    name: 'Alice',
    email: 'alice@example.com',
    message: 'Need help',
    turnstileToken: 'token',
  };

  let chatwootApiService: jest.Mocked<
    Pick<
      ChatwootApiService,
      'isConfigured' | 'getInboxId' | 'searchContacts' | 'createContact' | 'createContactInbox' | 'createConversation'
    >
  >;
  let service: ContactRequestService;

  beforeEach(() => {
    chatwootApiService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getInboxId: jest.fn().mockReturnValue(7),
      searchContacts: jest.fn(),
      createContact: jest.fn(),
      createContactInbox: jest.fn(),
      createConversation: jest.fn(),
    };

    service = new ContactRequestService(chatwootApiService as unknown as ChatwootApiService);
  });

  it('creates a new contact and conversation when search misses', async () => {
    chatwootApiService.searchContacts.mockResolvedValue([]);
    chatwootApiService.createContact.mockResolvedValue({
      id: 10,
      name: 'Alice',
      email: 'alice@example.com',
      phone_number: null,
      identifier: null,
      contact_inboxes: [{ source_id: 'src-10', inbox: { id: 7 } }],
    });
    chatwootApiService.createConversation.mockResolvedValue(123);

    const result = await service.submitContactRequest(dto);

    expect(chatwootApiService.createContact).toHaveBeenCalled();
    expect(chatwootApiService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: 10, source_id: 'src-10' }),
    );
    expect(result).toEqual({ accepted: true, referenceId: '123' });
  });

  it('reuses existing contact found by email', async () => {
    chatwootApiService.searchContacts.mockResolvedValue([
      {
        id: 11,
        name: 'Alice',
        email: 'alice@example.com',
        phone_number: null,
        identifier: null,
        contact_inboxes: [{ source_id: 'src-11', inbox: { id: 7 } }],
      },
    ]);
    chatwootApiService.createConversation.mockResolvedValue(456);

    const result = await service.submitContactRequest(dto);

    expect(chatwootApiService.createContact).not.toHaveBeenCalled();
    expect(result.referenceId).toBe('456');
  });

  it('searches by phone when email search misses', async () => {
    chatwootApiService.searchContacts.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 12,
        name: 'Alice',
        email: 'alice@example.com',
        phone_number: '+49123',
        identifier: null,
        contact_inboxes: [{ source_id: 'src-12', inbox: { id: 7 } }],
      },
    ]);
    chatwootApiService.createConversation.mockResolvedValue(789);

    const result = await service.submitContactRequest({ ...dto, phone: '+49123' });

    expect(chatwootApiService.searchContacts).toHaveBeenCalledTimes(2);
    expect(result.referenceId).toBe('789');
  });

  it('throws BadGatewayException when Chatwoot is not configured', async () => {
    chatwootApiService.isConfigured.mockReturnValue(false);

    await expect(service.submitContactRequest(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('links existing contact to API inbox when source_id is missing', async () => {
    chatwootApiService.searchContacts.mockResolvedValue([
      {
        id: 13,
        name: 'Alice',
        email: 'alice@example.com',
        phone_number: null,
        identifier: null,
        contact_inboxes: [{ source_id: 'widget-src', inbox: { id: 2 } }],
      },
    ]);
    chatwootApiService.createContactInbox.mockResolvedValue({
      source_id: 'api-src-13',
      inbox: { id: 7 },
    });
    chatwootApiService.createConversation.mockResolvedValue(321);

    const result = await service.submitContactRequest(dto);

    expect(chatwootApiService.createContactInbox).toHaveBeenCalledWith(13);
    expect(chatwootApiService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: 13, source_id: 'api-src-13' }),
    );
    expect(result.referenceId).toBe('321');
  });

  it('maps ChatwootApiError to BadGatewayException', async () => {
    chatwootApiService.searchContacts.mockRejectedValue(new ChatwootApiError('failed', 500));

    await expect(service.submitContactRequest(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
