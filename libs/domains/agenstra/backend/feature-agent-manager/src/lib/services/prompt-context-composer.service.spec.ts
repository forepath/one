import { ContainerType } from '../entities/agent.entity';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import { PromptContextComposerService } from './prompt-context-composer.service';

describe('PromptContextComposerService', () => {
  let service: PromptContextComposerService;

  beforeEach(() => {
    service = new PromptContextComposerService();
  });

  it('should keep message unchanged without context injection', () => {
    expect(service.composeChatMessage('hello')).toBe('hello');
  });

  it('should prepend hidden workspace and environment context', () => {
    const result = service.composeChatMessage('Implement this', {
      includeWorkspace: true,
      environmentIds: ['env-1'],
    });

    expect(result).toContain('<hidden-context>');
    expect(result).toContain('/opt/workspace');
    expect(result).toContain('Relevant environment context: env-1.');
    expect(result).toContain('Implement this');
  });

  it('should include workspace repository type when enriched', () => {
    const result = service.composeChatMessage('Implement this', {
      includeWorkspace: true,
      workspaceContainerType: ContainerType.DOCKER,
    });

    expect(result).toContain('Repository type: docker.');
    expect(result).not.toContain('Repository type: generic');
  });

  it('should omit workspace repository type when generic or not enriched', () => {
    const withoutEnrichment = service.composeChatMessage('Implement this', {
      includeWorkspace: true,
    });
    const genericEnrichment = service.composeChatMessage('Implement this', {
      includeWorkspace: true,
      workspaceContainerType: ContainerType.GENERIC,
    });

    expect(withoutEnrichment).not.toContain('Repository type:');
    expect(genericEnrichment).not.toContain('Repository type:');
  });

  it('should annotate environment context with repository type when enriched', () => {
    const result = service.composeChatMessage('Implement this', {
      environmentIds: ['env-1', 'env-2'],
      environmentContainerTypes: [{ id: 'env-2', containerType: ContainerType.TERRAFORM }],
    });

    expect(result).toContain('Relevant environment context: env-1, env-2 (repository type: terraform).');
  });

  it('should keep generic-only environment ids without type annotation', () => {
    const result = service.composeChatMessage('Implement this', {
      environmentIds: ['env-1'],
      environmentContainerTypes: [],
    });

    expect(result).toContain('Relevant environment context: env-1.');
    expect(result).not.toContain('repository type:');
  });

  it('should include ticket sha references in hidden context', () => {
    const result = service.composeChatMessage('Implement this', {
      ticketShas: ['329ec4f', '329ec4f443e9dd75319f770816c5c1ee337f2134'],
    });

    expect(result).toContain('Relevant ticket references for context');
    expect(result).toContain('329ec4f');
    expect(result).toContain('329ec4f443e9dd75319f770816c5c1ee337f2134');
  });

  it('should include full ticket contexts when provided', () => {
    const result = service.composeChatMessage('Implement this', {
      ticketContexts: ['Parent tickets...\nThis ticket and its subtasks:\n- [ ] Task'],
    });

    expect(result).toContain('Detailed ticket hierarchy context is provided below');
    expect(result).toContain('Ticket context #1:');
    expect(result).toContain('This ticket and its subtasks');
  });

  it('should include knowledge references and contexts when provided', () => {
    const result = service.composeChatMessage('Implement this', {
      knowledgeShas: ['9f9fae1', '9f9fae13243d3a45ca4d48f2a57eb67fdf111111'],
      knowledgeContexts: ['Knowledge Page: Product Brief\nImportant details'],
    });

    expect(result).toContain('Relevant knowledge references for context');
    expect(result).toContain('9f9fae1');
    expect(result).toContain('Detailed knowledge page context is provided below');
    expect(result).toContain('Knowledge context #1:');
    expect(result).toContain('Knowledge Page: Product Brief');
  });

  it('composeEnhanceMessage wraps draft after composing context', () => {
    const result = service.composeEnhanceMessage('Fix the bug', {
      includeWorkspace: true,
      environmentIds: ['env-a'],
    });

    expect(result).toContain('<<<DRAFT>>>');
    expect(result).toContain('/opt/workspace');
    expect(result).toContain('env-a');
    expect(result).toContain('Fix the bug');
  });

  it('composeTicketBodyMessage includes hierarchy when provided', () => {
    const result = service.composeTicketBodyMessage('My feature', '- [ ] Subtask', { ticketShas: ['abc1234'] });

    expect(result).toContain('<<<TITLE>>>');
    expect(result).toContain('My feature');
    expect(result).toContain('<<<TICKET_TREE>>>');
    expect(result).toContain('- [ ] Subtask');
    expect(result).toContain('abc1234');
  });

  it('ignores empty context values and keeps message unchanged', () => {
    const result = service.composeChatMessage('Plain message', {
      environmentIds: ['   '],
      ticketShas: [''],
      ticketContexts: ['   '],
      knowledgeShas: [''],
      knowledgeContexts: ['   '],
    });

    expect(result).toBe('Plain message');
  });

  describe('with a context ticket (worker context MCP)', () => {
    const contextTicket: AgentContextTicketRecord = {
      ticket: 'ctx-test',
      scopeAnchors: [],
      agentId: 'agent-1',
      sessionKey: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode: 'ask',
      items: [
        { index: 1, kind: 'ticket', title: 'Fix login', sha: '329ec4f443e9', content: 'TICKET BODY' },
        { index: 2, kind: 'knowledge', title: 'Auth design', content: 'KNOWLEDGE BODY' },
      ],
      grants: { ticket: ['329ec4f443e9'], knowledge: [] },
      attachments: [],
      environments: [],
      createdAt: 0,
      lastUsedAt: 0,
    };
    const injection = {
      includeWorkspace: true,
      ticketShas: ['329ec4f'],
      ticketContexts: ['TICKET BODY'],
      knowledgeShas: ['abcd123'],
      knowledgeContexts: ['KNOWLEDGE BODY'],
      attachmentContexts: [
        {
          id: 'att-1',
          fileName: 'spec.pdf',
          contentType: 'application/pdf',
          byteSize: 10,
          agentPath: '/opt/agenstra/attachments/spec.pdf',
          downloadUrl: '/api/attachments/att-1/download',
        },
      ],
    };

    it('replaces inlined ticket and knowledge bodies with MCP hints', () => {
      const result = service.composeChatMessage('Implement this', injection, contextTicket);

      expect(result).toContain('<hidden-context>');
      expect(result).toContain('Context ticket: ctx-test');
      expect(result).toContain('item:1 [ticket 329ec4f4] "Fix login"');
      expect(result).toContain('item:2 [knowledge] "Auth design"');
      expect(result).toContain('Relevant ticket references for context: 329ec4f');
      expect(result).toContain('Relevant knowledge references for context: abcd123');
      expect(result).not.toContain('TICKET BODY');
      expect(result).not.toContain('KNOWLEDGE BODY');
      expect(result.endsWith('Implement this')).toBe(true);
    });

    it('keeps workspace and attachment hints unchanged', () => {
      const result = service.composeChatMessage('Implement this', injection, contextTicket);

      expect(result).toContain('/opt/workspace');
      expect(result).toContain('/opt/agenstra/attachments/spec.pdf');
    });

    it('is much shorter than the inline composition', () => {
      const big = { ...injection, ticketContexts: ['T'.repeat(5000)], knowledgeContexts: ['K'.repeat(5000)] };
      const inline = service.composeChatMessage('Implement this', big);
      const hinted = service.composeChatMessage('Implement this', big, contextTicket);

      expect(inline.length).toBeGreaterThan(10_000);
      expect(hinted.length).toBeLessThan(2_000);
    });

    it('passes the ticket through enhance and ticket-body composition', () => {
      expect(service.composeEnhanceMessage('Draft', injection, contextTicket)).toContain('ctx-test');
      expect(service.composeTicketBodyMessage('Title', undefined, injection, contextTicket)).toContain('ctx-test');
      expect(service.composeEnhanceMessage('Draft', injection, contextTicket)).not.toContain('TICKET BODY');
    });
  });
});
