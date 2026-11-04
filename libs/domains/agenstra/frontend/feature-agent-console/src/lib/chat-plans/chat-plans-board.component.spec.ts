import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AgentsFacade,
  ChatPlansFacade,
  ClientsFacade,
  ContainerSocketFacade,
  type ChatPlanResponse,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';

jest.mock('../knowledge/knowledge-editor/knowledge-editor.component', () => {
  const { Component, EventEmitter, Input, Output } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-knowledge-editor', standalone: true, template: '' })
  class KnowledgeEditorComponent {
    @Input() markdown: unknown;
    @Output() markdownChange = new EventEmitter<string>();
    @Output() blurred = new EventEmitter<void>();
    /** Content not yet emitted (debounced in the real editor); `null`: the input value. */
    pending: string | null = null;

    getMarkdown(): string | null {
      return this.pending ?? (this.markdown as string);
    }
  }

  return { KnowledgeEditorComponent };
});

jest.mock('marked', () => ({ marked: { parse: (markdown: string) => `<p>${markdown}</p>` } }));

import { KnowledgeEditorComponent } from '../knowledge/knowledge-editor/knowledge-editor.component';

import { ChatPlansBoardComponent } from './chat-plans-board.component';

function plan(overrides: Partial<ChatPlanResponse> = {}): ChatPlanResponse {
  return {
    id: 'p1',
    clientId: 'client-1',
    agentId: 'agent-1',
    chatId: 'chat-1',
    status: 'ready',
    phase: 'ready',
    sourcePrompt: 'Build login',
    planMarkdown: '# Plan',
    summary: 'Login plan',
    contextInjection: null,
    model: 'openai/gpt-5',
    resumeSessionSuffix: '-plan-p1',
    completionSignalSeen: true,
    failureCode: null,
    failureMessage: null,
    createdByUserId: 'u1',
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: null,
    executionStartedAt: null,
    lastEditedAt: null,
    lastEditedByUserId: null,
    editable: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

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

function autoMock(base: Record<string, unknown> = {}): unknown {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? callableStream() : jest.fn(() => NEVER);

      return target[prop];
    },
  });
}

