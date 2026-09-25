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
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

describe('AgentFileSystemService', () => {
  let service: AgentFileSystemService;
  let agentsService: jest.Mocked<AgentsService>;
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
    chats: [
      {
        id: 'primary-chat-id',
        title: 'Chat',
        kind: 'primary',
        createdAt: new Date('2024-01-01'),
      },
    ],
    primaryChatId: 'primary-chat-id',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockAgentEntity: AgentEntity = {
    ...mockAgentResponse,
    containerId: mockContainerId,
    hashedPassword: 'hashed-password',
    volumePath: '/opt/agents/test-uuid',
  };
  const mockAgentsService = {
    findOne: jest.fn(),
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
          provide: AgentsService,
          useValue: mockAgentsService,
        },
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
    agentsService = module.get(AgentsService);
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
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      // Setup mocks
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      // Mock filesystem operations
      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(result.contentType).toBe('text/plain; charset=utf-8');
      expect(result.size).toBe(fileContent.length);
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('/app/test-file.txt'),
        expect.stringContaining('test-file.txt'),
      );
    });

    it('should read markdown file as text', async () => {
      const filePath = 'AGENTS.md';
      const fileContent = '# Agents\n\nThis is a markdown file.';
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read Kotlin file as text', async () => {
      const filePath = 'Main.kt';
      const fileContent = 'fun main() {\n    println("Hello")\n}';
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read YAML file as text', async () => {
      const filePath = 'config.yaml';
      const fileContent = 'name: test\nversion: 1.0.0';
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should treat file with high control character percentage as binary', async () => {
      const filePath = 'suspicious.txt';
      // Create content with >10% control characters
      const fileContent = '\x01\x02\x03\x04\x05'.repeat(20) + 'normal text'.repeat(10);
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('binary');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should treat empty files as text so they remain editable', async () => {
      const filePath = 'empty.txt';
      const fileBuffer = Buffer.alloc(0);

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 0 } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.length).toBe(0);
      expect(result.fileType).toBe('text');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should read binary file content successfully', async () => {
      const filePath = 'image.png';
      // Simulate binary content (PNG header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      expect(result.buffer.equals(binaryContent)).toBe(true);
      expect(result.fileType).toBe('image');
      expect(result.contentType).toBe('image/png');
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsService.findOne.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.readFile(mockAgentId, 'test.txt')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when file not found', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockRejectedValue(
        new NotFoundException('File not found in container: /app/nonexistent.txt'),
      );

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(service.readFile(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });

    it('should classify readable utf-8 content as text', async () => {
      const filePath = 'test-file.txt';
      const fileContent = 'fallback content';
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fileContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      await expect(service.readFile(mockAgentId, '../etc/passwd')).rejects.toThrow(BadRequestException);
      await expect(service.readFile(mockAgentId, '../../etc/passwd')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty path', async () => {
      await expect(service.readFile(mockAgentId, '')).rejects.toThrow(BadRequestException);
    });

    it('should allow files up to the assembled upload limit', async () => {
      // Chunked uploads may assemble up to 100MB; reads must match that ceiling.
      const largeTextContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      const fileBuffer = Buffer.from(largeTextContent, 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: largeTextContent.length } as fs.Stats);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      const result = await service.readFile(mockAgentId, 'large-file.txt');

      expect(result.size).toBe(largeTextContent.length);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException when file size exceeds assembled limit', async () => {
      const oversize = 101 * 1024 * 1024;

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: oversize } as fs.Stats);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await expect(service.readFile(mockAgentId, 'huge-file.bin')).rejects.toThrow(BadRequestException);
      expect(dockerService.copyFileFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException when binary file size exceeds assembled limit', async () => {
      const oversize = 101 * 1024 * 1024;

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.copyFileFromContainer.mockResolvedValue(undefined);

      const mockTempDir = '/tmp/agent-file-read-abc123';

      jest.spyOn(fs, 'mkdtempSync').mockReturnValue(mockTempDir);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: oversize } as fs.Stats);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(jest.fn());
      jest.spyOn(fs, 'rmSync').mockImplementation(jest.fn());

      await expect(service.readFile(mockAgentId, 'large-image.png')).rejects.toThrow(BadRequestException);
    });
  });

  describe('probeFile', () => {
    it('should return metadata from stat and peek without copying the full file', async () => {
      const filePath = 'FuerGruenderde-Businessplaene-Dienstleistungen.pdf';
      const peek = Buffer.from('%PDF-1.7 binary-peek', 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer
        .mockResolvedValueOnce('EXISTS')
        .mockResolvedValueOnce('L21641254') // demux junk prefix
        .mockResolvedValueOnce(peek.toString('base64'));

      const result = await service.probeFile(mockAgentId, filePath);

      expect(result.size).toBe(21641254);
      expect(result.fileType).toBe('pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(dockerService.copyFileFromContainer).not.toHaveBeenCalled();
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(3);
    });

    it('should throw NotFoundException when file is missing', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValueOnce('NOTFOUND');

      await expect(service.probeFile(mockAgentId, 'missing.pdf')).rejects.toThrow(NotFoundException);
    });
  });

  describe('writeFile', () => {
    it('should write text file content successfully', async () => {
      const filePath = 'test-file.txt';
      const textContent = Buffer.from('Hello, World!', 'utf-8');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.writeFile(mockAgentId, filePath, textContent);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('base64 -d'),
        textContent.toString('base64'),
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should write binary file content successfully', async () => {
      const filePath = 'image.png';
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.writeFile(mockAgentId, filePath, binaryContent);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('base64 -d'),
        binaryContent.toString('base64'),
      );
    });

    it('should throw BadRequestException when content size exceeds limit', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

      await expect(service.writeFile(mockAgentId, 'test.txt', largeBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      const content = Buffer.from('content', 'utf-8');

      await expect(service.writeFile(mockAgentId, '../etc/passwd', content)).rejects.toThrow(BadRequestException);
    });
  });

  describe('writeFileChunk', () => {
    it('should assemble sequential chunks and finalize on last chunk', async () => {
      const filePath = 'chunked.bin';
      const part1 = Buffer.from('hello ');
      const part2 = Buffer.from('world');
      const total = part1.length + part2.length;

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.writeFileChunk(mockAgentId, filePath, part1, { start: 0, end: part1.length - 1, total }, 'up-1');
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();

      await service.writeFileChunk(
        mockAgentId,
        filePath,
        part2,
        { start: part1.length, end: total - 1, total },
        'up-1',
      );

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('base64 -d'),
        Buffer.concat([part1, part2]).toString('base64'),
      );
    });

    it('should reject non-sequential chunks', async () => {
      const filePath = 'chunked.bin';
      const part1 = Buffer.from('ab');

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);

      await service.writeFileChunk(mockAgentId, filePath, part1, { start: 0, end: 1, total: 4 }, 'up-2');

      await expect(
        service.writeFileChunk(mockAgentId, filePath, Buffer.from('cd'), { start: 3, end: 3, total: 4 }, 'up-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject assembled totals above 100MB', async () => {
      const oversizedTotal = 100 * 1024 * 1024 + 1;

      await expect(
        service.writeFileChunk(
          mockAgentId,
          'huge.bin',
          Buffer.from([0]),
          { start: 0, end: 0, total: oversizedTotal },
          'up-oversize',
        ),
      ).rejects.toThrow(BadRequestException);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should list files whose names contain spaces and parentheses', async () => {
      const directoryPath = '.';
      const mockLsOutput = `my file.txt
Copy (1).md`;
      const mockProcessOutput = `file|my file.txt|10|1704067200
file|Copy (1).md|20|1704067200`;

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValueOnce(mockLsOutput).mockResolvedValueOnce(mockProcessOutput);

      const result = await service.listDirectory(mockAgentId, directoryPath);

      expect(result).toHaveLength(2);
      expect(result.map((n) => n.name).sort()).toEqual(['Copy (1).md', 'my file.txt']);
      expect(result.find((n) => n.name === 'my file.txt')).toMatchObject<FileNodeDto>({
        name: 'my file.txt',
        type: 'file',
        path: 'my file.txt',
        size: 10,
      });

      const processCommand = dockerService.sendCommandToContainer.mock.calls[1][1] as string;

      // Path join must quote $item so spaced names do not word-split in the shell
      expect(processCommand).toContain('fullpath=');
      expect(processCommand).toContain('/\\"\\$item\\"');
    });

    it('should use default path when not provided', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.listDirectory(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should throw NotFoundException when directory not found', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('No such file'));

      await expect(service.listDirectory(mockAgentId, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should create directory successfully', async () => {
      const path = 'new-directory';

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createFileOrDirectory(mockAgentId, path, 'directory');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('mkdir -p'),
      );
    });

    it('should create empty file with touch', async () => {
      const path = 'new-file.txt';

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.createFileOrDirectory(mockAgentId, path, 'file');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('touch'),
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should delete file successfully', async () => {
      const path = 'file-to-delete.txt';

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.deleteFileOrDirectory(mockAgentId, path);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        expect.stringContaining('rm -rf'),
      );
    });

    it('should throw NotFoundException when file not found', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockRejectedValue(new Error('No such file'));

      await expect(service.deleteFileOrDirectory(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should move file successfully', async () => {
      const sourcePath = 'source-file.txt';
      const destinationPath = 'destination-file.txt';

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.moveFileOrDirectory(mockAgentId, sourcePath, destinationPath);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await service.moveFileOrDirectory(mockAgentId, sourcePath, destinationPath);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsService.findOne.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', 'dest.txt')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when source file not found', async () => {
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
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
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);

      await expect(service.readFile(mockAgentId, 'x', 'config')).rejects.toThrow(BadRequestException);
    });
  });
});
