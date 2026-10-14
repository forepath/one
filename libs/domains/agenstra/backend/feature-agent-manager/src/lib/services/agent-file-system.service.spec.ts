import * as fs from 'fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AgentResponseDto } from '../dto/agent-response.dto';
import { FileNodeDto } from '../dto/file-node.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';

import { AGENT_SYSTEM_FS_SCRIPT } from './agent-file-system.scripts';
import { AgentFileSystemService } from './agent-file-system.service';
import { AgentDirectoryIndexService } from './agent-directory-index.service';
import { AgentGitStateBroadcastService } from './agent-git-state-broadcast.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

type SendCommandArgs = [string, string | string[], string | undefined, boolean | undefined, { user?: string }?];
type FsCommandHandler = (
  command: string | string[],
  input?: string,
  waitForOutput?: boolean,
  options?: { user?: string },
) => Promise<string> | string;
type ContainmentHandler = (boundary: string, target: string, mode: string, user?: string) => string;

const INSIDE = 'AGENSTRA_PATH_INSIDE';
const OUTSIDE = 'AGENSTRA_PATH_OUTSIDE';

describe('AgentFileSystemService', () => {
  let service: AgentFileSystemService;
  let agentsService: jest.Mocked<AgentsService>;
  let agentsRepository: jest.Mocked<AgentsRepository>;
  let dockerService: jest.Mocked<DockerService>;
  let agentProviderFactory: jest.Mocked<AgentProviderFactory>;
  let workspaceChangeNotifier: { notifyPathChanges: jest.Mock; notifyDirectoryTreeChanged: jest.Mock };
  const mockAgentId = 'test-agent-uuid';
  const mockContainerId = 'test-container-id';
  const mockAgentResponse: AgentResponseDto = {
    id: mockAgentId,
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'opencode',
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
    readFileBytesFromContainer: jest.fn(),
    getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
  };
  const mockProvider = {
    getBasePath: jest.fn().mockReturnValue('/app'),
    getConfigBasePath: jest.fn().mockReturnValue('~/.config/opencode'),
  };
  const mockAgentProviderFactory = {
    getProvider: jest.fn().mockReturnValue(mockProvider),
  };
  const mockGitStateBroadcast = {
    notifyGitStateMayHaveChanged: jest.fn(),
  };

  /** Root commands run through `env -i` with a fixed system PATH. */
  const ROOT_COMMAND_PREFIX = ['/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin'];
  /** Strip the root `env -i` wrapper so assertions can inspect the actual command argv. */
  const unwrapRoot = (command: unknown): unknown =>
    Array.isArray(command) && command[0] === ROOT_COMMAND_PREFIX[0]
      ? command.slice(ROOT_COMMAND_PREFIX.length)
      : command;
  const isContainmentCall = (call: unknown[]): boolean => {
    const argv = unwrapRoot(call[1]);

    return Array.isArray(argv) && String((argv as string[])[2]).includes('realpath');
  };
  /** Root execs pin a fixed system PATH and clear loader / libc hooks for the `env` process. */
  const ROOT_EXEC_OPTIONS = {
    user: '0',
    env: [
      'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
      'LD_PRELOAD=',
      'LD_LIBRARY_PATH=',
      'LD_AUDIT=',
      'LD_DEBUG=',
      'LD_DEBUG_OUTPUT=',
      'LD_PROFILE=',
      'GLIBC_TUNABLES=',
      'GCONV_PATH=',
      'LOCPATH=',
      'LC_ALL=C',
      'BASH_ENV=',
      'ENV=',
      'CDPATH=',
    ],
  };
  const WORKSPACE_OPTIONS = { user: 'agenstra' };
  const textContentBase64 = (text: string): string => Buffer.from(text, 'utf-8').toString('base64');
  const containmentCalls = (): unknown[][] =>
    mockDockerService.sendCommandToContainer.mock.calls.filter((call) => isContainmentCall(call));
  /** All docker commands except the canonical containment checks. */
  const fsCalls = (): SendCommandArgs[] =>
    mockDockerService.sendCommandToContainer.mock.calls.filter((call) => !isContainmentCall(call)) as SendCommandArgs[];
  const containmentCall = (target: string, mode: string, boundary = '/app', user = 'agenstra'): unknown[] => [
    mockContainerId,
    [
      ...(user === '0' ? ROOT_COMMAND_PREFIX : []),
      'sh',
      '-c',
      expect.stringContaining('realpath'),
      'sh',
      boundary,
      target,
      mode,
      target.slice(0, target.lastIndexOf('/')) || '/',
      target.slice(target.lastIndexOf('/') + 1),
    ],
    undefined,
    true,
    user === '0' ? ROOT_EXEC_OPTIONS : { user },
  ];

  const isSystemScriptCall = (call: unknown[]): boolean => {
    const argv = unwrapRoot(call[1]);

    return Array.isArray(argv) && (argv as string[])[2] === AGENT_SYSTEM_FS_SCRIPT;
  };
  /** Privileged system script invocations: `[operation, containerPath, input, options]`. */
  const systemCalls = (): { op: string; path: string; input?: string; wait?: boolean; options?: unknown }[] =>
    mockDockerService.sendCommandToContainer.mock.calls
      .filter((call) => isSystemScriptCall(call))
      .map((call) => ({
        op: (unwrapRoot(call[1]) as string[])[4],
        path: (unwrapRoot(call[1]) as string[])[5],
        input: call[2] as string | undefined,
        wait: call[3] as boolean | undefined,
        options: call[4],
      }));
  const systemCall = (op: string, path: string, input?: string): unknown[] => [
    mockContainerId,
    [...ROOT_COMMAND_PREFIX, 'sh', '-c', AGENT_SYSTEM_FS_SCRIPT, 'sh', op, path],
    input,
    true,
    ROOT_EXEC_OPTIONS,
  ];

  /**
   * Make `sendCommandToContainer` answer containment-script calls via `containment`
   * (default: always inside), privileged system-script calls via `systemScript`
   * (default: inside) and delegate every other command to `handler`.
   */
  const mockDocker = (
    handler: FsCommandHandler = () => '',
    containment: ContainmentHandler = () => INSIDE,
    systemScript: () => string | Promise<string> = () => INSIDE,
  ): void => {
    mockDockerService.sendCommandToContainer.mockImplementation(
      async (
        _containerId: string,
        command: string | string[],
        input?: string,
        waitForOutput?: boolean,
        options?: { user?: string },
      ) => {
        command = unwrapRoot(command) as string | string[];

        if (Array.isArray(command) && command[2] === AGENT_SYSTEM_FS_SCRIPT) {
          return systemScript();
        }

        if (Array.isArray(command) && String(command[2]).includes('realpath')) {
          return containment(command[4], command[5], command[6], options?.user);
        }

        return handler(command, input, waitForOutput, options);
      },
    );
  };

  beforeEach(async () => {
    mockDockerService.sendCommandToContainer.mockReset();
    mockDockerService.readFileBytesFromContainer.mockReset();
    mockDockerService.copyFileFromContainer.mockReset();
    mockAgentsService.findOne.mockReset();
    mockAgentsRepository.findByIdOrThrow.mockReset();

    workspaceChangeNotifier = { notifyPathChanges: jest.fn(), notifyDirectoryTreeChanged: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentFileSystemService,
        {
          provide: AgentDirectoryIndexService,
          useValue: {
            getOrLoad: jest.fn((_agentId, _containerId, _directoryPath, load: () => Promise<FileNodeDto[]>) => load()),
          },
        },
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
        {
          provide: WorkspaceChangeNotifierService,
          useValue: {
            notifyPathChanges: workspaceChangeNotifier.notifyPathChanges,
            notifyDirectoryTreeChanged: workspaceChangeNotifier.notifyDirectoryTreeChanged,
            notifyRebuildRequired: jest.fn(),
            notifySystemFileUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AgentFileSystemService>(AgentFileSystemService);
    agentsService = module.get(AgentsService);
    agentsRepository = module.get(AgentsRepository);
    dockerService = module.get(DockerService);
    agentProviderFactory = module.get(AgentProviderFactory);

    agentsService.findOne.mockResolvedValue(mockAgentResponse);
    agentsRepository.findByIdOrThrow.mockResolvedValue(mockAgentEntity);
    mockDocker();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockProvider.getBasePath.mockReturnValue('/app');
    mockProvider.getConfigBasePath = jest.fn().mockReturnValue('~/.config/opencode');
    mockDockerService.getContainerHomeDirectory.mockResolvedValue('/home/agenstra');
    mockAgentProviderFactory.getProvider.mockReturnValue(mockProvider);
  });

  describe('readFile', () => {
    it('should read text file content successfully', async () => {
      const filePath = 'test-file.txt';
      const fileContent = 'Hello, World!';
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, filePath);

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(result.contentType).toBe('text/plain; charset=utf-8');
      expect(result.size).toBe(fileContent.length);
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(mockContainerId, '/app/test-file.txt', {
        user: 'agenstra',
        maxBytes: 100 * 1024 * 1024,
      });
    });

    it('should read markdown file as text', async () => {
      const fileBuffer = Buffer.from('# Agents\n\nThis is a markdown file.', 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'AGENTS.md');

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should read Kotlin file as text', async () => {
      const fileBuffer = Buffer.from('fun main() {\n    println("Hello")\n}', 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'Main.kt');

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should read YAML file as text', async () => {
      const fileBuffer = Buffer.from('name: test\nversion: 1.0.0', 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'config.yaml');

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should treat file with high control character percentage as binary', async () => {
      // Create content with >10% control characters
      const fileContent = '\x01\x02\x03\x04\x05'.repeat(20) + 'normal text'.repeat(10);
      const fileBuffer = Buffer.from(fileContent, 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'suspicious.txt');

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('binary');
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should treat empty files as text so they remain editable', async () => {
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.alloc(0));

      const result = await service.readFile(mockAgentId, 'empty.txt');

      expect(result.buffer.length).toBe(0);
      expect(result.fileType).toBe('text');
      expect(result.size).toBe(0);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should read binary file content successfully', async () => {
      // Simulate binary content (PNG header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      dockerService.readFileBytesFromContainer.mockResolvedValue(binaryContent);

      const result = await service.readFile(mockAgentId, 'image.png');

      expect(result.buffer.equals(binaryContent)).toBe(true);
      expect(result.fileType).toBe('image');
      expect(result.contentType).toBe('image/png');
      expect(result.size).toBe(binaryContent.length);
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsService.findOne.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.readFile(mockAgentId, 'test.txt')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when file not found', async () => {
      dockerService.readFileBytesFromContainer.mockRejectedValue(
        new Error('cat: /app/nonexistent.txt: No such file or directory'),
      );

      await expect(service.readFile(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when the path is a directory', async () => {
      dockerService.readFileBytesFromContainer.mockRejectedValue(new Error('cat: /app/src: Is a directory'));

      await expect(service.readFile(mockAgentId, 'src')).rejects.toThrow(BadRequestException);
    });

    it('should classify readable utf-8 content as text', async () => {
      const fileBuffer = Buffer.from('fallback content', 'utf-8');

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'test-file.txt');

      expect(result.buffer.equals(fileBuffer)).toBe(true);
      expect(result.fileType).toBe('text');
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      await expect(service.readFile(mockAgentId, '../etc/passwd')).rejects.toThrow(BadRequestException);
      await expect(service.readFile(mockAgentId, '../../etc/passwd')).rejects.toThrow(BadRequestException);
      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for empty path', async () => {
      await expect(service.readFile(mockAgentId, '')).rejects.toThrow(BadRequestException);
    });

    it('should allow files up to the assembled upload limit', async () => {
      // Chunked uploads may assemble up to 100MB; reads must match that ceiling.
      const fileBuffer = Buffer.from('x'.repeat(11 * 1024 * 1024), 'utf-8'); // 11MB

      dockerService.readFileBytesFromContainer.mockResolvedValue(fileBuffer);

      const result = await service.readFile(mockAgentId, 'large-file.txt');

      expect(result.size).toBe(fileBuffer.length);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/large-file.txt',
        expect.objectContaining({ maxBytes: 100 * 1024 * 1024 }),
      );
    });

    it('should throw BadRequestException when file size exceeds assembled limit', async () => {
      dockerService.readFileBytesFromContainer.mockRejectedValue(
        new BadRequestException('File exceeds maximum allowed size'),
      );

      await expect(service.readFile(mockAgentId, 'huge-file.bin')).rejects.toThrow(BadRequestException);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalled();
    });

    it('should throw BadRequestException when binary file size exceeds assembled limit', async () => {
      dockerService.readFileBytesFromContainer.mockRejectedValue(
        new BadRequestException('File exceeds maximum allowed size'),
      );

      await expect(service.readFile(mockAgentId, 'large-image.png')).rejects.toThrow(BadRequestException);
    });

    it('should read via readFileBytesFromContainer as the workspace user and never copy files out', async () => {
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('x'));

      await service.readFile(mockAgentId, 'a.txt');

      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/a.txt',
        expect.objectContaining({ user: 'agenstra' }),
      );
      expect(dockerService.copyFileFromContainer).not.toHaveBeenCalled();
    });
  });

  describe('probeFile', () => {
    it('should return metadata from stat and peek without copying the full file', async () => {
      const filePath = 'FuerGruenderde-Businessplaene-Dienstleistungen.pdf';
      const peek = Buffer.from('%PDF-1.7 binary-peek', 'utf-8');

      mockDocker((command) => {
        const argv = command as string[];

        if (argv[0] === 'sh' && argv[2].startsWith('test -f')) {
          return 'EXISTS';
        }

        if (argv[0] === 'stat') {
          return 'L21641254'; // demux junk prefix
        }

        return peek.toString('base64');
      });

      const result = await service.probeFile(mockAgentId, filePath);

      expect(result.size).toBe(21641254);
      expect(result.fileType).toBe('pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(dockerService.copyFileFromContainer).not.toHaveBeenCalled();
      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
      expect(containmentCalls()).toHaveLength(1);
      expect(fsCalls()).toHaveLength(3);
      expect(containmentCalls()).toEqual([
        containmentCall('/app/FuerGruenderde-Businessplaene-Dienstleistungen.pdf', 'follow'),
      ]);

      const probedPath = '/app/FuerGruenderde-Businessplaene-Dienstleistungen.pdf';

      expect(fsCalls()).toEqual([
        [
          mockContainerId,
          ['sh', '-c', 'test -f "$1" && echo EXISTS || echo NOTFOUND', 'sh', probedPath],
          undefined,
          false,
          WORKSPACE_OPTIONS,
        ],
        [mockContainerId, ['stat', '-c', '%s', '--', probedPath], undefined, false, WORKSPACE_OPTIONS],
        [
          mockContainerId,
          ['sh', '-c', 'head -c 8192 -- "$1" | base64 -w 0', 'sh', probedPath],
          undefined,
          false,
          WORKSPACE_OPTIONS,
        ],
      ]);
    });

    it('should throw NotFoundException when file is missing', async () => {
      mockDocker(() => 'NOTFOUND');

      await expect(service.probeFile(mockAgentId, 'missing.pdf')).rejects.toThrow(NotFoundException);
    });
  });

  describe('writeFile', () => {
    it('should write text file content successfully', async () => {
      const textContent = Buffer.from('Hello, World!', 'utf-8');

      await service.writeFile(mockAgentId, 'test-file.txt', textContent);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/test-file.txt'],
        textContent.toString('base64'),
        true,
        WORKSPACE_OPTIONS,
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should write binary file content successfully', async () => {
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      await service.writeFile(mockAgentId, 'image.png', binaryContent);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/image.png'],
        binaryContent.toString('base64'),
        true,
        WORKSPACE_OPTIONS,
      );
    });

    it('should reject absolute paths outside the workspace root', async () => {
      const textContent = Buffer.from('skill', 'utf-8');

      await expect(service.writeFile(mockAgentId, '/opt/skills/foo.md', textContent)).rejects.toThrow(
        new BadRequestException('Path must stay within the agent workspace'),
      );

      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).not.toHaveBeenCalled();
    });

    it('should write relative and ./ paths under the workspace root', async () => {
      const textContent = Buffer.from('rel', 'utf-8');

      await service.writeFile(mockAgentId, './skills/a.md', textContent);

      expect(fsCalls()).toEqual([
        [mockContainerId, ['mkdir', '-p', '--', '/app/skills'], undefined, true, WORKSPACE_OPTIONS],
        [
          mockContainerId,
          ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/skills/a.md'],
          textContentBase64('rel'),
          true,
          WORKSPACE_OPTIONS,
        ],
      ]);
    });

    it('should notify workspace changes with the normalized relative path', async () => {
      await service.writeFile(mockAgentId, './skills//a.md', Buffer.from('rel', 'utf-8'));

      expect(workspaceChangeNotifier.notifyPathChanges).toHaveBeenCalledWith(
        mockAgentId,
        [{ path: 'skills/a.md', op: 'upsert' }],
        'write',
      );
    });

    it('should throw BadRequestException when content size exceeds limit', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

      await expect(service.writeFile(mockAgentId, 'test.txt', largeBuffer)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for path traversal attempts', async () => {
      const content = Buffer.from('content', 'utf-8');

      await expect(service.writeFile(mockAgentId, '../etc/passwd', content)).rejects.toThrow(BadRequestException);
      await expect(service.writeFile(mockAgentId, 'a/../../etc/passwd', content)).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject writes that target the workspace root', async () => {
      const content = Buffer.from('content', 'utf-8');

      await expect(service.writeFile(mockAgentId, '.', content)).rejects.toThrow(
        new BadRequestException('Path must not target the workspace root'),
      );
      await expect(service.writeFile(mockAgentId, '/app', content)).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should accept absolute paths inside the workspace root', async () => {
      await service.writeFile(mockAgentId, '/app/x.txt', Buffer.from('abs', 'utf-8'));

      expect(containmentCalls()).toEqual([containmentCall('/app/x.txt', 'follow')]);

      expect(fsCalls().map((call) => call[1])).toEqual([
        ['mkdir', '-p', '--', '/app'],
        ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/x.txt'],
      ]);
      expect(workspaceChangeNotifier.notifyPathChanges).toHaveBeenCalledWith(
        mockAgentId,
        [{ path: 'x.txt', op: 'upsert' }],
        'write',
      );
    });

    it('should reject symlink escapes and write nothing', async () => {
      mockDocker(
        () => '',
        () => OUTSIDE,
      );

      await expect(service.writeFile(mockAgentId, 'link/evil.txt', Buffer.from('evil', 'utf-8'))).rejects.toThrow(
        new BadRequestException('Path resolves outside the agent workspace'),
      );

      expect(containmentCalls()).toEqual([containmentCall('/app/link/evil.txt', 'follow')]);
      expect(fsCalls()).toHaveLength(0);
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).not.toHaveBeenCalled();
    });

    it('should reject paths containing control characters', async () => {
      await expect(service.writeFile(mockAgentId, 'a\nb', Buffer.from('x'))).rejects.toThrow(
        new BadRequestException('Path cannot contain control characters'),
      );
      await expect(service.readFile(mockAgentId, 'a\nb')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should pass paths with quotes and command substitutions verbatim as argv elements', async () => {
      const trickyName = "x'$(touch /tmp/p)'.txt";

      await service.writeFile(mockAgentId, trickyName, Buffer.from('x'));

      expect(containmentCalls()).toEqual([containmentCall(`/app/${trickyName}`, 'follow')]);
      // The `/` inside the name is a path separator (parent dir), everything else stays literal argv data.
      expect(fsCalls().map((call) => call[1])).toEqual([
        ['mkdir', '-p', '--', "/app/x'$(touch /tmp"],
        ['sh', '-c', 'base64 -d > "$1"', 'sh', `/app/${trickyName}`],
      ]);
      expect(fsCalls().every((call) => Array.isArray(call[1]))).toBe(true);
    });

    it('should never run workspace writes as root', async () => {
      await service.writeFile(mockAgentId, 'dir/a.txt', Buffer.from('a', 'utf-8'));

      expect(fsCalls().length).toBeGreaterThan(0);
      expect(dockerService.sendCommandToContainer.mock.calls.every((call) => call[4]?.user === 'agenstra')).toBe(true);
    });
  });

  describe('writeFileChunk', () => {
    it('should assemble sequential chunks and finalize on last chunk', async () => {
      const filePath = 'chunked.bin';
      const part1 = Buffer.from('hello ');
      const part2 = Buffer.from('world');
      const total = part1.length + part2.length;

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
        ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/chunked.bin'],
        Buffer.concat([part1, part2]).toString('base64'),
        true,
        WORKSPACE_OPTIONS,
      );
    });

    it('should reject non-sequential chunks', async () => {
      const filePath = 'chunked.bin';
      const part1 = Buffer.from('ab');

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

    it('should reject an outside absolute path on the first chunk and stage nothing', async () => {
      await expect(
        service.writeFileChunk(
          mockAgentId,
          '/etc/passwd',
          Buffer.from('a'),
          { start: 0, end: 0, total: 2 },
          'up-escape',
        ),
      ).rejects.toThrow(new BadRequestException('Path must stay within the agent workspace'));

      // Nothing was staged: a follow-up chunk cannot continue the upload.
      await expect(
        service.writeFileChunk(
          mockAgentId,
          '/etc/passwd',
          Buffer.from('b'),
          { start: 1, end: 1, total: 2 },
          'up-escape',
        ),
      ).rejects.toThrow(new BadRequestException('Upload not started; first chunk must begin at byte 0'));
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject control characters and traversal on the first chunk', async () => {
      await expect(
        service.writeFileChunk(mockAgentId, 'a\nb', Buffer.from('a'), { start: 0, end: 0, total: 2 }, 'up-ctl'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.writeFileChunk(mockAgentId, '../x', Buffer.from('a'), { start: 0, end: 0, total: 2 }, 'up-trav'),
      ).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });
  });

  describe('listDirectory', () => {
    it('should retain existing entries when another file disappears after ls', async () => {
      const directory = fs.mkdtempSync(join(tmpdir(), 'agenstra-directory-'));
      const execFileAsync = promisify(execFile);

      try {
        fs.writeFileSync(join(directory, 'remaining.txt'), 'contents');
        mockProvider.getBasePath.mockReturnValue(directory);
        mockDocker(async (command) => {
          if (!Array.isArray(command)) {
            throw new Error('Expected argv command');
          }

          if (command[0] === 'ls') {
            return 'removed.txt\nremaining.txt';
          }

          const { stdout } = await execFileAsync(command[0], command.slice(1));

          return stdout;
        });

        const result = await service.listDirectory(mockAgentId);

        expect(result).toEqual([expect.objectContaining({ name: 'remaining.txt', type: 'file', size: 8 })]);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    it('should list directory contents successfully', async () => {
      // First call: ls -1 returns just the filenames
      const mockLsOutput = `file1.txt
dir1
file2.txt`;
      // Second call: processing command returns formatted output
      const mockProcessOutput = `file|file1.txt|1024|1704067200
directory|dir1|0|1704067200
file|file2.txt|2048|1704067200`;

      mockDocker((command) => (Array.isArray(command) && command[0] === 'ls' ? mockLsOutput : mockProcessOutput));

      const result = await service.listDirectory(mockAgentId, '.');

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
      expect(containmentCalls()).toEqual([containmentCall('/app', 'follow')]);
    });

    it('should list files whose names contain spaces and parentheses', async () => {
      const mockLsOutput = `my file.txt
Copy (1).md`;
      const mockProcessOutput = `file|my file.txt|10|1704067200
file|Copy (1).md|20|1704067200`;

      mockDocker((command) => (Array.isArray(command) && command[0] === 'ls' ? mockLsOutput : mockProcessOutput));

      const result = await service.listDirectory(mockAgentId, '.');

      expect(result).toHaveLength(2);
      expect(result.map((n) => n.name).sort()).toEqual(['Copy (1).md', 'my file.txt']);
      expect(result.find((n) => n.name === 'my file.txt')).toMatchObject<FileNodeDto>({
        name: 'my file.txt',
        type: 'file',
        path: 'my file.txt',
        size: 10,
      });

      const processCommand = fsCalls()[1][1];

      // Path join must quote $item so spaced names do not word-split in the shell
      expect(processCommand).toEqual(['sh', '-c', expect.stringContaining('/"$item"')]);
    });

    it('lists nested folders using checked argv without parsing a shell wrapper', async () => {
      mockDocker((command) =>
        Array.isArray(command) && command[0] === 'ls'
          ? '.\n..\nagenstra\ndecabill\nforepath\nshared\n'
          : ['agenstra', 'decabill', 'forepath', 'shared'].map((name) => `directory|${name}|0|1704067200`).join('\n'),
      );

      const result = await service.listDirectory(mockAgentId, 'apps');

      expect(result.map((node) => node.path)).toEqual([
        'apps/agenstra',
        'apps/decabill',
        'apps/forepath',
        'apps/shared',
      ]);
      expect(containmentCalls()).toEqual([containmentCall('/app/apps', 'follow')]);
      expect(fsCalls()[0]).toEqual([
        mockContainerId,
        ['ls', '-a', '-1', '--', '/app/apps'],
        undefined,
        true,
        { user: 'agenstra' },
      ]);
      expect(fsCalls()[1]).toEqual([
        mockContainerId,
        ['sh', '-c', expect.stringContaining('fullpath=\'/app/apps\'/"$item"')],
        undefined,
        true,
        { user: 'agenstra' },
      ]);
    });

    it('preserves shell quoting for apostrophes in listed names', async () => {
      mockDocker((command) =>
        Array.isArray(command) && command[0] === 'ls' ? "it's a folder" : "directory|it's a folder|0|1704067200",
      );

      expect(await service.listDirectory(mockAgentId, 'apps')).toEqual([
        expect.objectContaining({ name: "it's a folder", path: "apps/it's a folder", type: 'directory' }),
      ]);
      expect(fsCalls()[1][1]).toEqual(['sh', '-c', expect.stringContaining("for item in 'it'\\''s a folder'")]);
    });

    it('propagates listing and metadata permission failures instead of returning an empty directory', async () => {
      mockDocker((command) => {
        if (Array.isArray(command) && command[0] === 'ls') {
          throw new Error('Permission denied');
        }

        return '';
      });

      await expect(service.listDirectory(mockAgentId, 'apps')).rejects.toThrow('Permission denied');

      mockDocker((command) => {
        if (Array.isArray(command) && command[0] === 'ls') {
          return 'folder';
        }

        throw new Error('stat failed');
      });

      await expect(service.listDirectory(mockAgentId, 'apps')).rejects.toThrow('stat failed');
    });

    it('should use default path when not provided', async () => {
      await service.listDirectory(mockAgentId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalled();
      expect(containmentCalls()).toEqual([containmentCall('/app', 'follow')]);
    });

    it('should throw NotFoundException when directory not found', async () => {
      mockDocker(() => {
        throw new Error('No such file');
      });

      await expect(service.listDirectory(mockAgentId, 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should reject absolute paths outside the workspace', async () => {
      await expect(service.listDirectory(mockAgentId, '/etc')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject traversal and symlink escapes when listing', async () => {
      await expect(service.listDirectory(mockAgentId, '../etc')).rejects.toThrow(BadRequestException);

      mockDocker(
        () => 'secret',
        () => OUTSIDE,
      );

      await expect(service.listDirectory(mockAgentId, 'link')).rejects.toThrow(
        new BadRequestException('Path resolves outside the agent workspace'),
      );
      expect(fsCalls()).toHaveLength(0);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should create directory successfully', async () => {
      await service.createFileOrDirectory(mockAgentId, 'new-directory', 'directory');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['mkdir', '-p', '--', '/app/new-directory'],
        undefined,
        true,
        WORKSPACE_OPTIONS,
      );
    });

    it('should create empty file with touch', async () => {
      await service.createFileOrDirectory(mockAgentId, 'new-file.txt', 'file');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['touch', '--', '/app/new-file.txt'],
        undefined,
        true,
        WORKSPACE_OPTIONS,
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should reject absolute paths outside the workspace', async () => {
      await expect(service.createFileOrDirectory(mockAgentId, '/etc/cron.d/evil', 'file')).rejects.toThrow(
        BadRequestException,
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject creating the workspace root', async () => {
      await expect(service.createFileOrDirectory(mockAgentId, '.', 'directory')).rejects.toThrow(
        new BadRequestException('Path must not target the workspace root'),
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject symlink escapes and create nothing', async () => {
      mockDocker(
        () => '',
        () => OUTSIDE,
      );

      await expect(service.createFileOrDirectory(mockAgentId, 'link/new', 'directory')).rejects.toThrow(
        BadRequestException,
      );
      expect(fsCalls()).toHaveLength(0);
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should delete file successfully', async () => {
      await service.deleteFileOrDirectory(mockAgentId, 'file-to-delete.txt');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['rm', '-rf', '--', '/app/file-to-delete.txt'],
        undefined,
        true,
        WORKSPACE_OPTIONS,
      );
    });

    it('should check containment without following the final symlink', async () => {
      await service.deleteFileOrDirectory(mockAgentId, 'some-link');

      expect(containmentCalls()).toEqual([containmentCall('/app/some-link', 'nofollow')]);
    });

    it('should throw NotFoundException when file not found', async () => {
      mockDocker(() => {
        throw new Error('No such file');
      });

      await expect(service.deleteFileOrDirectory(mockAgentId, 'nonexistent.txt')).rejects.toThrow(NotFoundException);
    });

    it('should reject absolute paths outside the workspace', async () => {
      await expect(service.deleteFileOrDirectory(mockAgentId, '/etc/passwd')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject deleting the workspace root', async () => {
      await expect(service.deleteFileOrDirectory(mockAgentId, '.')).rejects.toThrow(
        new BadRequestException('Path must not target the workspace root'),
      );
      await expect(service.deleteFileOrDirectory(mockAgentId, '/app')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject deletions whose parent resolves outside the workspace', async () => {
      mockDocker(
        () => '',
        () => OUTSIDE,
      );

      await expect(service.deleteFileOrDirectory(mockAgentId, 'link/victim.txt')).rejects.toThrow(BadRequestException);
      expect(fsCalls()).toHaveLength(0);
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should move file successfully', async () => {
      await service.moveFileOrDirectory(mockAgentId, 'source-file.txt', 'destination-file.txt');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        mockContainerId,
        ['mv', '--', '/app/source-file.txt', '/app/destination-file.txt'],
        undefined,
        false,
        WORKSPACE_OPTIONS,
      );
    });

    it('should check the source without following and the destination with following', async () => {
      await service.moveFileOrDirectory(mockAgentId, 'source-file.txt', 'destination-file.txt');

      expect(containmentCalls()).toEqual([
        containmentCall('/app/source-file.txt', 'nofollow'),
        containmentCall('/app/destination-file.txt', 'follow'),
      ]);
    });

    it('should move directory successfully', async () => {
      await service.moveFileOrDirectory(mockAgentId, 'source-directory', 'destination-directory');

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgentId);
      expect(fsCalls()).toHaveLength(1);
    });

    it('should throw NotFoundException when agent not found', async () => {
      agentsService.findOne.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', 'dest.txt')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when source file not found', async () => {
      mockDocker(() => {
        throw new Error('No such file');
      });

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

    it('should reject absolute source or destination outside the workspace', async () => {
      await expect(service.moveFileOrDirectory(mockAgentId, '/etc/passwd', 'dest.txt')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', '/etc/cron.d/evil')).rejects.toThrow(
        BadRequestException,
      );
      expect(fsCalls()).toHaveLength(0);
    });

    it('should reject moves that target the workspace root', async () => {
      await expect(service.moveFileOrDirectory(mockAgentId, '.', 'dest.txt')).rejects.toThrow(
        new BadRequestException('Path must not target the workspace root'),
      );
      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', '.')).rejects.toThrow(BadRequestException);
      expect(fsCalls()).toHaveLength(0);
    });

    it('should reject a destination that resolves outside the workspace through a symlink', async () => {
      mockDocker(
        () => '',
        (_boundary, _target, mode) => (mode === 'follow' ? OUTSIDE : INSIDE),
      );

      await expect(service.moveFileOrDirectory(mockAgentId, 'source.txt', 'link/dest.txt')).rejects.toThrow(
        BadRequestException,
      );
      expect(fsCalls()).toHaveLength(0);
    });
  });

  describe('path sanitization', () => {
    it('should reject paths with null bytes', async () => {
      await expect(service.readFile(mockAgentId, 'file\0.txt')).rejects.toThrow(BadRequestException);
    });

    it('should accept valid paths', async () => {
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('test content', 'utf-8'));

      await expect(service.readFile(mockAgentId, 'valid/path/file.txt')).resolves.toBeDefined();
      await expect(service.readFile(mockAgentId, 'file-with-dashes.txt')).resolves.toBeDefined();
      await expect(service.readFile(mockAgentId, 'file_with_underscores.txt')).resolves.toBeDefined();
    });

    it('should accept absolute paths inside the workspace and resolve them in place', async () => {
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('x', 'utf-8'));

      await service.readFile(mockAgentId, '/app/x.txt');

      expect(containmentCalls()).toEqual([containmentCall('/app/x.txt', 'follow')]);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/x.txt',
        expect.any(Object),
      );
    });
  });

  describe('workspace path confinement', () => {
    const outsidePath = '/etc/passwd';

    it('should reject absolute outside paths for read and probe without touching the container', async () => {
      await expect(service.readFile(mockAgentId, outsidePath)).rejects.toThrow(
        new BadRequestException('Path must stay within the agent workspace'),
      );
      await expect(service.probeFile(mockAgentId, outsidePath)).rejects.toThrow(
        new BadRequestException('Path must stay within the agent workspace'),
      );

      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
      expect(dockerService.copyFileFromContainer).not.toHaveBeenCalled();
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should not treat a sibling directory sharing the root prefix as inside the workspace', async () => {
      await expect(service.readFile(mockAgentId, '/app-secrets/key')).rejects.toThrow(BadRequestException);
      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
    });

    it('should reject symlink escapes when reading and read nothing', async () => {
      mockDocker(
        () => '',
        () => OUTSIDE,
      );
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('secret'));

      await expect(service.readFile(mockAgentId, 'link/secret.txt')).rejects.toThrow(
        new BadRequestException('Path resolves outside the agent workspace'),
      );
      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
    });

    it('should reject symlink escapes when probing', async () => {
      mockDocker(
        () => 'EXISTS',
        () => OUTSIDE,
      );

      await expect(service.probeFile(mockAgentId, 'link/secret.txt')).rejects.toThrow(BadRequestException);
      expect(fsCalls()).toHaveLength(0);
    });

    it('should reject containment output that carries no inside marker', async () => {
      mockDocker(
        () => '',
        () => '',
      );

      await expect(service.readFile(mockAgentId, 'a.txt')).rejects.toThrow(BadRequestException);
      expect(dockerService.readFileBytesFromContainer).not.toHaveBeenCalled();
    });

    it('should run every mutating workspace operation as the unprivileged user', async () => {
      await service.writeFile(mockAgentId, 'dir/a.txt', Buffer.from('a'));
      await service.createFileOrDirectory(mockAgentId, 'dir/b.txt', 'file');
      await service.createFileOrDirectory(mockAgentId, 'dir2', 'directory');
      await service.moveFileOrDirectory(mockAgentId, 'dir/a.txt', 'dir/c.txt');
      await service.deleteFileOrDirectory(mockAgentId, 'dir/c.txt');

      expect(dockerService.sendCommandToContainer.mock.calls.length).toBeGreaterThan(5);
      expect(dockerService.sendCommandToContainer.mock.calls.some((call) => call[4]?.user === '0')).toBe(false);
      expect(
        dockerService.sendCommandToContainer.mock.calls.every(
          (call) => (call as unknown[])[4] !== undefined && call[4]?.user === 'agenstra',
        ),
      ).toBe(true);
    });
  });

  describe('system files', () => {
    const systemContent = Buffer.from('skill', 'utf-8');

    it('should write outside the workspace via one root script call, without a separate check or chmod', async () => {
      await service.writeSystemFile(mockAgentId, '/opt/skills/foo.md', systemContent);

      expect(dockerService.sendCommandToContainer.mock.calls).toEqual([
        systemCall('write', '/opt/skills/foo.md', systemContent.toString('base64')),
      ]);
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).toHaveBeenCalledWith(mockAgentId);
      expect(workspaceChangeNotifier.notifyPathChanges).not.toHaveBeenCalled();
      expect(workspaceChangeNotifier.notifyDirectoryTreeChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should run root system commands via env -i with a pinned PATH and cleared loader hooks', async () => {
      await service.writeSystemFile(mockAgentId, '/opt/skills/foo.md', systemContent);

      const rootCall = mockDockerService.sendCommandToContainer.mock.calls.find((call) => isSystemScriptCall(call));

      expect((rootCall?.[1] as string[]).slice(0, 3)).toEqual(ROOT_COMMAND_PREFIX);
      expect(systemCalls()[0].options).toEqual(ROOT_EXEC_OPTIONS);
      expect(ROOT_EXEC_OPTIONS.env).toEqual(
        expect.arrayContaining(['LD_PRELOAD=', 'LD_DEBUG_OUTPUT=', 'GLIBC_TUNABLES=', 'BASH_ENV=']),
      );
      expect(systemCalls()[0].wait).toBe(true);
    });

    it('should write relative paths as the workspace user without the root script', async () => {
      await service.writeSystemFile(mockAgentId, 'skills/a.md', systemContent);

      expect(containmentCalls()).toEqual([containmentCall('/app/skills/a.md', 'follow')]);
      expect(systemCalls()).toHaveLength(0);
      expect(fsCalls().length).toBeGreaterThan(0);
      expect(fsCalls().every((call) => call[4]?.user === 'agenstra')).toBe(true);
      expect(fsCalls().map((call) => call[1])).toEqual([
        ['mkdir', '-p', '--', '/app/skills'],
        ['sh', '-c', 'base64 -d > "$1"', 'sh', '/app/skills/a.md'],
      ]);
      expect(workspaceChangeNotifier.notifyPathChanges).toHaveBeenCalledWith(
        mockAgentId,
        [{ path: 'skills/a.md', op: 'upsert' }],
        'write',
      );
    });

    it('should treat absolute in-workspace paths like workspace paths', async () => {
      await service.writeSystemFile(mockAgentId, '/app/skills/a.md', systemContent);

      expect(containmentCalls()).toEqual([containmentCall('/app/skills/a.md', 'follow')]);
      expect(systemCalls()).toHaveLength(0);
      expect(fsCalls().every((call) => call[4]?.user === 'agenstra')).toBe(true);
    });

    it('should reject outside paths when the script reports a symlink escape and notify nothing', async () => {
      mockDocker(
        () => '',
        () => INSIDE,
        () => OUTSIDE,
      );

      await expect(service.writeSystemFile(mockAgentId, '/opt/skills/foo.md', systemContent)).rejects.toThrow(
        new BadRequestException('System file paths must not traverse symbolic links'),
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).not.toHaveBeenCalled();
      expect(workspaceChangeNotifier.notifyDirectoryTreeChanged).not.toHaveBeenCalled();
    });

    it('should map a script failure carrying the outside marker to BadRequestException', async () => {
      mockDocker(
        () => '',
        () => INSIDE,
        () => {
          throw new Error(`Command failed with exit code 65: ${OUTSIDE}`);
        },
      );

      await expect(service.writeSystemFile(mockAgentId, '/opt/skills/foo.md', systemContent)).rejects.toThrow(
        new BadRequestException('System file paths must not traverse symbolic links'),
      );
    });

    it('should propagate unrelated script failures and require the inside marker', async () => {
      mockDocker(
        () => '',
        () => INSIDE,
        () => {
          throw new Error('disk full');
        },
      );

      await expect(service.writeSystemFile(mockAgentId, '/opt/skills/foo.md', systemContent)).rejects.toThrow(
        'disk full',
      );

      mockDocker(
        () => '',
        () => INSIDE,
        () => '',
      );

      await expect(service.createSystemFileOrDirectory(mockAgentId, '/opt/skills', 'directory')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject the filesystem root and traversal segments', async () => {
      await expect(service.writeSystemFile(mockAgentId, '/', systemContent)).rejects.toThrow(BadRequestException);
      await expect(service.writeSystemFile(mockAgentId, '/opt/../etc/passwd', systemContent)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createSystemFileOrDirectory(mockAgentId, '/', 'directory')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteSystemFileOrDirectory(mockAgentId, '/')).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject protected system directories without any docker call', async () => {
      const expected = new BadRequestException('System file paths must not target protected system directories');

      await expect(service.writeSystemFile(mockAgentId, '/etc/x', systemContent)).rejects.toThrow(expected);
      await expect(service.writeSystemFile(mockAgentId, '/usr/local/bin/x', systemContent)).rejects.toThrow(expected);
      await expect(service.createSystemFileOrDirectory(mockAgentId, '/root/.ssh', 'directory')).rejects.toThrow(
        expected,
      );
      await expect(service.deleteSystemFileOrDirectory(mockAgentId, '/var/lib/x')).rejects.toThrow(expected);
      await expect(service.listSystemDirectory(mockAgentId, '/proc')).rejects.toThrow(expected);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject control characters in system paths', async () => {
      await expect(service.writeSystemFile(mockAgentId, '/opt/a\nb', systemContent)).rejects.toThrow(
        new BadRequestException('Path cannot contain control characters'),
      );
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should reject oversized system writes', async () => {
      await expect(
        service.writeSystemFile(mockAgentId, '/opt/skills/big.bin', Buffer.alloc(11 * 1024 * 1024)),
      ).rejects.toThrow(BadRequestException);
      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should create outside directories with the root mkdir operation', async () => {
      await service.createSystemFileOrDirectory(mockAgentId, '/opt/skills', 'directory');

      expect(dockerService.sendCommandToContainer.mock.calls).toEqual([systemCall('mkdir', '/opt/skills')]);
    });

    it('should create outside files with the root touch operation', async () => {
      await service.createSystemFileOrDirectory(mockAgentId, '/opt/skills/new.md', 'file');

      expect(dockerService.sendCommandToContainer.mock.calls).toEqual([systemCall('touch', '/opt/skills/new.md')]);
    });

    it('should create relative system paths as the workspace user', async () => {
      await service.createSystemFileOrDirectory(mockAgentId, 'skills', 'directory');

      expect(containmentCalls()).toEqual([containmentCall('/app/skills', 'follow')]);
      expect(fsCalls()).toEqual([
        [mockContainerId, ['mkdir', '-p', '--', '/app/skills'], undefined, true, WORKSPACE_OPTIONS],
      ]);
    });

    it('should delete outside paths with the root delete operation', async () => {
      await service.deleteSystemFileOrDirectory(mockAgentId, '/opt/skills/foo.md');

      expect(dockerService.sendCommandToContainer.mock.calls).toEqual([systemCall('delete', '/opt/skills/foo.md')]);
      expect(workspaceChangeNotifier.notifyDirectoryTreeChanged).toHaveBeenCalledWith(mockAgentId);
    });

    it('should delete relative system paths as the workspace user using nofollow', async () => {
      await service.deleteSystemFileOrDirectory(mockAgentId, 'skills/a.md');

      expect(containmentCalls()).toEqual([containmentCall('/app/skills/a.md', 'nofollow')]);
      expect(fsCalls()).toEqual([
        [mockContainerId, ['rm', '-rf', '--', '/app/skills/a.md'], undefined, true, WORKSPACE_OPTIONS],
      ]);
    });

    it('should not report a delete outside the workspace when the script rejects the path', async () => {
      mockDocker(
        () => '',
        () => INSIDE,
        () => OUTSIDE,
      );

      await expect(service.deleteSystemFileOrDirectory(mockAgentId, '/opt/skills/foo.md')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockGitStateBroadcast.notifyGitStateMayHaveChanged).not.toHaveBeenCalled();
    });

    it('should list outside directories as root and prefix node paths with the absolute directory', async () => {
      mockDocker((command) =>
        Array.isArray(command) && command[0] === 'ls'
          ? 'a.md\nsub'
          : 'file|a.md|5|1704067200\ndirectory|sub|0|1704067200',
      );

      const result = await service.listSystemDirectory(mockAgentId, '/opt/skills');

      expect(containmentCalls()).toEqual([containmentCall('/opt/skills', 'exact', '/', '0')]);
      expect(fsCalls()[0]).toEqual([
        mockContainerId,
        [...ROOT_COMMAND_PREFIX, 'ls', '-a', '-1', '--', '/opt/skills'],
        undefined,
        true,
        ROOT_EXEC_OPTIONS,
      ]);
      expect(fsCalls()[1][4]).toEqual(ROOT_EXEC_OPTIONS);
      expect(result.map((node) => node.path)).toEqual(['/opt/skills/sub', '/opt/skills/a.md']);
    });

    it('should list relative system directories as the workspace user', async () => {
      mockDocker((command) => (Array.isArray(command) && command[0] === 'ls' ? 'a.md' : 'file|a.md|5|1704067200'));

      const result = await service.listSystemDirectory(mockAgentId, 'skills');

      expect(containmentCalls()).toEqual([containmentCall('/app/skills', 'follow')]);
      expect(fsCalls().every((call) => call[4]?.user === 'agenstra')).toBe(true);
      expect(result.map((node) => node.path)).toEqual(['skills/a.md']);
    });

    it('should not list outside directories that fail the exact check', async () => {
      mockDocker(
        () => 'a.md',
        () => OUTSIDE,
      );

      await expect(service.listSystemDirectory(mockAgentId, '/opt/skills')).rejects.toThrow(
        new BadRequestException('System file paths must not traverse symbolic links'),
      );
      expect(fsCalls()).toHaveLength(0);
    });
  });

  describe('provider base path', () => {
    it('should use provider base path when available', async () => {
      const customBasePath = '/custom/path';

      mockProvider.getBasePath.mockReturnValue(customBasePath);
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('Hello, World!', 'utf-8'));

      await service.readFile(mockAgentId, 'test-file.txt');

      expect(agentProviderFactory.getProvider).toHaveBeenCalledWith('opencode');
      expect(mockProvider.getBasePath).toHaveBeenCalled();
      expect(containmentCalls()).toEqual([
        containmentCall(`${customBasePath}/test-file.txt`, 'follow', customBasePath),
      ]);
      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        `${customBasePath}/test-file.txt`,
        expect.any(Object),
      );
    });

    it('should resolve absolute paths against the provider base path', async () => {
      mockProvider.getBasePath.mockReturnValue('/custom/path');

      await expect(service.readFile(mockAgentId, '/app/test-file.txt')).rejects.toThrow(BadRequestException);

      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('x'));

      await service.readFile(mockAgentId, '/custom/path/test-file.txt');

      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/custom/path/test-file.txt',
        expect.any(Object),
      );
    });

    it('should fall back to default /app when provider getBasePath is not implemented', async () => {
      mockAgentProviderFactory.getProvider.mockReturnValue({} as never);
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('Hello, World!', 'utf-8'));

      await service.readFile(mockAgentId, 'test-file.txt');

      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/test-file.txt',
        expect.any(Object),
      );
    });

    it('should fall back to default /app when provider getBasePath returns empty string', async () => {
      mockProvider.getBasePath.mockReturnValue('');
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('Hello, World!', 'utf-8'));

      await service.readFile(mockAgentId, 'test-file.txt');

      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/test-file.txt',
        expect.any(Object),
      );
    });

    it('should fall back to default /app when provider factory throws error', async () => {
      mockAgentProviderFactory.getProvider.mockImplementation(() => {
        throw new Error('Provider not found');
      });
      dockerService.readFileBytesFromContainer.mockResolvedValue(Buffer.from('Hello, World!', 'utf-8'));

      await service.readFile(mockAgentId, 'test-file.txt');

      expect(dockerService.readFileBytesFromContainer).toHaveBeenCalledWith(
        mockContainerId,
        '/app/test-file.txt',
        expect.any(Object),
      );
    });
  });
});
