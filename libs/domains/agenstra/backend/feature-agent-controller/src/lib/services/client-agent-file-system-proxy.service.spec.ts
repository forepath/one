import {
  CreateFileDto,
  FileContentDto,
  FileNodeDto,
  MoveFileDto,
  WriteFileDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentFileSystemProxyService } from './client-agent-file-system-proxy.service';
import { ClientsService } from './clients.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentFileSystemProxyService', () => {
  let service: ClientAgentFileSystemProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  const mockClientId = 'test-client-uuid';
  const mockAgentId = 'test-agent-uuid';
  const mockFilePath = 'test-file.txt';
  const mockDirectoryPath = 'test-directory';
  const mockClientEntity: ClientEntity = {
    id: mockClientId,
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockFileContent: FileContentDto = {
    content: Buffer.from('Hello, World!', 'utf-8').toString('base64'),
    encoding: 'utf-8',
  };
  const mockFileNodes: FileNodeDto[] = [
    {
      name: 'file1.txt',
      type: 'file',
      path: 'file1.txt',
      size: 1024,
      modifiedAt: new Date('2024-01-01'),
    },
    {
      name: 'dir1',
      type: 'directory',
      path: 'dir1',
    },
  ];
  const mockClientsService = {
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentFileSystemProxyService,
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
      ],
    }).compile();

    service = module.get<ClientAgentFileSystemProxyService>(ClientAgentFileSystemProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);

    jest.clearAllMocks();
  });

  describe('readFile', () => {
    it('should proxy read file request successfully with API_KEY auth', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileContent,
      } as any);

      const result = await service.readFile(mockClientId, mockAgentId, mockFilePath);

      expect(result).toEqual(mockFileContent);
      expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/files`),
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
          params: undefined,
        }),
      );
    });

    it('should forward context=config on read', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileContent,
      } as any);

      await service.readFile(mockClientId, mockAgentId, mockFilePath, 'config');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { context: 'config' },
        }),
      );
    });

    it('should proxy read file request successfully with KEYCLOAK auth', async () => {
      const keycloakClient = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.KEYCLOAK,
        apiKey: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(keycloakClient);
      clientsService.getAccessToken.mockResolvedValue('keycloak-jwt-token');
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileContent,
      } as any);

      const result = await service.readFile(mockClientId, mockAgentId, mockFilePath);

      expect(result).toEqual(mockFileContent);
      expect(clientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer keycloak-jwt-token',
          }),
          params: undefined,
        }),
      );
    });

    it('should throw NotFoundException when client not found', async () => {
      clientsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Client not found'));

      await expect(service.readFile(mockClientId, mockAgentId, mockFilePath)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when remote returns 404', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'File not found' },
      } as any);

      await expect(service.readFile(mockClientId, mockAgentId, mockFilePath)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when remote returns 400', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Invalid path' },
      } as any);

      await expect(service.readFile(mockClientId, mockAgentId, mockFilePath)).rejects.toThrow(BadRequestException);
    });
  });

  describe('writeFile', () => {
    it('should proxy write file request successfully', async () => {
      const writeDto: WriteFileDto = {
        content: Buffer.from('New content', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.writeFile(mockClientId, mockAgentId, mockFilePath, writeDto);

      expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/files`),
          data: writeDto,
          params: undefined,
        }),
      );
    });

    it('should forward context=config on write', async () => {
      const writeDto: WriteFileDto = {
        content: Buffer.from('x', 'utf-8').toString('base64'),
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ status: 204, data: undefined } as any);

      await service.writeFile(mockClientId, mockAgentId, mockFilePath, writeDto, 'config');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { context: 'config' },
        }),
      );
    });
  });

  describe('listDirectory', () => {
    it('should proxy list directory request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileNodes,
      } as any);

      const result = await service.listDirectory(mockClientId, mockAgentId, mockDirectoryPath);

      expect(result).toEqual(mockFileNodes);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: { path: mockDirectoryPath },
        }),
      );
    });

    it('should forward context=config on list', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileNodes,
      } as any);

      await service.listDirectory(mockClientId, mockAgentId, '.', 'config');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { path: '.', context: 'config' },
        }),
      );
    });

    it('should use default path when not provided', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockFileNodes,
      } as any);

      await service.listDirectory(mockClientId, mockAgentId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: undefined,
        }),
      );
    });
  });

  describe('createFileOrDirectory', () => {
    it('should proxy create file request successfully', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: undefined,
      } as any);

      await service.createFileOrDirectory(mockClientId, mockAgentId, mockFilePath, createDto);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: createDto,
        }),
      );
    });

    it('should proxy create directory request successfully', async () => {
      const createDto: CreateFileDto = {
        type: 'directory',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: undefined,
      } as any);

      await service.createFileOrDirectory(mockClientId, mockAgentId, mockDirectoryPath, createDto);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: createDto,
        }),
      );
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should proxy delete file request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.deleteFileOrDirectory(mockClientId, mockAgentId, mockFilePath);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should proxy move file request successfully with API_KEY auth', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.moveFileOrDirectory(mockClientId, mockAgentId, mockFilePath, moveDto);

      expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PATCH',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/files`),
          data: moveDto,
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should proxy move file request successfully with KEYCLOAK auth', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };
      const keycloakClient = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.KEYCLOAK,
        apiKey: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(keycloakClient);
      clientsService.getAccessToken.mockResolvedValue('keycloak-jwt-token');
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.moveFileOrDirectory(mockClientId, mockAgentId, mockFilePath, moveDto);

      expect(clientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer keycloak-jwt-token',
          }),
        }),
      );
    });

    it('should throw NotFoundException when remote returns 404', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'File not found' },
      } as any);

      await expect(service.moveFileOrDirectory(mockClientId, mockAgentId, mockFilePath, moveDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when remote returns 400', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Invalid path' },
      } as any);

      await expect(service.moveFileOrDirectory(mockClientId, mockAgentId, mockFilePath, moveDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('error handling', () => {
    it('should handle axios network errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = {
        request: {},
        message: 'Network error',
      } as AxiosError;

      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.readFile(mockClientId, mockAgentId, mockFilePath)).rejects.toThrow(BadRequestException);
    });

    it('should handle axios response errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = {
        response: {
          status: 500,
          data: { message: 'Internal server error' },
        },
        message: 'Request failed',
      } as AxiosError;

      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.readFile(mockClientId, mockAgentId, mockFilePath)).rejects.toThrow(BadRequestException);
    });
  });
});
