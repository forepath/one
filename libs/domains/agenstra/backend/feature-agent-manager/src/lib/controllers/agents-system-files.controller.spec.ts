import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { FileNodeDto } from '../dto/file-node.dto';
import { AgentFileSystemService } from '../services/agent-file-system.service';

import { AgentsSystemFilesController } from './agents-system-files.controller';

describe('AgentsSystemFilesController', () => {
  let controller: AgentsSystemFilesController;
  const mockAgentId = 'test-agent-uuid';
  const mockService = {
    writeSystemFile: jest.fn(),
    createSystemFileOrDirectory: jest.fn(),
    deleteSystemFileOrDirectory: jest.fn(),
    listSystemDirectory: jest.fn(),
    writeFile: jest.fn(),
    createFileOrDirectory: jest.fn(),
    deleteFileOrDirectory: jest.fn(),
    listDirectory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsSystemFilesController],
      providers: [
        {
          provide: AgentFileSystemService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsSystemFilesController>(AgentsSystemFilesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listDirectory', () => {
    it('lists via the system channel and defaults to the workspace root', async () => {
      const nodes: FileNodeDto[] = [{ name: 'a.md', type: 'file', path: '/opt/agenstra/context/a.md' }];

      mockService.listSystemDirectory.mockResolvedValue(nodes);

      await expect(controller.listDirectory(mockAgentId, '/opt/agenstra/context')).resolves.toEqual(nodes);
      expect(mockService.listSystemDirectory).toHaveBeenCalledWith(mockAgentId, '/opt/agenstra/context', false);

      await controller.listDirectory(mockAgentId, undefined, 'true');
      expect(mockService.listSystemDirectory).toHaveBeenLastCalledWith(mockAgentId, '.', true);
      expect(mockService.listDirectory).not.toHaveBeenCalled();
    });
  });

  describe('writeFile', () => {
    it('writes the raw body via writeSystemFile', async () => {
      const body = Buffer.from('# skill');

      await controller.writeFile(mockAgentId, ['home', 'agenstra', '.config', 'skill.md'], {
        body,
      } as Request);

      expect(mockService.writeSystemFile).toHaveBeenCalledWith(mockAgentId, 'home/agenstra/.config/skill.md', body);
      expect(mockService.writeFile).not.toHaveBeenCalled();
    });

    it('rejects non-buffer bodies', async () => {
      await expect(
        controller.writeFile(mockAgentId, '/opt/agenstra/context/a.txt', { body: { a: 1 } } as unknown as Request),
      ).rejects.toThrow(new BadRequestException('Expected raw binary body'));
      expect(mockService.writeSystemFile).not.toHaveBeenCalled();
    });

    it('rejects missing or object paths', async () => {
      await expect(controller.writeFile(mockAgentId, undefined, { body: Buffer.alloc(0) } as Request)).rejects.toThrow(
        'File path is required',
      );
      await expect(controller.writeFile(mockAgentId, { a: 1 }, { body: Buffer.alloc(0) } as Request)).rejects.toThrow(
        'File path must be a string or array, got object',
      );
    });
  });

  describe('createFileOrDirectory', () => {
    it('creates via createSystemFileOrDirectory', async () => {
      await controller.createFileOrDirectory(mockAgentId, '/opt/agenstra/context', { type: 'directory' });

      expect(mockService.createSystemFileOrDirectory).toHaveBeenCalledWith(
        mockAgentId,
        '/opt/agenstra/context',
        'directory',
      );
      expect(mockService.createFileOrDirectory).not.toHaveBeenCalled();
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('deletes via deleteSystemFileOrDirectory', async () => {
      await controller.deleteFileOrDirectory(mockAgentId, '/opt/agenstra/context/a.txt');

      expect(mockService.deleteSystemFileOrDirectory).toHaveBeenCalledWith(mockAgentId, '/opt/agenstra/context/a.txt');
      expect(mockService.deleteFileOrDirectory).not.toHaveBeenCalled();
    });
  });
});
