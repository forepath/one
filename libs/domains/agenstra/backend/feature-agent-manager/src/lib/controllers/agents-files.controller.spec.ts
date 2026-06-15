import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateFileDto } from '../dto/create-file.dto';
import { FileContentDto } from '../dto/file-content.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { MoveFileDto } from '../dto/move-file.dto';
import { WriteFileDto } from '../dto/write-file.dto';
import { AgentFileSystemService } from '../services/agent-file-system.service';

import { AgentsFilesController } from './agents-files.controller';

describe('AgentsFilesController', () => {
  let controller: AgentsFilesController;
  let service: jest.Mocked<AgentFileSystemService>;
  const mockAgentId = 'test-agent-uuid';
  const mockFilePath = 'test-file.txt';
  const mockDirectoryPath = 'test-directory';
  const mockFileContent: FileContentDto = {
    content: 'Hello, World!',
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
  const mockService = {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    listDirectory: jest.fn(),
    createFileOrDirectory: jest.fn(),
    deleteFileOrDirectory: jest.fn(),
    moveFileOrDirectory: jest.fn(),
  };

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

  describe('readFile', () => {
    it('should return file content', async () => {
      service.readFile.mockResolvedValue(mockFileContent);

      const result = await controller.readFile(mockAgentId, mockFilePath, undefined);

      expect(result).toEqual(mockFileContent);
      expect(service.readFile).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'app');
    });

    it('should forward config context to service', async () => {
      service.readFile.mockResolvedValue(mockFileContent);

      await controller.readFile(mockAgentId, mockFilePath, 'config');

      expect(service.readFile).toHaveBeenCalledWith(mockAgentId, mockFilePath, 'config');
    });
  });

  describe('writeFile', () => {
    it('should write file content', async () => {
      const writeDto: WriteFileDto = {
        content: 'New content',
      };

      service.writeFile.mockResolvedValue(undefined);

      await controller.writeFile(mockAgentId, mockFilePath, writeDto, undefined);

      expect(service.writeFile).toHaveBeenCalledWith(
        mockAgentId,
        mockFilePath,
        writeDto.content,
        writeDto.encoding,
        'app',
      );
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
    it('should create file with content', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: 'File content',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, mockFilePath, createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(
        mockAgentId,
        mockFilePath,
        'file',
        'File content',
        'app',
      );
    });

    it('should create directory', async () => {
      const createDto: CreateFileDto = {
        type: 'directory',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, mockDirectoryPath, createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(
        mockAgentId,
        mockDirectoryPath,
        'directory',
        undefined,
        'app',
      );
    });

    it('should handle array path parameter', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: 'File content',
      };

      service.createFileOrDirectory.mockResolvedValue(undefined);

      await controller.createFileOrDirectory(mockAgentId, ['nested', 'path', 'file.txt'], createDto, undefined);

      expect(service.createFileOrDirectory).toHaveBeenCalledWith(
        mockAgentId,
        'nested/path/file.txt',
        'file',
        'File content',
        'app',
      );
    });

    it('should throw BadRequestException when path is undefined', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: 'File content',
      };

      await expect(controller.createFileOrDirectory(mockAgentId, undefined, createDto, undefined)).rejects.toThrow(
        'File path is required',
      );
    });

    it('should throw BadRequestException when path is an object', async () => {
      const createDto: CreateFileDto = {
        type: 'file',
        content: 'File content',
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
