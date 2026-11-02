import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ProjectMilestonesFacade,
  ProjectMilestonesService,
  ProjectTicketsFacade,
  ProjectTicketsService,
  ProjectTimeEntriesFacade,
  type ProjectTicketBoardRow,
  type ProjectTicketResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { Actions } from '@ngrx/effects';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

jest.mock('../project-ticket-editor/project-ticket-editor.component', () => {
  const { Component, EventEmitter, Input, Output } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-project-ticket-editor', standalone: true, template: '' })
  class ProjectTicketEditorComponent {
    @Input() markdown: unknown;
    @Input() readonly: unknown;
    @Output() markdownChange = new EventEmitter<string>();
    @Output() blurred = new EventEmitter<void>();
  }

  return { ProjectTicketEditorComponent };
});

import {
  buildProjectTicketTableRows,
  projectTicketHiddenMatchCount,
  projectTicketHiddenMatchLabel,
  projectTicketTableColumns,
} from './project-board-table';
import { ProjectBoardComponent } from './project-board.component';
import { PROJECT_BOARD_VIEW_STORAGE_KEY, projectBoardViewState } from './project-board-view';

function ticket(id: string, title: string, overrides: Partial<ProjectTicketResponse> = {}): ProjectTicketResponse {
  return {
    id,
    projectId: 'p-1',
    title,
    status: 'todo',
    priority: 'medium',
    shas: { short: `s${id}`, long: `long-${id}` },
    tasks: { open: 0, done: 0 } as unknown as ProjectTicketResponse['tasks'],
    locked: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Facade / service stand-in: listed members as given, any other `$` stream never emits, methods are spies. */
function autoMock<T extends object>(base: Record<string, unknown>): T {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? NEVER : jest.fn(() => NEVER);

      return target[prop];
    },
  }) as T;
}