describe('ChatPlansBoardComponent', () => {
  let fixture: ComponentFixture<ChatPlansBoardComponent>;
  let plansFacade: Record<string, jest.Mock> & {
    selectedPlan$: BehaviorSubject<ChatPlanResponse | null>;
    conflict$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<string | null>;
  };
  let socketsFacade: Record<string, jest.Mock>;

  async function create(queryParams: Record<string, string>, opened: ChatPlanResponse | null = null): Promise<void> {
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams),
        paramMap: convertToParamMap({ clientId: 'client-1' }),
      },
      paramMap: new BehaviorSubject(convertToParamMap({ clientId: 'client-1' })),
      queryParamMap: new BehaviorSubject(convertToParamMap(queryParams)),
      parent: null,
    };

    plansFacade = autoMock({
      plans$: new BehaviorSubject(opened ? [opened] : []),
      total$: new BehaviorSubject(opened ? 1 : 0),
      loading$: new BehaviorSubject(false),
      selectedPlan$: new BehaviorSubject(opened),
      selectedPlanLoading$: new BehaviorSubject(false),
      saving$: new BehaviorSubject(false),
      error$: new BehaviorSubject<string | null>(null),
      conflict$: new BehaviorSubject(false),
      activityLoadingPlanId$: new BehaviorSubject(null),
      activity$: jest.fn(() => of([])),
      load: jest.fn(),
      open: jest.fn(),
      close: jest.fn(),
      update: jest.fn(),
      loadActivity: jest.fn(),
      clearError: jest.fn(),
    }) as typeof plansFacade;
    socketsFacade = autoMock({
      connected$: new BehaviorSubject(true),
      setClient: jest.fn(),
      refineChatPlan: jest.fn(),
    }) as Record<string, jest.Mock>;

    await TestBed.configureTestingModule({
      imports: [ChatPlansBoardComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: ChatPlansFacade, useValue: plansFacade },
        {
          provide: ClientsFacade,
          useValue: autoMock({
            clients$: new BehaviorSubject([{ id: 'client-1', name: 'Workspace' }]),
            activeClientId$: new BehaviorSubject('client-1'),
          }),
        },
        {
          provide: AgentsFacade,
          useValue: autoMock({
            getClientAgents$: jest.fn(() =>
              of([
                { id: 'agent-1', name: 'Primary' },
                { id: 'agent-2', name: 'Secondary' },
              ]),
            ),
          }),
        },
        { provide: ContainerSocketFacade, useValue: socketsFacade },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatPlansBoardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);

  afterEach(() => TestBed.resetTestingModule());

  it('selects the first environment when none is given (plans are agent specific)', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({});

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ agentId: 'agent-1' }), replaceUrl: true }),
    );
    expect(plansFacade.load).not.toHaveBeenCalled();
    navigate.mockRestore();
  });

  it('loads the first page of the selected environment and searches server-side', async () => {
    await create({ agentId: 'agent-2' });

    expect(plansFacade.load).toHaveBeenLastCalledWith('client-1', 'agent-2', {
      search: '',
      state: null,
      limit: 25,
      offset: 0,
    });

    fixture.componentInstance.onSearchChange('login');
    fixture.detectChanges();
    // Debounced while typing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    fixture.detectChanges();

    expect(plansFacade.load).toHaveBeenLastCalledWith(
      'client-1',
      'agent-2',
      expect.objectContaining({ search: 'login' }),
    );
  });

  it('edits a plan that was not executed yet and saves against the edited version', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    expect(plansFacade.open).toHaveBeenCalledWith('client-1', 'agent-1', 'p1');
    expect(query('[data-testid="chat-plan-editor"]')).not.toBeNull();
    expect(query('[data-testid="chat-plan-readonly"]')).toBeNull();

    const component = fixture.componentInstance;

    expect(component.canSave()).toBe(false);
    component.draftMarkdown.set('# Plan\n- edited step');
    fixture.detectChanges();
    expect(component.dirty()).toBe(true);
    expect(component.canSave()).toBe(true);
    // The agent refines the saved plan: unsaved edits block refine.
    component.refineMessage.set('Add tests');
    expect(component.canRefine()).toBe(false);

    component.onSave();

    expect(plansFacade.update).toHaveBeenCalledWith('client-1', 'agent-1', 'p1', {
      planMarkdown: '# Plan\n- edited step',
      summary: 'Login plan',
      expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
    });
  });

  it('saves the latest editor content even before the editor emitted it (debounced)', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    const editor = fixture.debugElement.query((el) => el.componentInstance instanceof KnowledgeEditorComponent)
      .componentInstance as KnowledgeEditorComponent & { pending: string | null };

    editor.pending = '# Plan\n- typed just now';
    fixture.componentInstance.onSave();

    expect(plansFacade.update).toHaveBeenCalledWith(
      'client-1',
      'agent-1',
      'p1',
      expect.objectContaining({ planMarkdown: '# Plan\n- typed just now' }),
    );
  });

  it('adopts the own saved version as base while the user keeps editing (no conflict warning)', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    const component = fixture.componentInstance;

    component.draftMarkdown.set('# Saved');
    fixture.detectChanges();
    component.onSave();
    // User keeps typing, then the save response arrives.
    component.draftMarkdown.set('# Saved and more');
    plansFacade.selectedPlan$.next(plan({ planMarkdown: '# Saved', updatedAt: '2026-11-01T12:00:00.000Z' }));
    fixture.detectChanges();

    expect(component.draftMarkdown()).toBe('# Saved and more');
    expect(component.changedWhileEditing()).toBe(false);
    expect(component.draftBaseUpdatedAt()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('keeps unsaved edits when the plan changes meanwhile and warns about it', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    const component = fixture.componentInstance;

    component.draftMarkdown.set('# Mine');
    plansFacade.selectedPlan$.next(plan({ planMarkdown: '# Agent', updatedAt: '2026-11-01T11:00:00.000Z' }));
    fixture.detectChanges();

    expect(component.draftMarkdown()).toBe('# Mine');
    expect(component.changedWhileEditing()).toBe(true);

    component.onDiscard();
    expect(component.draftMarkdown()).toBe('# Agent');
    expect(component.dirty()).toBe(false);
  });

  it('shows executed plans read-only without editor, save or refine', async () => {
    await create(
      { agentId: 'agent-1', openPlanId: 'p1' },
      plan({ status: 'executed', editable: false, executionStartedAt: '2026-11-01T11:00:00.000Z' }),
    );

    expect(query('[data-testid="chat-plan-readonly"]')).not.toBeNull();
    expect(query('[data-testid="chat-plan-editor"]')).toBeNull();
    expect(query('[data-testid="chat-plan-save"]')).toBeNull();
    expect(query('[data-testid="chat-plan-refine-input"]')).toBeNull();
    expect(query('[data-testid="chat-plan-markdown"]')?.textContent).toContain('# Plan');

    fixture.componentInstance.draftMarkdown.set('# sneaky');
    fixture.componentInstance.onSave();
    expect(plansFacade.update).not.toHaveBeenCalled();
  });

  it('locks the content while the agent drafts the plan', async () => {
    await create(
      { agentId: 'agent-1', openPlanId: 'p1' },
      plan({ status: 'refining', phase: 'refine', editable: false }),
    );

    expect(query('[data-testid="chat-plan-drafting"]')).not.toBeNull();
    expect(query('[data-testid="chat-plan-editor"]')).toBeNull();
  });

  it('refines a ready plan with the agent over the clients socket', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    const component = fixture.componentInstance;

    component.refineMessage.set('  Add tests  ');
    component.onRefine();

    expect(socketsFacade.refineChatPlan).toHaveBeenCalledWith('agent-1', 'p1', 'Add tests', expect.any(String));
    expect(component.refineMessage()).toBe('');
  });

  it('shows the plan context reference (plan:<short sha>)', async () => {
    await create(
      { agentId: 'agent-1', openPlanId: 'p1' },
      plan({ shas: { short: 'abcdef0', long: 'abcdef0'.padEnd(40, '1') } }),
    );

    expect(query('[data-testid="chat-plan-ref"]')?.textContent?.trim()).toBe('plan:abcdef0');
  });

  it('offers to load the latest version after a refused save', async () => {
    await create({ agentId: 'agent-1', openPlanId: 'p1' }, plan());

    plansFacade.error$.next('The plan changed since you opened it; reload it before saving.');
    plansFacade.conflict$.next(true);
    fixture.detectChanges();

    expect(query('[data-testid="chat-plan-reload"]')).not.toBeNull();
  });
});
