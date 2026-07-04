import axios from 'axios';

import { ChatwootApiError, ChatwootApiService } from './chatwoot-api.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatwootApiService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      CHATWOOT_BASE_URL: 'https://chat.example.com',
      CHATWOOT_API_ACCESS_TOKEN: 'token',
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '7',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports configured when env vars are present', () => {
    const service = new ChatwootApiService();

    expect(service.isConfigured()).toBe(true);
  });

  it('searches contacts with api_access_token header', async () => {
    mockedAxios.request.mockResolvedValue({
      status: 200,
      data: { payload: [{ id: 5, contact_inboxes: [] }] },
    });

    const service = new ChatwootApiService();
    const result = await service.searchContacts('alice@example.com');

    expect(result).toHaveLength(1);
    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://chat.example.com/api/v1/accounts/1/contacts/search',
        headers: expect.objectContaining({ api_access_token: 'token' }),
        params: { q: 'alice@example.com' },
      }),
    );
  });

  it('throws ChatwootApiError on 4xx responses', async () => {
    mockedAxios.request.mockResolvedValue({ status: 403, data: {} });

    const service = new ChatwootApiService();

    await expect(service.searchContacts('alice@example.com')).rejects.toBeInstanceOf(ChatwootApiError);
  });

  it('creates conversation with inbox id', async () => {
    mockedAxios.request.mockResolvedValue({ status: 200, data: { id: 99 } });

    const service = new ChatwootApiService();
    const id = await service.createConversation({
      source_id: 'src-1',
      contact_id: 5,
      status: 'open',
      message: { content: 'Hello' },
    });

    expect(id).toBe(99);
    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://chat.example.com/api/v1/accounts/1/conversations',
        data: expect.objectContaining({ inbox_id: 7, source_id: 'src-1' }),
      }),
    );
  });

  it('creates contact inbox for an existing contact', async () => {
    mockedAxios.request.mockResolvedValue({
      status: 200,
      data: { source_id: 'api-src-5', inbox: { id: 7 } },
    });

    const service = new ChatwootApiService();
    const contactInbox = await service.createContactInbox(5, 'api-src-5');

    expect(contactInbox.source_id).toBe('api-src-5');
    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://chat.example.com/api/v1/accounts/1/contacts/5/contact_inboxes',
        data: { inbox_id: 7, source_id: 'api-src-5' },
      }),
    );
  });
});
