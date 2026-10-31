import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AgentsFacade,
  AgentsService,
  ChatTimelineFacade,
  ClientsFacade,
  ClientsService,
  ContainerSocketFacade,
  KnowledgeFacade,
  KnowledgeService,
  TicketAutomationFacade,
  TicketsBoardSocketFacade,
  TicketsFacade,
  TicketsService,
  VcsService,
  type TicketBoardRow,
  type TicketResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions } from '@ngrx/effects';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';

jest.mock('./ticket-editor/ticket-editor.component', () => {
  const { Component, EventEmitter, Input, Output } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-ticket-editor', standalone: true, template: '' })
  class TicketEditorComponent {
    @Input() markdown: unknown;
    @Output() markdownChange = new EventEmitter<string>();
    @Output() blurred = new EventEmitter<void>();
  }

  return { TicketEditorComponent };
});

import { TICKET_BOARD_VIEW_STORAGE_KEY, ticketBoardViewState } from './ticket-board-view';
import { filterTicketLaneRows } from './ticket-table';
import { TicketsBoardComponent } from './tickets-board.component';

function ticket(id: string, title: string, overrides: Partial<TicketResponseDto> = {}): TicketResponseDto {
  return {
    id,
    clientId: 'client-1',
    title,
    status: 'todo',
    priority: 'medium',
    shas: { short: `s${id}`, long: `long-${id}` },
    automationEligible: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  } as TicketResponseDto;
}

/** A never-emitting stream that can also be called (`getClientAgents$(id)`-style selectors). */
function callableStream(): unknown {
  const stream = new Subject<never>();
  const fn = jest.fn(() => new Subject<never>());

  return Object.assign(fn, {
    subscribe: stream.subscribe.bind(stream),
    pipe: stream.pipe.bind(stream),
    lift: stream.lift.bind(stream),
    [Symbol.observable ?? '@@observable']: () => stream,
  });
}

/** Facade / service stand-in: listed members as given, any other `$` stream never emits, methods are spies. */
function autoMock(base: Record<string, unknown> = {}): unknown {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? callableStream() : jest.fn(() => NEVER);

      return target[prop];
    },
  });
}

