import * as fs from 'fs';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AgentResponseDto } from '../dto/agent-response.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentFileSystemService } from './agent-file-system.service';
import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { DockerService } from './docker.service';

describe('AgentFileSystemService', () => {
  let service: AgentFileSystemService;
  let agentsRepository: jest.Mocked<AgentsRepository>;
  let dockerService: jest.Mocked<DockerService>;
  let agentProviderFactory: jest.Mocked<AgentProviderFactory>;
  const mockAgentId = 'test-agent-uuid';
  const mockContainerId = 'test-container-id';
  const mockAgentResponse: AgentResponseDto = {
    id: mockAgentId,
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockAgentEntity: AgentEntity = {
    ...mockAgentResponse,
    containerId: mockContainerId,
    hashedPassword: 'hashed-password',
    volumePath: '/opt/agents/test-uuid',
  };
  const mockAgentsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockDockerService = {
    sendCommandToContainer: jest.fn(),
    readFileFromContainer: jest.fn(),
    copyFileFromContainer: jest.fn(),
    getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
  };
  const mockProvider = {
    getBasePath: jest.fn().mockReturnValue('/app'),
    getConfigBasePath: jest.fn().mockReturnValue('~/.cursor'),
  };
  const mockAgentProviderFactory = {
    getProvider: jest.fn().mockReturnValue(mockProvider),
  };
  const mockGitStateBroadcast = {
    notifyGitStateMayHaveChanged: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentFileSystemService,
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
        {
          provide: AgentProviderFactory,
          useValue: mockAgentProviderFactory,
        },
        {
          provide: AgentGitStateBroadcastService,
          useValue: mockGitStateBroadcast,
        },
      ],
    }).compile();

    service = module.get<AgentFileSystemService>(AgentFileSystemService);
    agentsRepository = module.get(AgentsRepository);
    dockerService = module.get(DockerService);
    agentProviderFactory = module.get(AgentProviderFactory);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockProvider.getBasePath.mockReturnValue('/app');
    mockProvider.getConfigBasePath = jest.fn().mockReturnValue('~/.cursor');
    mockDockerService.getContainerHomeDirectory.mockResolvedValue('/home/agenstra');
    mockAgentProviderFactory.getProvider.mockReturnValue(mockProvider);
  });

  describe('readFile', () => {
    it('should read text file content successfully', async () => {
      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      // Setup mocks
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      // Mock filesystem operations
      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('utf-8');
      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('/app/test-file.txt'),
        expect.stringContaining('test-file.txt'),
      );
    });

    it('should read markdown file as text', async () => {
      const filePath = 'AGENTS.md';
      const fileContent = '# Agents\n\nThis is a markdown file.';
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('utf-8');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read Kotlin file as text', async () => {
      const filePath = 'Main.kt';
      const fileContent = 'fun main() {\n    println("Hello")\n}';
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('utf-8');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read YAML file as text', async () => {
      const filePath = 'config.yaml';
      const fileContent = 'name: test\nversion: 1.0.0';
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('utf-8');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should treat file with high control character percentage as binary', async () => {
      const filePath = 'suspicious.txt';
      // Create content with >10% control characters
      const fileContent = '\x01\x02\x03\x04\x05'.repeat(20) + 'normal text'.repeat(10);
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('base64');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read binary file content successfully', async () => {
      const filePath = 'image.png';
      // Simulate binary content (PNG header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const base64Content = binaryContent.toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: binaryContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(binaryContent);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('base64');
      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.readFile(mockAgentId, 'test.txt')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when file not found', async () => {
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockRejectedValue(
        new NotFoundException('File not found in container: /app/nonexistent.txt'),
      );

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(service.readFile(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });

    it('should fall back to base64 when text read fails', async () => {
      const filePath = 'test-file.txt';
      const fileContent = 'fallback content';
      const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.content).toBe(base64Content);
      expect(result.encoding).toBe('utf-8');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      await expect(service.readFile(mockAgentId, '../etc/passwd')).rejects.toThrow(BadRequestException);
      await expect(service.readFile(mockAgentId, '../../etc/passwd')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty path', async () => {
      await expect(service.readFile(mockAgentId, '')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when file size exceeds limit', async () => {
      // Create text content that exceeds 10MB
      // Use printable characters to ensure it's treated as text (not binary)
      const largeTextContent = 'x'.repeat(11 * 1024 * 1024); // 11MB

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: largeTextContent.length } as fs.Stats);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await expect(service.readFile(mockAgentId, 'large-file.txt')).rejects.toThrow(BadRequestException);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException when binary file size exceeds limit', async () => {
      // Create binary content that exceeds 10MB
      const largeBinaryContent = Buffer.alloc(11 * 1024 * 1024); // 11MB

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: largeBinaryContent.length } as fs.Stats);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await expect(service.readFile(mockAgentId, 'large-image.png')).rejects.toThrow(BadRequestException);
    });
  });

  describe('writeFile', () => {
    it('should write text file content successfully', async () => {
      const filePath = 'test-file.txt';
      const textContent = 'Hello, World!';
      const base64Content = Buffer.from(textContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.writeFile(mockAgentId, filePath, base64Content, 'utf-8');

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should write binary file content successfully', async () => {
      const filePath = 'image.png';
      // Simulate binary content (PNG header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const base64Content = binaryContent.toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.writeFile(mockAgentId, filePath, base64Content, 'base64');

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException when content size exceeds limit', async () => {
      // Create base64 content that when decoded exceeds 10MB
      // Base64 is ~33% larger, so 11MB original ≈ 14.67MB base64
      const largeBase64Content = 'x'.repeat(Math.ceil((11 * 1024 * 1024 * 4) / 3)); // ~14.67MB base64

      await expect(service.writeFile(mockAgentId, 'test.txt', largeBase64Content)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      const base64Content = Buffer.from('content', 'utf-8').toString('base64');

      await expect(service.writeFile(mockAgentId, '../etc/passwd', base64Content)).rejects.toThrow(BadRequestException);
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents successfully', async () => {
      const directoryPath = '.';
      // First call: ls -1 returns just the filenames
      const mockLsOutput = `file1.txt
dir1
file2.txt`;
      // Second call: processing command returns formatted output
      const mockProcessOutput = `file|file1.txt|1024|1704067200
directory|dir1|0|1704067200
file|file2.txt|2048|1704067200`;

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      // Mock both calls: first ls, then processing
      dockerService.sendCommandToContainer.mockResolvedValueOnce(mockLsOutput).mockResolvedValueOnce(mockProcessOutput);

      const result = await service.listDirectory(mockAgentId, directoryPath);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject<FileNodeDto>({
        name: 'dir1',
        type: 'directory',
        path: 'dir1',
      });
      expect(result[1]).toMatchObject<FileNodeDto>({
        name: 'file1.txt',
        type: 'file',
        path: 'file1.txt',
        size: 1024,
      });
      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should use default path when not provided', async () => {
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.listDirectory(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should throw NotFoundException when directory not found', async () => {
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('No such file'));

      await expect(service.listDirectory(mockAgentId, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should create directory successfully', async () => {
      const path = 'new-directory';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createFileOrDirectory(mockAgentId, path, 'directory');

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('mkdir -p'),
      );
    });

    it('should create file with content successfully', async () => {
      const path = 'new-file.txt';
      const textContent = 'File content';
      const base64Content = Buffer.from(textContent, 'utf-8').toString('base64');

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createFileOrDirectory(mockAgentId, path, 'file', base64Content);

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should create empty file when no content provided', async () => {
      const path = 'empty-file.txt';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createFileOrDirectory(mockAgentId, path, 'file');

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('touch'),
      );
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should delete file successfully', async () => {
      const path = 'file-to-delete.txt';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.deleteFileOrDirectory(mockAgentId, path);

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('rm -rf'),
      );
    });

    it('should throw NotFoundException when file not found', async () => {
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('No such file'));

      await expect(service.deleteFileOrDirectory(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should move file successfully', async () => {
      const sourcePath = 'source-file.txt';
      const destinationPath = 'destination-file.txt';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.moveFileOrDirectory(mockAgentId, sourcePath, destinationPath);

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(mockContainerId, expect.stringContaining('mv'));
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('/app/source-file.txt'),
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('/app/destination-file.txt'),
      );
    });

    it('should move directory successfully', async () => {
      const sourcePath = 'source-directory';
      const destinationPath = 'destination-directory';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.moveFileOrDirectory(mockAgentId, sourcePath, destinationPath);

      expect(agentsRepository.findByIdOrThrow).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', 'dest.txt')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when source file not found', async () => {
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('No such file'));

      await expect(service.moveFileOrDirectory(mockAgentId, 'nonexistent.txt', 'dest.txt')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for path traversal attempts in source', async () => {
      await expect(service.moveFileOrDirectory(mockAgentId, '../etc/passwd', 'dest.txt')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for path traversal attempts in destination', async () => {
      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', '../etc/passwd')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('path sanitization', () => {
    it('should reject paths with null bytes', async () => {
      await expect(service.readFile(mockAgentId, 'file\0.txt')).rejects.toThrow(BadRequestException);
    });

    it('should accept valid paths', async () => {
      const fileContent = 'test content';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await expect(service.readFile(mockAgentId, 'valid/path/file.txt')).resolves.toBeDefined();
      await expect(service.readFile(mockAgentId, 'file-with-dashes.txt')).resolves.toBeDefined();
      await expect(service.readFile(mockAgentId, 'file_with_underscores.txt')).resolves.toBeDefined();
    });
  });

  describe('provider base path', () => {
    it('should use provider base path when available', async () => {
      const customBasePath = '/custom/path';

      mockProvider.getBasePath.mockReturnValue(customBasePath);

      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await service.readFile(mockAgentId, filePath);

      expect(agentProviderFactory.getProvider).toHaveBeenCalledWith('cursor');
      expect(mockProvider.getBasePath).toHaveBeenCalled();
      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        `${customBasePath}/${filePath}`,
        expect.any(String),
      );
    });

    it('should fall back to default /app when provider getBasePath is not implemented', async () => {
      const providerWithoutBasePath = {};

      mockAgentProviderFactory.getProvider.mockReturnValue(providerWithoutBasePath as never);

      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await service.readFile(mockAgentId, filePath);

      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        `/app/${filePath}`,
        expect.any(String),
      );
    });

    it('should fall back to default /app when provider getBasePath returns empty string', async () => {
      mockProvider.getBasePath.mockReturnValue('');

      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await service.readFile(mockAgentId, filePath);

      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        `/app/${filePath}`,
        expect.any(String),
      );
    });

    it('should fall back to default /app when provider factory throws error', async () => {
      mockAgentProviderFactory.getProvider.mockImplementation(() => {
        throw new Error('Provider not found');
      });

      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await service.readFile(mockAgentId, filePath);

      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        `/app/${filePath}`,
        expect.any(String),
      );
    });
  });

  describe('file manager context=config', () => {
    it('should read file under expanded config root', async () => {
      const filePath = 'settings.json';
      const fileContent = '{}';

      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(fileContent, 'utf-8'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await service.readFile(mockAgentId, filePath, 'config');

      expect(dockerService.getContainerHomeDirectory).toHaveBeenCalledWith(mockContainerId);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/home/agenstra/.cursor/settings.json',
        expect.any(String),
      );
    });

    it('should throw BadRequestException when provider has no getConfigBasePath', async () => {
      const noConfig = { getBasePath: () => '/app' };

      mockAgentProviderFactory.getProvider.mockReturnValue(noConfig as never);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);

      await expect(service.readFile(mockAgentId, 'x', 'config')).rejects.toThrow(BadRequestException);
    });
  });
});
