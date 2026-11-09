import { INITIATIVE_LIMITS } from './catalog';
import {
  normalizeInitiativeTurnStatus,
  parseInitiativeProposal,
  parseInitiativeTurnStatusFromText,
  stripInitiativeTurnStatusBlock,
} from './turn-status';

describe('parseInitiativeTurnStatusFromText', () => {
  it('reads the last fenced json block', () => {
    const text = [
      'Here is my draft.',
      '```json',
      '{ "status": "drafting", "message": "first" }',
      '```',
      'More text',
      '```json',
      '{ "status": "ready", "message": "done", "draftMarkdown": "# PRD" }',
      '```',
    ].join('\n');

    expect(parseInitiativeTurnStatusFromText(text)).toMatchObject({
      status: 'ready',
      message: 'done',
      draftMarkdown: '# PRD',
    });
  });

  it('reads a block whose document contains code fences (also json ones) after prose with braces', () => {
    const draftMarkdown = '# Architecture\n\n```json\n{ "port": 3100 }\n```\n\n```ts\nconst a = 1;\n```';
    const text = [
      'I used the {placeholder} convention.',
      '```json',
      JSON.stringify({ status: 'ready', message: 'done', draftMarkdown }),
      '```',
    ].join('\n');

    expect(parseInitiativeTurnStatusFromText(text)).toMatchObject({ status: 'ready', draftMarkdown });
  });

  it('accepts a bare JSON object', () => {
    expect(parseInitiativeTurnStatusFromText('{"status":"needs_input","message":"Who are the users?"}')?.status).toBe(
      'needs_input',
    );
  });

  it('returns undefined without a usable status', () => {
    expect(parseInitiativeTurnStatusFromText('just prose')).toBeUndefined();
    expect(parseInitiativeTurnStatusFromText('```json\n{"status":"exploring"}\n```')).toBeUndefined();
    expect(parseInitiativeTurnStatusFromText('')).toBeUndefined();
  });

  it('strips the status block from the visible text', () => {
    expect(stripInitiativeTurnStatusBlock('Answer\n```json\n{ "status": "ready" }\n```')).toBe('Answer');
  });
});

describe('normalizeInitiativeTurnStatus', () => {
  it('filters invalid work items and bounds lists', () => {
    const status = normalizeInitiativeTurnStatus({
      status: 'ready',
      workItems: [
        { key: 'N1', kind: 'story', title: 'Login', after: ['E1.S2', 'N0', 'bad key!', 7], unknowns: ['Which IdP?'] },
        { key: 'N2', title: '' },
        { key: '../etc', title: 'x' },
        { key: 'N3', kind: 'weird', title: 'Defaults to story' },
      ],
    });

    expect(status?.workItems).toEqual([
      {
        key: 'N1',
        kind: 'story',
        title: 'Login',
        requirements: undefined,
        verify: undefined,
        doneWhen: undefined,
        after: ['E1.S2', 'N0'],
        unknowns: [{ question: 'Which IdP?', resolution: 'settle_now' }],
      },
      expect.objectContaining({ key: 'N3', kind: 'story' }),
    ]);
  });

  it('clips oversized text instead of failing', () => {
    const status = normalizeInitiativeTurnStatus({
      status: 'ready',
      message: 'x'.repeat(INITIATIVE_LIMITS.messageMaxLength + 10),
      draftMarkdown: 'y'.repeat(INITIATIVE_LIMITS.contentMaxLength + 10),
    });

    expect(status?.message).toHaveLength(INITIATIVE_LIMITS.messageMaxLength);
    expect(status?.draftMarkdown).toHaveLength(INITIATIVE_LIMITS.contentMaxLength);
  });

  it('keeps findings, decisions, verdict and epic refinement', () => {
    const status = normalizeInitiativeTurnStatus({
      status: 'ready',
      findings: [{ severity: 'major', body: 'Gap', itemKey: 'E1.S1', evidence: ['ticket:abcd'] }, { body: '' }],
      decisions: [{ title: 'Use OIDC', body: 'because' }, { body: 'no title' }],
      verdict: 'rejected',
      epic: { requirements: 'FR-1', unknowns: [{ question: 'Q', resolution: 'spike' }] },
    });

    expect(status?.findings).toEqual([{ severity: 'major', body: 'Gap', itemKey: 'E1.S1', evidence: ['ticket:abcd'] }]);
    expect(status?.decisions).toEqual([{ title: 'Use OIDC', body: 'because' }]);
    expect(status?.verdict).toBe('rejected');
    expect(status?.epic).toEqual({
      requirements: 'FR-1',
      doneWhen: undefined,
      unknowns: [{ question: 'Q', resolution: 'spike' }],
    });
  });

  it('rejects unknown statuses', () => {
    expect(normalizeInitiativeTurnStatus({ status: 'done' })).toBeUndefined();
    expect(normalizeInitiativeTurnStatus(null)).toBeUndefined();
  });
});

describe('parseInitiativeProposal', () => {
  it('parses artifact changes and work item operations', () => {
    const proposal = parseInitiativeProposal({
      title: 'Switch to OIDC',
      rationale: 'Retro finding',
      artifacts: [
        { type: 'prd', content: '# PRD v2' },
        { type: 'nope', content: 'x' },
        { type: 'architecture', content: ' ' },
      ],
      workItems: [
        { op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'New story' } },
        { op: 'update', key: 'E1.S2', requirements: 'changed', after: ['E1.S1'] },
        { op: 'drop', key: 'E1.S3' },
        { op: 'move', key: 'E1.S4', beforeKey: 'E1.S2' },
        { op: 'explode', key: 'E1' },
      ],
      decisions: [{ title: 'OIDC', body: 'IdP is given' }],
    });

    expect(proposal?.artifacts).toEqual([{ type: 'prd', content: '# PRD v2' }]);
    expect(proposal?.workItems.map((op) => op.op)).toEqual(['add', 'update', 'drop', 'move']);
    expect(proposal?.decisions).toHaveLength(1);
  });

  it('requires a title', () => {
    expect(parseInitiativeProposal({ rationale: 'x' })).toBeUndefined();
  });
});
