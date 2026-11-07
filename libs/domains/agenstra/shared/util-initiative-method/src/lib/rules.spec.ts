import {
  evaluateReadiness,
  findDependencyCycle,
  isWorkItemKey,
  nextEpicKey,
  nextItemKey,
  stepAvailability,
  ticketStatusForWorkItemStatus,
  whatsNext,
  workItemStatusFromTicketStatus,
  type InitiativeSnapshot,
  type RuleWorkItem,
} from './rules';
import { findInitiativeStep } from './catalog';

const epic = (id: string, key: string, status: RuleWorkItem['status'] = 'draft'): RuleWorkItem => ({
  id,
  key,
  kind: 'epic',
  parentId: null,
  status,
  sortOrder: 0,
});
const story = (
  id: string,
  key: string,
  parentId: string,
  status: RuleWorkItem['status'],
  extra: Partial<RuleWorkItem> = {},
): RuleWorkItem => ({
  id,
  key,
  kind: 'story',
  parentId,
  status,
  sortOrder: 0,
  ...extra,
});

describe('work item status mapping', () => {
  it.each([
    ['draft', 'draft'],
    ['todo', 'ready-for-dev'],
    ['in_progress', 'in-progress'],
    ['prototype', 'built'],
    ['done', 'done'],
    ['closed', 'dropped'],
    ['unknown', 'draft'],
  ])('maps ticket %s to %s', (ticket, item) => {
    expect(workItemStatusFromTicketStatus(ticket)).toBe(item);
  });

  it('maps back to ticket statuses', () => {
    expect(ticketStatusForWorkItemStatus('done')).toBe('done');
    expect(ticketStatusForWorkItemStatus('dropped')).toBe('closed');
    expect(ticketStatusForWorkItemStatus('blocked')).toBeUndefined();
  });
});

describe('evaluateReadiness', () => {
  const items = [
    epic('e1', 'E1'),
    story('s1', 'E1.S1', 'e1', 'built'),
    story('s2', 'E1.S2', 'e1', 'draft'),
    epic('e2', 'E2'),
    story('s3', 'E2.S1', 'e2', 'draft'),
  ];

  it('blocks items whose prerequisite is not done (default)', () => {
    const readiness = evaluateReadiness(items, [{ workItemId: 's2', prerequisiteId: 's1' }], {
      prerequisiteSatisfiedAt: 'done',
    });

    expect(readiness.get('s2')).toEqual({ ready: false, blockedBy: ['E1.S1'], satisfied: false });
  });

  it('accepts built prerequisites when the initiative allows it', () => {
    const readiness = evaluateReadiness(items, [{ workItemId: 's2', prerequisiteId: 's1' }], {
      prerequisiteSatisfiedAt: 'built',
    });

    expect(readiness.get('s2')?.ready).toBe(true);
  });

  it('keeps done checkpoints waiting for done even when built counts', () => {
    const withCheckpoint = items.map((item) => (item.id === 's1' ? { ...item, doneCheckpoint: true } : item));
    const readiness = evaluateReadiness(withCheckpoint, [{ workItemId: 's2', prerequisiteId: 's1' }], {
      prerequisiteSatisfiedAt: 'built',
    });

    expect(readiness.get('s2')?.ready).toBe(false);
  });

  it('applies epic dependencies to the items of the dependent epic', () => {
    const readiness = evaluateReadiness(items, [{ workItemId: 'e2', prerequisiteId: 'e1' }], {
      prerequisiteSatisfiedAt: 'built',
    });

    // E1.S2 is still draft, so E1 is not satisfied.
    expect(readiness.get('s3')).toEqual({ ready: false, blockedBy: ['E1'], satisfied: false });
  });

  it('satisfies an epic when all of its items are satisfied and its retrospective did not reject it', () => {
    const finished = items.map((item) => (item.id === 's2' ? { ...item, status: 'done' as const } : item));
    const deps = [{ workItemId: 'e2', prerequisiteId: 'e1' }];

    expect(evaluateReadiness(finished, deps, { prerequisiteSatisfiedAt: 'built' }).get('s3')?.ready).toBe(true);
    expect(
      evaluateReadiness(finished, deps, {
        prerequisiteSatisfiedAt: 'built',
        retrospectiveVerdicts: { e1: 'rejected' },
      }).get('s3')?.ready,
    ).toBe(false);
  });

  it('treats dropped prerequisites as satisfied and empty epics as unsatisfied', () => {
    const dropped = [epic('e1', 'E1'), story('s1', 'E1.S1', 'e1', 'dropped'), story('s2', 'E1.S2', 'e1', 'draft')];

    expect(
      evaluateReadiness(dropped, [{ workItemId: 's2', prerequisiteId: 's1' }], { prerequisiteSatisfiedAt: 'done' }).get(
        's2',
      )?.ready,
    ).toBe(true);
    expect(evaluateReadiness([epic('e1', 'E1')], [], { prerequisiteSatisfiedAt: 'done' }).get('e1')?.satisfied).toBe(
      false,
    );
  });
});