describe('ProjectBoardComponent (Table | Lanes)', () => {
  // Headroom for the lanes view (one data table per lane + CDK drag lists) on a busy machine; alone each spec takes
  // well under 1.5 s, so this only guards against the 5 s default under parallel load.
  jest.setTimeout(30000);

  let fixture: ComponentFixture<ProjectBoardComponent>;
  let service: { update: jest.Mock; delete: jest.Mock; list: jest.Mock };
  let facade: Record<string, unknown> & { loadTickets: jest.Mock; update: jest.Mock };
  const tickets = [ticket('a', 'Alpha'), ticket('b', 'Bravo', { status: 'draft' }), ticket('c', 'Charlie')];
  const lanes: Record<string, ProjectTicketBoardRow[]> = {
    draft: [{ ticket: tickets[1], depth: 0 }],
    todo: [
      { ticket: tickets[0], depth: 0 },
      { ticket: tickets[2], depth: 0 },
    ],
    in_progress: [],
    prototype: [],
    done: [],
  };

  async function create(queryParams: Record<string, string> = {}, isAdmin = true): Promise<void> {
    facade = {
      tickets$: new BehaviorSubject(tickets),
      boardRowsByStatus$: new BehaviorSubject(lanes),
      loadingList$: new BehaviorSubject(false),
      detail$: new BehaviorSubject(null),
      saving$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      loadTickets: jest.fn(),
      update: jest.fn(),
    };
    service = {
      list: jest.fn(() => of([])),
      update: jest.fn((_p: string, id: string) =>
        id === 'c' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(tickets[0]),
      ),
      delete: jest.fn(() => of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [ProjectBoardComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) }, queryParamMap: NEVER },
        },
        { provide: ProjectTicketsFacade, useValue: autoMock(facade) },
        { provide: ProjectTicketsService, useValue: autoMock(service) },
        {
          provide: ProjectMilestonesFacade,
          useValue: autoMock({ milestones$: new BehaviorSubject([]), load: jest.fn() }),
        },
        { provide: ProjectMilestonesService, useValue: autoMock({ list: jest.fn(() => of([])) }) },
        {
          provide: ProjectTimeEntriesFacade,
          useValue: autoMock({
            ticketEntries$: new BehaviorSubject([]),
            ticketLoading$: new BehaviorSubject(false),
            ticketError$: new BehaviorSubject(null),
            saving$: new BehaviorSubject(false),
            error$: new BehaviorSubject(null),
          }),
        },
        { provide: Actions, useValue: NEVER },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectBoardComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.componentRef.setInput('isAdmin', isAdmin);
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('shows the table by default (no URL, nothing stored) with the readable state and short hash', async () => {
    await create();

    expect(fixture.componentInstance.view()).toBe('table');
    expect(query('[data-testid="project-board-table"]')).not.toBeNull();
    expect(query('[data-testid="project-board-lanes"]')).toBeNull();
    expect(query('[data-testid="project-board-view-table"] button')?.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('sa');
    expect(fixture.nativeElement.textContent).toContain('Alpha');
  });

  it('switches to the lanes, remembers the view per user and writes view= into the URL', async () => {
    await create();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.setView('lanes');
    fixture.detectChanges();

    expect(query('[data-testid="project-board-lanes"]')).not.toBeNull();
    expect(query('[data-testid="project-board-table"]')).toBeNull();
    expect(localStorage.getItem(PROJECT_BOARD_VIEW_STORAGE_KEY)).toBe('lanes');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: 'lanes' }, queryParamsHandling: 'merge' }),
    );
  });

  it('opens in the stored view, and the URL wins over the stored one', async () => {
    localStorage.setItem(PROJECT_BOARD_VIEW_STORAGE_KEY, 'lanes');
    await create();
    expect(fixture.componentInstance.view()).toBe('lanes');
    expect(query('[data-testid="project-board-lanes"]')).not.toBeNull();
    TestBed.resetTestingModule();

    await create({ view: 'table' });
    expect(fixture.componentInstance.view()).toBe('table');
    expect(localStorage.getItem(PROJECT_BOARD_VIEW_STORAGE_KEY)).toBe('table');
  });

  it('bulk status change reports every ticket, including a denied (403) one, and reloads the board', async () => {
    await create();
    const component = fixture.componentInstance;

    component.selectedTicketIds.set(['a', 'c']);
    component.onBulkStatus({ target: { value: 'done' } } as unknown as Event);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.update).toHaveBeenCalledWith('p-1', 'a', { status: 'done' });
    expect(service.update).toHaveBeenCalledWith('p-1', 'c', { status: 'done' });
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('Charlie');
    expect(component.selectedTicketIds()).toEqual(['c']);
    expect(facade.loadTickets).toHaveBeenCalledTimes(2);
  });

  it('"and n more" counts closed matches and widens the table to all statuses on click', async () => {
    await create();
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;

    expect(component.hiddenMatchCount()).toBe(0);
    (TestBed.inject(ProjectTicketsFacade).tickets$ as BehaviorSubject<ProjectTicketResponse[]>).next([
      ...tickets,
      ticket('z', 'Alpha closed', { status: 'closed' }),
    ]);
    component.ticketSearch.set('alpha');
    fixture.detectChanges();
    expect(component.hiddenMatchCount()).toBe(1);

    const more = query('[data-testid="project-board-more-matches"] button') as HTMLButtonElement;

    expect(more.textContent).toContain('and 1 more');
    more.click();
    fixture.detectChanges();
    expect(component.ticketStatusFilter()).toBe('all');
    expect(component.hiddenMatchCount()).toBe(0);
    expect(query('[data-testid="project-board-more-matches"]')).toBeNull();
  });

  it('row menu mirrors the card: move between lanes and delete only for admins on unlocked tickets', async () => {
    await create({}, false);
    const row = { ticket: tickets[0], depth: 0 };

    expect(fixture.componentInstance.ticketRowMenu(row).map((item) => item.id)).toEqual(['open', 'copy-id']);
    fixture.componentRef.setInput('isAdmin', true);
    expect(fixture.componentInstance.ticketRowMenu(row).map((item) => item.id)).toContain('status:done');
    expect(
      fixture.componentInstance.ticketRowMenu({ ticket: { ...tickets[0], locked: true }, depth: 0 }).map((i) => i.id),
    ).toEqual(['open', 'copy-id']);
  });
  const laneTable = (status: string): HTMLElement =>
    query(`[data-testid="project-board-lane-table"][data-lane="${status}"]`) as HTMLElement;
  const laneRows = (status: string): HTMLElement[] =>
    Array.from(laneTable(status).querySelectorAll<HTMLElement>('tr.fpc-data-table__row'));
  const laneBody = (status: string): HTMLElement =>
    laneTable(status).querySelector('[data-testid="fpc-data-table-scroller"]') as HTMLElement;
  const dragEvent = (target: HTMLElement, type: string): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    return event;
  };

  it('renders one stacked data table per lane (state · ticket with hash · priority, ⋮ menu), no card list', async () => {
    await create({ view: 'lanes' });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="project-board-lane-table"]').length).toBe(5);
    expect(laneTable('todo').classList).toContain('fpc-data-table--stacked');
    expect(laneRows('todo')).toHaveLength(2);
    expect(laneRows('todo')[0].textContent).toContain('sa');
    expect(laneRows('todo')[0].textContent).toContain('Alpha');
    expect(laneRows('todo')[0].querySelector('[data-testid="fpc-data-table-state"]')).not.toBeNull();
    expect(laneRows('todo')[0].querySelector('[data-testid="fpc-data-table-row-more"]')).not.toBeNull();
    expect(query('[data-testid="project-board-lane-card"]')).toBeNull();
    // Lane bodies: no fixed-height virtual viewport (it scrolled even when the cards fit); the table fills the lane
    // (flex-grow-1 + min-h-0) and only its body scrolls when the cards overflow.
    expect(query('cdk-virtual-scroll-viewport')).toBeNull();
    expect(laneTable('todo').classList).toContain('flex-grow-1');
    expect(laneTable('todo').classList).toContain('min-h-0');
    expect(laneBody('todo').style.height).toBe('');
  });

  it('drops a card on another lane → facade update with the lane status (admins)', async () => {
    await create({ view: 'lanes' });

    dragEvent(laneRows('todo')[0], 'dragstart');
    expect(dragEvent(laneBody('done'), 'dragover').defaultPrevented).toBe(true);
    dragEvent(laneBody('done'), 'drop');

    expect(facade.update).toHaveBeenCalledTimes(1);
    expect(facade.update).toHaveBeenCalledWith('p-1', 'a', { status: 'done' });
  });

  it('locked tickets and non-admins cannot drag cards', async () => {
    const original = lanes['todo'][1];

    lanes['todo'][1] = { ticket: { ...tickets[2], locked: true }, depth: 0 };
    try {
      await create({ view: 'lanes' });
      expect(laneRows('todo').map((row) => row.getAttribute('draggable'))).toEqual(['true', null]);

      expect(dragEvent(laneRows('todo')[1], 'dragstart').defaultPrevented).toBe(true);
      expect(dragEvent(laneBody('done'), 'dragover').defaultPrevented).toBe(false);
      dragEvent(laneBody('done'), 'drop');
      expect(facade.update).not.toHaveBeenCalled();
      TestBed.resetTestingModule();

      await create({ view: 'lanes' }, false);
      expect(laneRows('todo').map((row) => row.getAttribute('draggable'))).toEqual([null, null]);
      expect(laneRows('draft')[0].getAttribute('draggable')).toBeNull();
    } finally {
      lanes['todo'][1] = original;
    }
  });

  it('a drag does not open the ticket; a plain click does', async () => {
    await create({ view: 'lanes' });
    const open = jest.spyOn(fixture.componentInstance, 'openTicketDetailFlow').mockImplementation(() => undefined);

    dragEvent(laneRows('todo')[0], 'dragstart');
    dragEvent(laneRows('todo')[0], 'dragend');
    laneRows('todo')[0].click();
    expect(open).not.toHaveBeenCalled();

    laneRows('draft')[0].click();
    expect(open).toHaveBeenCalledWith('b');
  });
});

