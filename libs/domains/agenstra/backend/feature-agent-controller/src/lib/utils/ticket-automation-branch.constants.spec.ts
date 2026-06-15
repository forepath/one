import {
  DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY,
  ephemeralAutomationBranchNameForRun,
  stableAutomationBranchNameForTicket,
} from './ticket-automation-branch.constants';

describe('ticket-automation-branch.constants', () => {
  it('default strategy is reuse_per_ticket', () => {
    expect(DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY).toBe('reuse_per_ticket');
  });

  it('stable branch embeds ticket id', () => {
    const tid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    expect(stableAutomationBranchNameForTicket(tid)).toBe(`automation/ticket/aaaaaaaa`);
  });

  it('ephemeral branch uses first 8 chars of run id', () => {
    const rid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    expect(ephemeralAutomationBranchNameForRun(rid)).toBe('automation/run/dddddddd');
  });
});
