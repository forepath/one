import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { TicketAutomationRunStatus } from '../entities/ticket-automation.enums';

import { AgentDeploymentSourcesService, parseAgentDeploymentActionSource } from './agent-deployment-sources.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- repository doubles */

describe('AgentDeploymentSourcesService', () => {
  const clientId = 'client-1';
  const agentId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  let taskRepo: any;
  let taskRunRepo: any;
  let automationRepo: any;
  let automationRunRepo: any;
  let service: AgentDeploymentSourcesService;

  beforeEach(() => {
    taskRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: taskId,
        approvedAt: new Date(),
        allowedDeploymentOperations: ['deployment.trigger'],
      }),
    };
    taskRunRepo = { findOne: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) };
    automationRepo = { findOne: jest.fn().mockResolvedValue({ allowedDeploymentOperations: ['deployment.cancel'] }) };
    automationRunRepo = { find: jest.fn().mockResolvedValue([{ id: 'arun-1', ticketId: 'ticket-1' }]) };
    service = new AgentDeploymentSourcesService(taskRepo, taskRunRepo, automationRepo, automationRunRepo);
  });

  describe('parseAgentDeploymentActionSource', () => {
    it('accepts chat, automation and task sources (task ids normalized, extra fields dropped)', () => {
      expect(parseAgentDeploymentActionSource({ kind: 'chat', taskId })).toEqual({ kind: 'chat' });
      expect(parseAgentDeploymentActionSource({ kind: 'automation', ticketId: 'x' })).toEqual({ kind: 'automation' });
      expect(parseAgentDeploymentActionSource({ kind: 'task', taskId: ` ${taskId.toUpperCase()} ` })).toEqual({
        kind: 'task',
        taskId,
      });
    });

    it('rejects missing sources with 400 and unknown ones with 403', () => {
      expect(() => parseAgentDeploymentActionSource(undefined)).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentActionSource(null)).toThrow(BadRequestException);

      for (const raw of [{}, { kind: 'user' }, { kind: 'task' }, { kind: 'task', taskId: 'x' }, 'chat', []]) {
        expect(() => parseAgentDeploymentActionSource(raw)).toThrow(ForbiddenException);
      }
    });
  });

  it('allows chat actions (decided by the user in the visible chat)', async () => {
    await expect(
      service.assertSourceAllows(clientId, agentId, { kind: 'chat' }, 'deployment.cancel'),
    ).resolves.toBeUndefined();
    expect(taskRepo.findOne).not.toHaveBeenCalled();
    expect(automationRunRepo.find).not.toHaveBeenCalled();
  });

  describe('tasks', () => {
    const source = { kind: 'task' as const, taskId };

    it('allows the operations a user approved for the working task run of this agent', async () => {
      await expect(
        service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger'),
      ).resolves.toBeUndefined();
      expect(taskRepo.findOne).toHaveBeenCalledWith({ where: { id: taskId, clientId, agentId } });
      expect(taskRunRepo.findOne).toHaveBeenCalledWith({ where: { taskId, status: 'running' } });
    });

    it('rejects unapproved or foreign tasks', async () => {
      taskRepo.findOne.mockResolvedValueOnce({ id: taskId, approvedAt: null, allowedDeploymentOperations: [] });

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger')).rejects.toThrow(
        'not approved',
      );

      taskRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('explains how to request an operation that was not approved', async () => {
      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).rejects.toThrow(
        'only these deployment actions: deployment.trigger',
      );

      taskRepo.findOne.mockResolvedValueOnce({ id: taskId, approvedAt: new Date(), allowedDeploymentOperations: [] });

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).rejects.toThrow(
        'propose allowedDeploymentOperations (e.g. ["deployment.cancel"]) with agenstra_tasks_update',
      );
    });

    it('ignores unknown stored operations and requires a working run', async () => {
      taskRepo.findOne.mockResolvedValueOnce({
        id: taskId,
        approvedAt: new Date(),
        allowedDeploymentOperations: ['deployment.delete'],
      });

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      taskRunRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger')).rejects.toThrow(
        'not working anymore',
      );
    });
  });

  describe('ticket automation', () => {
    const source = { kind: 'automation' as const };

    it('allows the operations of the automation of the single working run of this agent', async () => {
      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).resolves.toBeUndefined();
      expect(automationRunRepo.find).toHaveBeenCalledWith({
        where: { clientId, agentId, status: TicketAutomationRunStatus.RUNNING },
        take: 2,
      });
      expect(automationRepo.findOne).toHaveBeenCalledWith({ where: { ticketId: 'ticket-1' } });
    });

    it('rejects operations the automation does not allow', async () => {
      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.trigger')).rejects.toThrow(
        'only request these deployment actions: deployment.cancel',
      );

      automationRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).rejects.toThrow(
        'may not start or cancel deployments',
      );
    });

    it('requires exactly one working automation run', async () => {
      automationRunRepo.find.mockResolvedValueOnce([]);

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).rejects.toThrow(
        'No automation run is working',
      );

      automationRunRepo.find.mockResolvedValueOnce([
        { id: 'a', ticketId: 't1' },
        { id: 'b', ticketId: 't2' },
      ]);

      await expect(service.assertSourceAllows(clientId, agentId, source, 'deployment.cancel')).rejects.toThrow(
        'Several automation runs',
      );
      expect(automationRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
