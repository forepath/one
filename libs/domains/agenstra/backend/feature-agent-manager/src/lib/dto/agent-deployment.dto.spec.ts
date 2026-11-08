import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  parseAgentDeploymentBodyTicket,
  parseAgentDeploymentJobId,
  parseAgentDeploymentRequestId,
  parseAgentDeploymentRunId,
  parseAgentDeploymentRunsQuery,
  parseAgentDeploymentTicket,
  parseAgentDeploymentTrigger,
  parseAgentDeploymentWorkflowCreate,
  parseAgentDeploymentWorkflowId,
  parseAgentDeploymentWorkflowUpdate,
} from './agent-deployment.dto';

describe('agent deployment dto', () => {
  const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

  it('normalizes UUIDv4 ids and reports others as not found', () => {
    expect(parseAgentDeploymentWorkflowId(` ${id} `)).toBe(id.toLowerCase());
    expect(parseAgentDeploymentRunId(id)).toBe(id.toLowerCase());
    expect(() => parseAgentDeploymentWorkflowId('42')).toThrow(NotFoundException);
    expect(() => parseAgentDeploymentRunId(undefined)).toThrow(NotFoundException);
    // UUIDv1 is not accepted
    expect(() => parseAgentDeploymentRunId('aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa')).toThrow(NotFoundException);
  });

  it('accepts provider job ids only', () => {
    expect(parseAgentDeploymentJobId(undefined)).toBeUndefined();
    expect(parseAgentDeploymentJobId('  ')).toBeUndefined();
    expect(parseAgentDeploymentJobId('123456')).toBe('123456');
    expect(parseAgentDeploymentJobId('stage:build-1')).toBe('stage:build-1');
    expect(() => parseAgentDeploymentJobId('a/b')).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentJobId('x'.repeat(256))).toThrow(BadRequestException);
  });

  it('parses the runs query', () => {
    expect(parseAgentDeploymentRunsQuery(undefined, undefined)).toEqual({});
    expect(parseAgentDeploymentRunsQuery('', '')).toEqual({});
    expect(parseAgentDeploymentRunsQuery(id, '100')).toEqual({ workflowId: id.toLowerCase(), limit: 100 });
    expect(() => parseAgentDeploymentRunsQuery(undefined, '1.5')).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentRunsQuery(undefined, 'abc')).toThrow(BadRequestException);
  });

  it('keeps only ref and string inputs of trigger bodies', () => {
    expect(parseAgentDeploymentTrigger(undefined)).toEqual({});
    expect(parseAgentDeploymentTrigger({ ref: null, inputs: null })).toEqual({});
    expect(
      parseAgentDeploymentTrigger({ ref: ' v1.2.0 ', inputs: { ' env ': 'prod' }, workflowId: 'x', agentId: 'y' }),
    ).toEqual({ ref: 'v1.2.0', inputs: { env: 'prod' } });
    expect(() => parseAgentDeploymentTrigger({ ref: '' })).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentTrigger({ ref: 'main\nrm' })).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentTrigger({ inputs: { '': 'v' } })).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentTrigger([])).toThrow(BadRequestException);
  });

  it('requires a context ticket for run actions', () => {
    expect(parseAgentDeploymentTicket(' ctx-abc ')).toBe('ctx-abc');
    expect(parseAgentDeploymentBodyTicket({ ticket: 'ctx-abc', ref: 'main' })).toBe('ctx-abc');
    expect(() => parseAgentDeploymentTicket(undefined)).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentTicket('  ')).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentTicket('x'.repeat(129))).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentBodyTicket(undefined)).toThrow(BadRequestException);
    expect(() => parseAgentDeploymentBodyTicket({ ticket: 42 })).toThrow(BadRequestException);
  });

  it('reports malformed action request ids as unknown', () => {
    expect(parseAgentDeploymentRequestId(' ctx_dep_0a1b ')).toBe('ctx_dep_0a1b');
    expect(() => parseAgentDeploymentRequestId(undefined)).toThrow(NotFoundException);
    expect(() => parseAgentDeploymentRequestId('../x')).toThrow(NotFoundException);
  });

  describe('workflow proposals', () => {
    const valid = { connectionId: id, name: ' Deploy ', repository: ' acme/app ' };

    it('keeps only the fields an environment may set', () => {
      expect(
        parseAgentDeploymentWorkflowCreate({
          ...valid,
          description: '  Multi\nline  ',
          workflow: 'deploy.yml',
          defaultRef: '',
          defaultInputs: { ' env ': 'staging' },
          agentTriggerEnabled: true,
          enabled: false,
          clientId: 'other',
        }),
      ).toEqual({
        connectionId: id.toLowerCase(),
        name: 'Deploy',
        repository: 'acme/app',
        description: 'Multi\nline',
        workflow: 'deploy.yml',
        defaultRef: null,
        defaultInputs: { env: 'staging' },
        agentTriggerEnabled: true,
        enabled: false,
      });
    });

    it('refuses scope and assigned environments instead of silently dropping them', () => {
      expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, scope: 'global' })).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, agentIds: [id] })).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowUpdate({ name: 'x', agentIds: [id] })).toThrow(BadRequestException);
    });

    it('requires connection, name and repository on create', () => {
      expect(() => parseAgentDeploymentWorkflowCreate(undefined)).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowCreate([])).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, connectionId: undefined })).toThrow(
        BadRequestException,
      );
      expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, name: '  ' })).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, repository: undefined })).toThrow(
        BadRequestException,
      );
    });

    it('enforces the shared bounds', () => {
      for (const extra of [
        { name: 'n'.repeat(201) },
        { repository: 'r'.repeat(513) },
        { workflow: 'w'.repeat(513) },
        { defaultRef: 'main\nx' },
        { description: 'd'.repeat(2001) },
        { defaultInputs: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, 'v'])) },
        { defaultInputs: { k: 'v'.repeat(1001) } },
        { defaultInputs: ['x'] },
        { enabled: 'no' },
      ]) {
        expect(() => parseAgentDeploymentWorkflowCreate({ ...valid, ...extra })).toThrow(BadRequestException);
      }
    });

    it('needs at least one field on update and clears nullable fields', () => {
      expect(parseAgentDeploymentWorkflowUpdate({ workflow: null, defaultInputs: null })).toEqual({
        workflow: null,
        defaultInputs: {},
      });
      expect(parseAgentDeploymentWorkflowUpdate({ agentTriggerEnabled: false })).toEqual({
        agentTriggerEnabled: false,
      });
      expect(() => parseAgentDeploymentWorkflowUpdate({})).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowUpdate({ scope: 'global' })).toThrow(BadRequestException);
      expect(() => parseAgentDeploymentWorkflowUpdate({ connectionId: 'x' })).toThrow(BadRequestException);
    });
  });
});