describe('TicketsBoardComponent (Table | Lanes)', () => {
  let fixture: ComponentFixture<TicketsBoardComponent>;
  const tickets = [ticket('a', 'Alpha'), ticket('b', 'Bravo', { status: 'draft', priority: 'high' })];
  const lanes: Record<string, TicketBoardRow[]> = {
    draft: [{ ticket: tickets[1], depth: 0 }],
    todo: [{ ticket: tickets[0], depth: 0 }],
    in_progress: [],
    prototype: [],
  };

  async function create(queryParams: Record<string, string> = {}): Promise<void> {
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams),
        paramMap: convertToParamMap({ clientId: 'client-1' }),
      },
      paramMap: new BehaviorSubject(convertToParamMap({ clientId: 'client-1' })),
      queryParamMap: new BehaviorSubject(convertToParamMap(queryParams)),
      parent: null,
    };

    await TestBed.configureTestingModule({
      imports: [TicketsBoardComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        {
          provide: TicketsFacade,
          useValue: autoMock({
            tickets$: new BehaviorSubject(tickets),
            ticketsBoardRowsByStatus$: new BehaviorSubject(lanes),
            loadingList$: new BehaviorSubject(false),
            error$: new BehaviorSubject(null),
            detail$: new BehaviorSubject(null),
            detailBreadcrumb$: new BehaviorSubject([]),
          }),
        },
        {
          provide: ClientsFacade,
          useValue: autoMock({ clients$: new BehaviorSubject([]), activeClientId$: new BehaviorSubject('client-1') }),
        },
        { provide: ClientsService, useValue: autoMock() },
        { provide: AgentsFacade, useValue: autoMock() },
        { provide: AgentsService, useValue: autoMock({ listAgents: jest.fn(() => of([])) }) },
        { provide: KnowledgeFacade, useValue: autoMock() },
        { provide: KnowledgeService, useValue: autoMock() },
        { provide: TicketsService, useValue: autoMock() },
        { provide: ContainerSocketFacade, useValue: autoMock() },
        { provide: ChatTimelineFacade, useValue: autoMock() },
        { provide: TicketsBoardSocketFacade, useValue: autoMock() },
        { provide: TicketAutomationFacade, useValue: autoMock() },
        { provide: Actions, useValue: NEVER },
        { provide: VcsService, useValue: autoMock() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TicketsBoardComponent);
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('shows the infinite-scroll table by default', async () => {
    await create();

    expect(fixture.componentInstance.view()).toBe('table');
    expect(query('[data-testid="tickets-table"]')).not.toBeNull();
    expect(query('[data-testid="tickets-lanes"]')).toBeNull();
    expect(query('[data-testid="tickets-view-table"] button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to the lanes (swimlanes with cards), remembers the view and writes view= into the URL', async () => {
    await create();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.setView('lanes');
    fixture.detectChanges();

    expect(query('[data-testid="tickets-table"]')).toBeNull();
    expect(query('[data-testid="tickets-lanes"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('fpc-board-lane').length).toBe(4);
    expect(localStorage.getItem(TICKET_BOARD_VIEW_STORAGE_KEY)).toBe('lanes');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: 'lanes' }, queryParamsHandling: 'merge' }),
    );
  });

  it('opens in the stored view; the URL wins over the stored one', async () => {
    localStorage.setItem(TICKET_BOARD_VIEW_STORAGE_KEY, 'lanes');
    await create();
    expect(query('[data-testid="tickets-lanes"]')).not.toBeNull();
    TestBed.resetTestingModule();

    await create({ view: 'table' });
    expect(fixture.componentInstance.view()).toBe('table');
    expect(localStorage.getItem(TICKET_BOARD_VIEW_STORAGE_KEY)).toBe('table');
  });

  it('the board search and priority filter narrow the lanes too', async () => {
    await create({ view: 'lanes' });
    const component = fixture.componentInstance;

    component.ticketPriorityFilter.set('high');
    expect(component.filteredLaneRows(lanes['draft']).length).toBe(1);
    expect(component.filteredLaneRows(lanes['todo']).length).toBe(0);
    component.ticketPriorityFilter.set('');
    component.ticketSearch.set('alpha');
    expect(component.filteredLaneRows(lanes['todo']).map((row) => row.ticket.id)).toEqual(['a']);
  });

  const laneTable = (status: string): HTMLElement =>
    query(`[data-testid="tickets-lane-table"][data-lane="${status}"]`) as HTMLElement;
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

    const tables = fixture.nativeElement.querySelectorAll('[data-testid="tickets-lane-table"]');

    expect(tables.length).toBe(4);
    expect(laneTable('todo').classList).toContain('fpc-data-table--stacked');
    expect(laneRows('todo')).toHaveLength(1);
    expect(laneRows('todo')[0].textContent).toContain('sa');
    expect(laneRows('todo')[0].textContent).toContain('Alpha');
    expect(laneRows('todo')[0].querySelector('[data-testid="fpc-data-table-state"]')).not.toBeNull();
    expect(laneRows('todo')[0].querySelector('[data-testid="fpc-data-table-row-more"]')).not.toBeNull();
    expect(laneRows('in_progress')).toHaveLength(0);
    expect(query('[data-testid="tickets-lane-card"]')).toBeNull();
    // Lane bodies: no fixed-height virtual viewport (it scrolled even when the cards fit); the table fills the lane
    // (flex-grow-1 + min-h-0) and only its body scrolls when the cards overflow.
    expect(query('cdk-virtual-scroll-viewport')).toBeNull();
    expect(laneTable('todo').classList).toContain('flex-grow-1');
    expect(laneTable('todo').classList).toContain('min-h-0');
    expect(laneBody('todo').style.height).toBe('');
  });

  it('drops a card on another lane → status update via the facade (not on the own lane)', async () => {
    await create({ view: 'lanes' });
    const facade = TestBed.inject(TicketsFacade) as unknown as { update: jest.Mock };

    expect(laneRows('todo')[0].getAttribute('draggable')).toBe('true');

    dragEvent(laneRows('todo')[0], 'dragstart');
    expect(dragEvent(laneBody('todo'), 'dragover').defaultPrevented).toBe(false);
    expect(dragEvent(laneBody('in_progress'), 'dragover').defaultPrevented).toBe(true);
    dragEvent(laneBody('in_progress'), 'drop');

    expect(facade.update).toHaveBeenCalledTimes(1);
    expect(facade.update).toHaveBeenCalledWith('a', { status: 'in_progress' });
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

describe('TicketsBoardComponent "and n more"', () => {
  it('counts search matches the view hides and widens the table to all statuses on click', async () => {
    const list = [
      ticket('a', 'Login bug'),
      ticket('d', 'Login done', { status: 'done' }),
      ticket('c', 'Login closed', { status: 'closed' }),
      ticket('x', 'Other'),
    ];

    await TestBed.configureTestingModule({
      imports: [TicketsBoardComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ clientId: 'client-1' }) },
            paramMap: new BehaviorSubject(convertToParamMap({ clientId: 'client-1' })),
            queryParamMap: new BehaviorSubject(convertToParamMap({})),
            parent: null,
          },
        },
        {
          provide: TicketsFacade,
          useValue: autoMock({
            tickets$: new BehaviorSubject(list),
            ticketsBoardRowsByStatus$: new BehaviorSubject({
              draft: [],
              todo: [
                { ticket: list[0], depth: 0 },
                { ticket: list[3], depth: 0 },
              ],
              in_progress: [],
              prototype: [],
            }),
            loadingList$: new BehaviorSubject(false),
            error$: new BehaviorSubject(null),
            detail$: new BehaviorSubject(null),
            detailBreadcrumb$: new BehaviorSubject([]),
          }),
        },
        {
          provide: ClientsFacade,
          useValue: autoMock({ clients$: new BehaviorSubject([]), activeClientId$: new BehaviorSubject('client-1') }),
        },
        ...[
          ClientsService,
          AgentsFacade,
          KnowledgeFacade,
          KnowledgeService,
          TicketsService,
          ContainerSocketFacade,
          ChatTimelineFacade,
          TicketsBoardSocketFacade,
          TicketAutomationFacade,
        ].map((token) => ({ provide: token, useValue: autoMock() })),
        { provide: AgentsService, useValue: autoMock({ listAgents: jest.fn(() => of([])) }) },
        { provide: Actions, useValue: NEVER },
        { provide: VcsService, useValue: autoMock() },
      ],
    }).compileComponents();
    localStorage.clear();
    const fixture = TestBed.createComponent(TicketsBoardComponent);
    const component = fixture.componentInstance;

    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    const more = () =>
      fixture.nativeElement.querySelector('[data-testid="tickets-more-matches"]') as HTMLElement | null;

    expect(component.hiddenMatchCount()).toBe(0);
    expect(more()).toBeNull();

    component.ticketSearch.set('login');
    fixture.detectChanges();
    expect(component.hiddenMatchCount()).toBe(2);
    expect(more()?.textContent).toContain('and 2 more');

    component.setView('lanes');
    fixture.detectChanges();
    expect(component.hiddenMatchCount()).toBe(2);

    (more()?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.view()).toBe('table');
    expect(component.ticketStatusFilter()).toBe('all');
    expect(component.ticketChips().map((chip) => chip.id)).toEqual(['status']);
    expect(component.hiddenMatchCount()).toBe(0);
    expect(more()).toBeNull();

    component.removeTicketChip(component.ticketChips()[0]);
    expect(component.ticketStatusFilter()).toBe('open');
    TestBed.resetTestingModule();
  });
});

describe('ticket lanes helpers', () => {
  it('filterTicketLaneRows keeps everything without a query', () => {
    const rows = [{ ticket: ticket('a', 'Alpha'), depth: 0 }];

    expect(filterTicketLaneRows(rows, { priority: '', search: '' })).toEqual(rows);
    expect(filterTicketLaneRows(rows, { priority: 'low', search: '' })).toEqual([]);
  });

  it('ticketBoardViewState ignores unknown view values', () => {
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

    expect(TestBed.runInInjectionContext(() => ticketBoardViewState()).view()).toBe('table');
    TestBed.resetTestingModule();
  });
});
