import { BadRequestException, HttpStatus, StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { CreateFileDto } from '../dto/create-file.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { MoveFileDto } from '../dto/move-file.dto';
import { AgentFileSystemService } from '../services/agent-file-system.service';

import { AgentsFilesController } from './agents-files.controller';

describe('AgentsFilesController', () => {
  let controller: AgentsFilesController;
  let service: jest.Mocked<AgentFileSystemService>;
  const mockAgentId = 'test-agent-uuid';
  const mockFilePath = 'test-file.txt';
  const mockDirectoryPath = 'test-directory';
  const mockFileBuffer = Buffer.from('Hello, World!', 'utf-8');
  const mockFileReadResult = {
    buffer: mockFileBuffer,
    fileType: 'text' as const,
    contentType: 'text/plain; charset=utf-8',
    size: mockFileBuffer.length,
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
  const mockService = {
    readFile: jest.fn(),
    probeFile: jest.fn(),
    writeFile: jest.fn(),
    writeFileChunk: jest.fn(),
    listDirectory: jest.fn(),
    createFileOrDirectory: jest.fn(),
    deleteFileOrDirectory: jest.fn(),
    moveFileOrDirectory: jest.fn(),
  };

  function createMockResponse(): Response {
    return {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsFilesController],
      providers: [
        {
          provide: AgentFileSystemService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsFilesController>(AgentsFilesController);
    service = module.get(AgentFileSystemService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('headFile', () => {
    it('should set metadata headers without a body', async () => {
      service.probeFile.mockResolvedValue({
        fileType: 'audio',
        contentType: 'audio/mpeg',
        size: 3304030,
      });
      const res = createMockResponse();

      await controller.headFile(mockAgentId, 'track.mp3', res, undefined);

      expect(service.probeFile).toHaveBeenCalledWith(mockAgentId, 'track.mp3', 'app');
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith('X-File-Type', 'audio');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '3304030');
    });
  });

  describe('readFile', () => {
    it('should return StreamableFile with metadata headers', async () => {
      service.readFile.mockResolvedValue(mockFileReadResult);
      const res = createMockResponse();

      const result = await controller.readFile(mockAgentId, mockFilePath, res, undefined, undefined, undefined);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(service.readFile).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'app');
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith('X-File-Type', 'text');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', String(mockFileBuffer.length));
    });

    it('should forward config context to service', async () => {
      service.readFile.mockResolvedValue(mockFileReadResult);
      const res = createMockResponse();

      await controller.readFile(mockAgentId, mockFilePath, res, undefined, 'config', undefined);

      expect(service.readFile).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'config');
    });

    it('should return 206 for satisfiable Range', async () => {
      service.readFile.mockResolvedValue(mockFileReadResult);
      const res = createMockResponse();

      const result = await controller.readFile(mockAgentId, mockFilePath, res, 'bytes=0-4', undefined, undefined);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.PARTIAL_CONTENT);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', `bytes 0-4/${mockFileBuffer.length}`);
    });

    it('should return 416 for unsatisfiable Range', async () => {
      service.readFile.mockResolvedValue(mockFileReadResult);
      const res = createMockResponse();

      await controller.readFile(mockAgentId, mockFilePath, res, 'bytes=999-1000', undefined, undefined);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', `bytes */${mockFileBuffer.length}`);
    });

    it('should set Content-Disposition when download=true', async () => {
      service.readFile.mockResolvedValue(mockFileReadResult);
      const res = createMockResponse();

      await controller.readFile(mockAgentId, mockFilePath, res, undefined, undefined, 'true');

      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('attachment'));
    });
  });

  describe('writeFile', () => {
    it('should write raw body buffer', async () => {
      const body = Buffer.from('New content', 'utf-8');
      const req = { body } as Request;

      service.writeFile.mockResolvedValue(undefined);

      await controller.writeFile(mockAgentId, mockFilePath, req, undefined, undefined, undefined, undefined);

      expect(service.writeFile).toHaveBeenCalledWith(mockAgentId, mockFilePath, body, 'app');
    });

    it('should write chunk when Content-Range is present', async () => {
      const body = Buffer.from('ab', 'utf-8');
      const req = { body } as Request;

      service.writeFileChunk.mockResolvedValue(undefined);

      await controller.writeFile(mockAgentId, mockFilePath, req, undefined, 'bytes 0-1/4', 'upload-1', 'binary');

      expect(service.writeFileChunk).toHaveBeenCalledWith(
        mockAgentId,
        mockFilePath,
        body,
        { start: 0, end: 1, total: 4 },
        'upload-1',
        'app',
      );
      expect(service.writeFile).not.toHaveBeenCalled();
    });

    it('should reject non-buffer body', async () => {
      const req = { body: { not: 'buffer' } } as unknown as Request;

      await expect(
        controller.writeFile(mockAgentId, mockFilePath, req, undefined, undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listDirectory', () => {
    it('should return directory contents', async () => {
      service.listDirectory.mockResolvedValue(mockFileNodes);

      const result = await controller.listDirectory(mockAgentId, mockDirectoryPath, undefined);

      expect(result).toEqual(mockFileNodes);
      expect(service.listDirectory).toHaveBeenCalledWith(mockAgentId, mockDirectoryPath, 'app');
    });

    it('should use default path when not provided', async () => {
      service.listDirectory.mockResolvedValue(mockFileNodes);

      const result = await controller.listDirectory(mockAgentId, undefined, undefined);

      expect(result).toEqual(mockFileNodes);
      expect(service.listDirectory).toHaveBeenCalledWith(mockAgentId, '.', 'app');
    });

    it('should reject invalid context', async () => {
      await expect(controller.listDirectory(mockAgentId, '.', 'workspace')).rejects.toThrow(BadRequestException);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should create empty file', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, mockFilePath, createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'file', 'app');
    });

    it('should create directory', async () => {
      const createDto: CreateFileDto = {
        type: 'directory',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, mockDirectoryPath, createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(mockAgentId, mockDirectoryPath, 'directory', 'app');
    });

    it('should handle array path parameter', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, ['nested', 'path', 'file.txt'], createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(mockAgentId, 'nested/path/file.txt', 'file', 'app');
    });

    it('should throw BadRequestException when path is undefined', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
      };

      await expect(controller.createFileOrDirectory(mockAgentId, undefined, createDto, undefined)).rejects.toThrow(
        'File path is required',
      );
    });

    it('should throw BadRequestException when path is an object', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
      };

      await expect(
        controller.createFileOrDirectory(mockAgentId, { invalid: 'path' }, createDto, undefined),
      ).rejects.toThrow('File path must be a string or array, got object');
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should delete file or directory', async () => {
      service.deleteFileOrDirectory.mockResolvedValue(undefined);

      await controller.deleteFileOrDirectory(mockAgentId, mockFilePath, undefined);

      expect(service.deleteFileOrDirectory).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'app');
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should move file or directory', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      service.moveFileOrDirectory.mockResolvedValue(undefined);

      await controller.moveFileOrDirectory(mockAgentId, mockFilePath, moveDto, undefined);

      expect(service.moveFileOrDirectory).toHaveBeenCalledWith(mockAgentId, mockFilePath, moveDto.destination, 'app');
    });

    it('should handle array path parameter', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      service.moveFileOrDirectory.mockResolvedValue(undefined);

      await controller.moveFileOrDirectory(mockAgentId, ['nested', 'path', 'file.txt'], moveDto, undefined);

      expect(service.moveFileOrDirectory).toHaveBeenCalledWith(
        mockAgentId,
        'nested/path/file.txt',
        moveDto.destination,
        'app',
      );
    });

    it('should throw BadRequestException when path is undefined', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      await expect(controller.moveFileOrDirectory(mockAgentId, undefined, moveDto, undefined)).rejects.toThrow(
        'File path is required',
      );
    });

    it('should throw BadRequestException when path is an object', async () => {
      const moveDto: MoveFileDto = {
        destination: 'new-location/file.txt',
      };

      await expect(
        controller.moveFileOrDirectory(mockAgentId, { invalid: 'path' }, moveDto, undefined),
      ).rejects.toThrow('File path must be a string or array, got object');
    });

    it('should throw BadRequestException when destination is missing', async () => {
      const moveDto: MoveFileDto = {
        destination: '',
      };

      await expect(controller.moveFileOrDirectory(mockAgentId, mockFilePath, moveDto, undefined)).rejects.toThrow(
        'Destination path is required',
      );
    });
  });
});