describe('projectTicketHiddenMatchCount', () => {
  const columns = projectTicketTableColumns(() => '');
  const list = [
    ticket('a', 'Invoice export'),
    ticket('c', 'Invoice closed', { status: 'closed' }),
    ticket('x', 'Other'),
  ];

  it('is 0 without search / priority and counts matches outside the visible rows', () => {
    expect(projectTicketHiddenMatchCount(list, { priority: '', search: '' }, new Set(['a']), columns)).toBe(0);
    expect(projectTicketHiddenMatchCount(list, { priority: '', search: 'invoice' }, new Set(['a']), columns)).toBe(1);
    expect(projectTicketHiddenMatchLabel(1)).toBe('and 1 more');
    expect(projectTicketHiddenMatchLabel(3)).toBe('and 3 more');
  });
});

describe('buildProjectTicketTableRows', () => {
  const columns = projectTicketTableColumns(() => '');

  it('lists board statuses by default, subtasks under their parent, and narrows by priority / search', () => {
    const list = [
      ticket('r', 'Root', { status: 'todo' }),
      ticket('k', 'Kid', { status: 'done', parentId: 'r', priority: 'high' }),
      ticket('x', 'Closed one', { status: 'closed' }),
    ];
    const rows = buildProjectTicketTableRows(list, { status: 'board', priority: '', search: '', sort: null }, columns);

    expect(rows.map((row) => [row.ticket.id, row.depth])).toEqual([
      ['r', 0],
      ['k', 1],
    ]);
    expect(
      buildProjectTicketTableRows(list, { status: 'all', priority: 'high', search: '', sort: null }, columns).map(
        (row) => row.ticket.id,
      ),
    ).toEqual(['k']);
    expect(
      buildProjectTicketTableRows(list, { status: 'all', priority: '', search: 'closed', sort: null }, columns).map(
        (row) => row.ticket.id,
      ),
    ).toEqual(['x']);
  });
});

describe('projectBoardViewState', () => {
  it('ignores unknown view values', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ view: 'grid' }) }, queryParamMap: NEVER },
        },
      ],
    });
    localStorage.clear();

    expect(TestBed.runInInjectionContext(() => projectBoardViewState()).view()).toBe('table');
    TestBed.resetTestingModule();
  });
});