describe('findDependencyCycle', () => {
  it('detects self and transitive cycles', () => {
    expect(findDependencyCycle([], [{ workItemId: 'a', prerequisiteId: 'a' }])).not.toBeNull();
    expect(
      findDependencyCycle([{ workItemId: 'b', prerequisiteId: 'a' }], [{ workItemId: 'a', prerequisiteId: 'b' }]),
    ).toEqual({ workItemId: 'a', prerequisiteId: 'b' });
    expect(
      findDependencyCycle([
        { workItemId: 'b', prerequisiteId: 'a' },
        { workItemId: 'c', prerequisiteId: 'b' },
        { workItemId: 'a', prerequisiteId: 'c' },
      ]),
    ).not.toBeNull();
  });

  it('accepts acyclic graphs', () => {
    expect(
      findDependencyCycle(
        [
          { workItemId: 'b', prerequisiteId: 'a' },
          { workItemId: 'c', prerequisiteId: 'a' },
        ],
        [{ workItemId: 'c', prerequisiteId: 'b' }],
      ),
    ).toBeNull();
  });
});

describe('findDependencyCycle with the epic structure', () => {
  const parentOf = new Map<string, string | null>([
    ['e1', null],
    ['e2', null],
    ['e1s1', 'e1'],
    ['e1s2', 'e1'],
    ['e2s1', 'e2'],
  ]);

  it('refuses an item waiting for its own epic (the epic waits for its items)', () => {
    expect(findDependencyCycle([], [{ workItemId: 'e1s2', prerequisiteId: 'e1' }], parentOf)).not.toBeNull();
    // Without the structure the explicit graph alone looks fine.
    expect(findDependencyCycle([], [{ workItemId: 'e1s2', prerequisiteId: 'e1' }])).toBeNull();
  });

  it('refuses cycles through inherited epic prerequisites', () => {
    expect(
      findDependencyCycle(
        [{ workItemId: 'e2', prerequisiteId: 'e1' }],
        [{ workItemId: 'e1s1', prerequisiteId: 'e2s1' }],
        parentOf,
      ),
    ).toEqual({ workItemId: 'e1s1', prerequisiteId: 'e2s1' });
  });

  it('accepts epics in order and items ordered within an epic', () => {
    expect(
      findDependencyCycle(
        [{ workItemId: 'e2', prerequisiteId: 'e1' }],
        [
          { workItemId: 'e1s2', prerequisiteId: 'e1s1' },
          { workItemId: 'e2s1', prerequisiteId: 'e1s2' },
        ],
        parentOf,
      ),
    ).toBeNull();
  });
});

describe('keys', () => {
  it('never reuses keys', () => {
    expect(nextEpicKey([])).toBe('E1');
    expect(nextEpicKey(['E1', 'E3.S2'])).toBe('E4');
    expect(nextItemKey('E2', ['E2.S1', 'E2.S4', 'E1.S9'])).toBe('E2.S5');
    expect(() => nextItemKey('E2.S1', [])).toThrow();
  });

  it('validates key shapes', () => {
    expect(isWorkItemKey('E1')).toBe(true);
    expect(isWorkItemKey('E1.S12')).toBe(true);
    expect(isWorkItemKey('S1')).toBe(false);
  });
});

