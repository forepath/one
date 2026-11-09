import {
  AGENSTRA_CONTENT_MCP_TOOL_NAMES,
  AGENSTRA_CONTENT_MCP_TOOL_PERMISSION,
  AGENT_CONTENT_TOOL_OPERATIONS,
  AGENT_CONTENT_WRITE_OPERATIONS,
  INITIATIVE_CONTENT_WRITE_OPERATIONS,
  TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS,
  agentContentToolForOperation,
  isAgenstraContentToolPermission,
  normalizeAgentContentWriteOperations,
} from './content-platform';
import { AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION, isAgenstraContextToolPermission } from './context-platform';
import {
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
} from './plan-platform';

describe('content platform', () => {
  it('maps every change operation to exactly one tool and back', () => {
    expect(Object.values(AGENT_CONTENT_TOOL_OPERATIONS).sort()).toEqual([...AGENT_CONTENT_WRITE_OPERATIONS].sort());

    for (const operation of AGENT_CONTENT_WRITE_OPERATIONS) {
      expect(AGENT_CONTENT_TOOL_OPERATIONS[agentContentToolForOperation(operation)]).toBe(operation);
    }

    expect(AGENT_CONTENT_TOOL_OPERATIONS[AGENSTRA_CONTENT_MCP_TOOL_NAMES.changeStatus]).toBeUndefined();
  });

  it('never lets ticket automation delete, change knowledge or re-plan initiatives', () => {
    expect(
      TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS.every(
        (operation) => operation.startsWith('ticket.') || operation === 'initiative.finding',
      ),
    ).toBe(true);
    expect(TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS).not.toContain('ticket.delete');
    expect(TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS as readonly string[]).not.toContain('initiative.propose');
  });

  it('normalizes opt-ins to known operations in canonical order', () => {
    expect(normalizeAgentContentWriteOperations(['page.update', 'nope', 'ticket.create', 'page.update', 3])).toEqual([
      'ticket.create',
      'page.update',
    ]);
    expect(normalizeAgentContentWriteOperations(undefined)).toEqual([]);
  });

  it('keeps content tools out of the read-only context permission and plan sessions', () => {
    const toolIds = Object.values(AGENSTRA_CONTENT_MCP_TOOL_NAMES).map((name) => `agenstra_${name}`);

    expect(AGENSTRA_CONTENT_MCP_TOOL_PERMISSION).not.toBe(AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION);

    for (const toolId of toolIds) {
      expect(isAgenstraContentToolPermission(toolId)).toBe(true);
      expect(isAgenstraContextToolPermission(toolId)).toBe(false);
      // Plans never auto-allow content tools; residual asks are rejected.
      expect(isAgenstraPlanExplorePermission(toolId)).toBe(false);
      expect(isAgenstraPlanWritePermission(toolId)).toBe(true);
    }

    expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET.map((rule) => rule.permission)).not.toContain(
      AGENSTRA_CONTENT_MCP_TOOL_PERMISSION,
    );
  });

  describe('plan.update', () => {
    it('is a content operation with its own tool', () => {
      expect(AGENT_CONTENT_WRITE_OPERATIONS).toContain('plan.update');
      expect(AGENT_CONTENT_TOOL_OPERATIONS[AGENSTRA_CONTENT_MCP_TOOL_NAMES.planUpdate]).toBe('plan.update');
      expect(agentContentToolForOperation('plan.update')).toBe('content_plan_update');
      expect(normalizeAgentContentWriteOperations(['plan.update', 'plan.delete'])).toEqual(['plan.update']);
    });

    it('is never available to ticket automation (tickets of its own tree only)', () => {
      expect(TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS as readonly string[]).not.toContain('plan.update');
    });
  });

  describe('initiative operations', () => {
    it('have their own tools under the content prefix (denied in plan and step sessions)', () => {
      expect(agentContentToolForOperation('initiative.propose')).toBe('content_initiative_propose');
      expect(agentContentToolForOperation('initiative.finding')).toBe('content_initiative_finding');
      expect(INITIATIVE_CONTENT_WRITE_OPERATIONS).toEqual(['initiative.propose', 'initiative.finding']);
      expect(isAgenstraPlanWritePermission('agenstra_content_initiative_propose')).toBe(true);
    });

    it('are opt-ins like every other operation', () => {
      expect(normalizeAgentContentWriteOperations(['initiative.finding', 'initiative.accept'])).toEqual([
        'initiative.finding',
      ]);
    });
  });
});
