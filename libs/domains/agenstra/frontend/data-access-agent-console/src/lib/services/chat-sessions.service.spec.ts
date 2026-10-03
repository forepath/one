import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import type {
  ChatSessionResponseDto,
  CreateChatSessionDto,
  UpdateChatSessionDto,
} from '../state/chat-sessions/chat-sessions.types';

import { ChatSessionsService } from './chat-sessions.service';

describe('ChatSessionsService', () => {
  let service: ChatSessionsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const chatId = 'chat-1';
  const mockSession: ChatSessionResponseDto = {
    id: chatId,
    agentId,
    title: 'Primary',
    kind: 'primary',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            console: {
              urls: {
                restApi: apiUrl,
              },
            },
          },
        },
      ],
    });

    service = TestBed.inject(ChatSessionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listChatSessions', () => {
    it('should return chat sessions list', (done) => {
      service.listChatSessions(clientId, agentId).subscribe((sessions) => {
        expect(sessions).toEqual([mockSession]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats`);

      expect(req.request.method).toBe('GET');
      req.flush([mockSession]);
    });

    it('should include pagination parameters when provided', (done) => {
      service.listChatSessions(clientId, agentId, { limit: 10, offset: 20 }).subscribe((sessions) => {
        expect(sessions).toEqual([mockSession]);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats?limit=10&offset=20`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush([mockSession]);
    });
  });

  describe('countChatSessions', () => {
    it('should return count of chat sessions', (done) => {
      const mockCount = { count: 3 };

      service.countChatSessions(clientId, agentId).subscribe((count) => {
        expect(count).toEqual(mockCount);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats/count`);

      expect(req.request.method).toBe('GET');
      req.flush(mockCount);
    });
  });

  describe('createChatSession', () => {
    it('should create a chat session', (done) => {
      const createDto: CreateChatSessionDto = { title: 'New chat' };
      const created: ChatSessionResponseDto = { ...mockSession, id: 'chat-2', kind: 'user', title: 'New chat' };

      service.createChatSession(clientId, agentId, createDto).subscribe((session) => {
        expect(session).toEqual(created);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(created);
    });
  });

  describe('getChatSession', () => {
    it('should return a chat session', (done) => {
      service.getChatSession(clientId, agentId, chatId).subscribe((session) => {
        expect(session).toEqual(mockSession);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`);

      expect(req.request.method).toBe('GET');
      req.flush(mockSession);
    });
  });

  describe('updateChatSession', () => {
    it('should update a chat session title', (done) => {
      const updateDto: UpdateChatSessionDto = { title: 'Renamed' };
      const updated = { ...mockSession, title: 'Renamed' };

      service.updateChatSession(clientId, agentId, chatId, updateDto).subscribe((session) => {
        expect(session).toEqual(updated);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`);

      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updateDto);
      req.flush(updated);
    });
  });

  describe('deleteChatSession', () => {
    it('should delete a chat session', (done) => {
      service.deleteChatSession(clientId, agentId, chatId).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('listChatSessionMessages', () => {
    it('should return messages for a chat session', (done) => {
      const messages = [
        {
          id: 'msg-1',
          actor: 'user',
          message: 'hello',
          filtered: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      service.listChatSessionMessages(clientId, agentId, chatId).subscribe((result) => {
        expect(result).toEqual(messages);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}/messages`);

      expect(req.request.method).toBe('GET');
      req.flush(messages);
    });
  });
});