const snapshot = (overrides: Partial<InitiativeSnapshot> = {}): InitiativeSnapshot => ({
  path: 'project',
  hasIntent: true,
  acceptedArtifactTypes: new Set(),
  epics: [],
  openFindings: 0,
  openProposals: 0,
  ...overrides,
});

describe('stepAvailability', () => {
  it('requires a refined epic for story inception', () => {
    const step = findInitiativeStep('incept-stories');
    const epics = [
      {
        id: 'e1',
        key: 'E1',
        title: 'Epic',
        refined: false,
        status: 'draft' as const,
        items: [],
        hasRetrospective: false,
      },
    ];

    expect(stepAvailability(step!, snapshot({ epics }), 'e1').available).toBe(false);
    expect(stepAvailability(step!, snapshot({ epics: [{ ...epics[0], refined: true }] }), 'e1').available).toBe(true);
    expect(stepAvailability(step!, snapshot({ epics }), null).missing).toContain('Choose an epic.');
  });

  it('only warns about soft needs', () => {
    const availability = stepAvailability(findInitiativeStep('prd')!, snapshot());

    expect(availability.available).toBe(true);
    expect(availability.warnings.length).toBeGreaterThan(0);
    // Structured needs next to the texts, so UIs show document names instead of keys.
    expect(availability.warningNeeds).toContainEqual(expect.objectContaining({ kind: 'artifact' }));
    expect(availability.warnings.join(' ')).toContain('is recommended');
    expect(availability.missingNeeds).toEqual([]);
  });

  it('words unmet hard needs as needed, not recommended', () => {
    const availability = stepAvailability(findInitiativeStep('prd')!, snapshot({ hasIntent: false }));

    expect(availability.missingNeeds).toEqual([{ kind: 'intent' }]);
    expect(availability.missing).toEqual(['The initiative needs an intent.']);
  });

  it('needs an intent', () => {
    expect(stepAvailability(findInitiativeStep('prd')!, snapshot({ hasIntent: false })).available).toBe(false);
  });
});

describe('whatsNext', () => {
  it('starts with the intent', () => {
    expect(whatsNext(snapshot({ hasIntent: false }))[0].title).toBe('Describe the intent');
  });

  it('recommends the contracts of the project path, then slicing', () => {
    const steps = whatsNext(snapshot()).map((action) => action.step);

    expect(steps).toEqual(['forge-idea', 'prd', 'architecture', 'slice-epics']);
    expect(whatsNext(snapshot({ path: 'session' })).map((action) => action.step)).toEqual(['slice-epics']);
  });

  it('walks epics through refine, incept, transfer, build and retrospective', () => {
    const base = { id: 'e1', key: 'E1', title: 'Epic', status: 'draft' as const, hasRetrospective: false };

    expect(whatsNext(snapshot({ epics: [{ ...base, refined: false, items: [] }] }))[0].step).toBe('refine-epic');
    expect(whatsNext(snapshot({ epics: [{ ...base, refined: true, items: [] }] }))[0].step).toBe('incept-stories');
    expect(
      whatsNext(snapshot({ epics: [{ ...base, refined: true, items: [{ status: 'draft', transferred: false }] }] }))[0]
        .kind,
    ).toBe('transfer');
    expect(
      whatsNext(
        snapshot({ epics: [{ ...base, refined: true, items: [{ status: 'in-progress', transferred: true }] }] }),
      )[0].kind,
    ).toBe('build');
    expect(
      whatsNext(snapshot({ epics: [{ ...base, refined: true, items: [{ status: 'done', transferred: true }] }] }))[0]
        .step,
    ).toBe('retrospective');
  });

  it('puts open proposals and findings first', () => {
    const actions = whatsNext(snapshot({ openProposals: 1, openFindings: 2 }));

    expect(actions.slice(0, 2).map((action) => action.kind)).toEqual(['proposals', 'findings']);
  });
});
