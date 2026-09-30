import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FpcBadgeComponent, FpcButtonComponent, FpcIconComponent } from '@forepath/shared/frontend/ui-components';

import type { AgentChatEventDisplayRow, AgentChatQuestionInteraction } from './agent-chat-event-display';
import { AgentChatEventPopoverDirective } from './agent-chat-event-popover.directive';
import { resolveAgentChatToolDisplay } from './agent-chat-tool-display';
import { buildChatRowEmbedView } from './agent-chat-tool-embed-view';
import { AgentChatToolEmbedComponent } from './agent-chat-tool-embed.component';
import { AgentChatTodosExpandCoordinator } from './agent-chat-todos-expand.coordinator';

export interface AgentChatQuestionReplyRequest {
  questionId: string;
  replyKind: AgentChatQuestionInteraction['replyKind'];
  sessionId?: string;
  /** Permission: once|always|reject. Question: selected option labels (or empty + reject). */
  answers?: string[];
  reject?: boolean;
}

@Component({
  selector: 'framework-agent-chat-event-row',
  standalone: true,
  imports: [
    NgClass,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcIconComponent,
    AgentChatEventPopoverDirective,
    AgentChatToolEmbedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './agent-chat-event-row.component.scss',
  template: `
    <div class="small mb-2">
      @if (toolEmbed(); as embed) {
        <div class="agent-chat-event-row__tool">
          <div class="d-flex align-items-center gap-2">
            <fpc-badge [color]="row().badgeColor" [pill]="true">{{ row().kindLabel }}</fpc-badge>
            <button
              type="button"
              class="agent-chat-event-row__tool-toggle flex-grow-1 min-w-0"
              [attr.aria-expanded]="toolEmbedOpen()"
              [attr.aria-controls]="toolEmbedBodyId"
              (click)="toggleToolEmbed()"
            >
              <span class="agent-chat-event-row__tool-heading">
                <fpc-icon class="agent-chat-event-row__tool-icon" [name]="toolDisplay().icon" size="sm" />
                <span class="agent-chat-event-row__tool-name">{{ toolDisplay().label }}</span>
                @if (row().toolPair) {
                  <span
                    class="agent-chat-event-row__detail-icons d-inline-flex align-items-center gap-1"
                    (click)="stopHeaderControlEvent($event)"
                    (keydown)="stopHeaderControlEvent($event)"
                  >
                    @if (hasToolPairCallDetail()) {
                      <span
                        class="agent-chat-event-row__info-icon text-body-secondary"
                        [frameworkAgentChatEventPopover]="toolInvocationPopoverTitle"
                        [frameworkAgentChatEventPopoverContent]="toolPairCallDetailContent()"
                        tabindex="0"
                        role="button"
                        [attr.aria-label]="toolInvocationAriaLabel()"
                      >
                        <i class="bi bi-terminal" aria-hidden="true"></i>
                      </span>
                    }
                    @if (hasToolPairResultDetail()) {
                      <span
                        class="agent-chat-event-row__info-icon text-body-secondary"
                        [frameworkAgentChatEventPopover]="toolResultPopoverTitle"
                        [frameworkAgentChatEventPopoverContent]="toolPairResultDetailContent()"
                        tabindex="0"
                        role="button"
                        [attr.aria-label]="toolResultAriaLabel()"
                      >
                        <i class="bi" [ngClass]="toolResultGlyphClass()" aria-hidden="true"></i>
                      </span>
                    } @else if (showToolPairAwaitingResult()) {
                      <span
                        class="agent-chat-event-row__info-icon text-body-secondary"
                        [frameworkAgentChatEventPopover]="toolAwaitingResultTitle"
                        [frameworkAgentChatEventPopoverContent]="toolAwaitingResultBody"
                        tabindex="0"
                        role="button"
                        [attr.aria-label]="toolAwaitingAriaLabel()"
                      >
                        <i class="bi bi-hourglass-split" aria-hidden="true"></i>
                      </span>
                    }
                  </span>
                }
              </span>
              <i
                class="bi agent-chat-event-row__tool-chevron"
                [ngClass]="toolEmbedOpen() ? 'bi-chevron-up' : 'bi-chevron-down'"
                aria-hidden="true"
              ></i>
            </button>
          </div>

          @if (toolEmbedOpen()) {
            <div class="agent-chat-event-row__tool-body" [id]="toolEmbedBodyId">
              <framework-agent-chat-tool-embed [embed]="embed" />
            </div>
          }
        </div>
      } @else {
        <div class="d-flex align-items-center gap-2">
          <fpc-badge [color]="row().badgeColor" [pill]="true">{{ row().kindLabel }}</fpc-badge>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-1 flex-wrap">
              @if (row().toolPair) {
                <fpc-icon class="agent-chat-event-row__tool-icon" [name]="toolDisplay().icon" size="sm" />
                <span class="agent-chat-event-row__tool-name">{{ toolDisplay().label }}</span>
                <span class="agent-chat-event-row__detail-icons d-inline-flex align-items-center gap-1">
                  @if (hasToolPairCallDetail()) {
                    <span
                      class="agent-chat-event-row__info-icon text-body-secondary"
                      [frameworkAgentChatEventPopover]="toolInvocationPopoverTitle"
                      [frameworkAgentChatEventPopoverContent]="toolPairCallDetailContent()"
                      tabindex="0"
                      role="button"
                      [attr.aria-label]="toolInvocationAriaLabel()"
                    >
                      <i class="bi bi-terminal" aria-hidden="true"></i>
                    </span>
                  }
                  @if (hasToolPairResultDetail()) {
                    <span
                      class="agent-chat-event-row__info-icon text-body-secondary"
                      [frameworkAgentChatEventPopover]="toolResultPopoverTitle"
                      [frameworkAgentChatEventPopoverContent]="toolPairResultDetailContent()"
                      tabindex="0"
                      role="button"
                      [attr.aria-label]="toolResultAriaLabel()"
                    >
                      <i class="bi" [ngClass]="toolResultGlyphClass()" aria-hidden="true"></i>
                    </span>
                  } @else if (showToolPairAwaitingResult()) {
                    <span
                      class="agent-chat-event-row__info-icon text-body-secondary"
                      [frameworkAgentChatEventPopover]="toolAwaitingResultTitle"
                      [frameworkAgentChatEventPopoverContent]="toolAwaitingResultBody"
                      tabindex="0"
                      role="button"
                      [attr.aria-label]="toolAwaitingAriaLabel()"
                    >
                      <i class="bi bi-hourglass-split" aria-hidden="true"></i>
                    </span>
                  }
                </span>
              } @else {
                <span class="fw-semibold">{{ row().summaryTitle }}</span>
                @if (showDetailPopover()) {
                  <span
                    class="agent-chat-event-row__info-icon text-body-secondary"
                    [frameworkAgentChatEventPopover]="row().summaryTitle"
                    [frameworkAgentChatEventPopoverContent]="popoverDetailContent()"
                    tabindex="0"
                    role="button"
                    [attr.aria-label]="detailAriaLabel()"
                  >
                    <i class="bi bi-info-circle" aria-hidden="true"></i>
                  </span>
                }
              }
            </div>
          </div>
        </div>

        @if (question(); as q) {
          <div class="agent-chat-event-row__question mt-2 ms-1">
            @if (q.prompt.trim()) {
              <div class="agent-chat-event-row__question-prompt text-body mb-2">{{ q.prompt }}</div>
            }
            @if (answered()) {
              <div class="text-muted" i18n="@@featureChat-questionAnswered">Answered</div>
            } @else {
              @if (q.options.length > 0) {
                <div class="d-flex flex-wrap gap-2">
                  @for (opt of q.options; track opt.id) {
                    <fpc-button
                      [variant]="isOptionSelected(opt.id) ? 'primary' : 'outline-secondary'"
                      size="sm"
                      [disabled]="replying()"
                      (clicked)="onOptionClick(opt)"
                    >
                      {{ opt.label }}
                    </fpc-button>
                  }
                </div>
              }
              @if (q.allowMultiple && q.options.length > 0) {
                <div class="d-flex flex-wrap gap-2 mt-2">
                  <fpc-button
                    variant="primary"
                    size="sm"
                    [disabled]="replying() || !hasMultiSelection()"
                    (clicked)="submitMulti()"
                  >
                    <span i18n="@@featureChat-questionSubmit">Submit</span>
                  </fpc-button>
                  <fpc-button
                    variant="outline-secondary"
                    size="sm"
                    [disabled]="replying()"
                    (clicked)="rejectQuestion()"
                  >
                    <span i18n="@@featureChat-questionReject">Reject</span>
                  </fpc-button>
                </div>
              } @else if (q.replyKind === 'question') {
                <div class="mt-2">
                  <fpc-button
                    variant="outline-secondary"
                    size="sm"
                    [disabled]="replying()"
                    (clicked)="rejectQuestion()"
                  >
                    <span i18n="@@featureChat-questionReject">Reject</span>
                  </fpc-button>
                </div>
              }
              @if (replyError()) {
                <div class="text-danger small mt-2">{{ replyError() }}</div>
              }
            }
          </div>
        } @else if (showSummaryBody()) {
          <div class="text-body-secondary mt-1 ms-1">{{ row().summaryBody }}</div>
        }
      }
    </div>
  `,
})
export class AgentChatEventRowComponent {
  private readonly todosExpand = inject(AgentChatTodosExpandCoordinator, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly row = input.required<AgentChatEventDisplayRow>();
  /**
   * Scopes todos auto-expand to one chat message / turn.
   * Only the latest Todos embed within the same scope opens by default.
   */
  readonly todosExpandScope = input('chat');
  readonly replyBusy = input(false);
  readonly replyFailedMessage = input<string | null>(null);
  readonly alreadyAnswered = input(false);

  readonly questionReply = output<AgentChatQuestionReplyRequest>();

  protected readonly toolInvocationPopoverTitle = $localize`:@@featureChat-agentToolInvocationPopover:Tool invocation`;
  protected readonly toolResultPopoverTitle = $localize`:@@featureChat-agentToolResultPopover:Tool result`;
  protected readonly toolAwaitingResultTitle = $localize`:@@featureChat-agentToolAwaitingResultTitle:Awaiting tool result`;
  protected readonly toolAwaitingResultBody = $localize`:@@featureChat-agentToolAwaitingResultBody:The tool has not returned a result yet.`;

  private readonly selectedOptionIds = signal<Set<string>>(new Set());
  /** Non-todos tools only. Todos open state is owned by `AgentChatTodosExpandCoordinator`. */
  private readonly toolEmbedOpenOverride = signal<boolean | undefined>(undefined);
  private claimedTodosKey: { scopeId: string; trackId: string } | null = null;
  private static nextToolEmbedBodyId = 0;
  protected readonly toolEmbedBodyId = `agent-chat-tool-embed-${AgentChatEventRowComponent.nextToolEmbedBodyId++}`;

  readonly question = computed(() => this.row().questionInteraction);
  readonly answered = computed(() => this.alreadyAnswered());
  readonly replying = computed(() => this.replyBusy());
  readonly replyError = computed(() => this.replyFailedMessage());

  readonly toolEmbed = computed(() => buildChatRowEmbedView(this.row()));

  readonly toolEmbedOpen = computed(() => {
    const embed = this.toolEmbed();

    if (embed?.kind === 'todos' && this.todosExpand) {
      return this.todosExpand.isOpen(this.todosExpandScope(), this.row().trackId);
    }

    const override = this.toolEmbedOpenOverride();

    if (override !== undefined) {
      return override;
    }

    return false;
  });

  readonly toolDisplay = computed(() => {
    const embed = this.toolEmbed();

    return resolveAgentChatToolDisplay(embed?.kind ?? this.row().toolName ?? this.row().summaryTitle);
  });

  constructor() {
    effect(() => {
      const kind = this.toolEmbed()?.kind;
      const trackId = this.row().trackId;
      const scopeId = this.todosExpandScope();
      const coordinator = this.todosExpand;

      if (!coordinator) {
        return;
      }

      if (kind === 'todos') {
        if (
          this.claimedTodosKey &&
          (this.claimedTodosKey.trackId !== trackId || this.claimedTodosKey.scopeId !== scopeId)
        ) {
          coordinator.release(this.claimedTodosKey.scopeId, this.claimedTodosKey.trackId);
          this.claimedTodosKey = null;
        }

        coordinator.claim(scopeId, trackId);
        this.claimedTodosKey = { scopeId, trackId };
      } else if (this.claimedTodosKey) {
        coordinator.release(this.claimedTodosKey.scopeId, this.claimedTodosKey.trackId);
        this.claimedTodosKey = null;
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.claimedTodosKey) {
        this.todosExpand?.release(this.claimedTodosKey.scopeId, this.claimedTodosKey.trackId);
        this.claimedTodosKey = null;
      }
    });
  }

  toggleToolEmbed(): void {
    const embed = this.toolEmbed();

    if (embed?.kind === 'todos' && this.todosExpand) {
      this.todosExpand.toggle(this.todosExpandScope(), this.row().trackId);

      return;
    }

    this.toolEmbedOpenOverride.set(!this.toolEmbedOpen());
  }

  /** Keep JSON popover / icon clicks from toggling the tool collapse. */
  stopHeaderControlEvent(event: Event): void {
    event.stopPropagation();
  }

  showSummaryBody(): boolean {
    const r = this.row();

    return r.kind === 'question' && r.summaryBody.trim().length > 0 && !r.questionInteraction;
  }

  showDetailPopover(): boolean {
    return this.popoverDetailContent().trim().length > 0;
  }

  /** Popover body: plain thinking (etc.) when provided, else JSON detail. */
  popoverDetailContent(): string {
    const r = this.row();
    const plain = r.popoverPlainDetail?.trim();

    if (plain !== undefined && plain.length > 0) {
      return plain;
    }

    return r.detailJson;
  }

  hasToolPairCallDetail(): boolean {
    const d = this.row().toolPair?.callDetailJson?.trim();

    return d !== undefined && d.length > 0;
  }

  hasToolPairResultDetail(): boolean {
    const d = this.row().toolPair?.resultDetailJson?.trim();

    return d !== undefined && d.length > 0;
  }

  showToolPairAwaitingResult(): boolean {
    const p = this.row().toolPair;

    return (
      p !== undefined && p.outcome === 'pending' && !this.hasToolPairResultDetail() && this.hasToolPairCallDetail()
    );
  }

  toolPairCallDetailContent(): string {
    return this.row().toolPair?.callDetailJson?.trim() ?? '';
  }

  toolPairResultDetailContent(): string {
    return this.row().toolPair?.resultDetailJson?.trim() ?? '';
  }

  toolResultGlyphClass(): Record<string, boolean> {
    const err = this.row().toolPair?.outcome === 'error';

    return {
      'bi-clipboard2-check': !err,
      'bi-clipboard2-x': err,
    };
  }

  detailAriaLabel(): string {
    return $localize`:@@featureChat-agentEventDetailPopover:Show event details`;
  }

  toolInvocationAriaLabel(): string {
    return $localize`:@@featureChat-agentToolInvocationPopoverAria:Show tool invocation details`;
  }

  toolResultAriaLabel(): string {
    return $localize`:@@featureChat-agentToolResultPopoverAria:Show tool result details`;
  }

  toolAwaitingAriaLabel(): string {
    return $localize`:@@featureChat-agentToolAwaitingAria:Tool result not received yet`;
  }

  isOptionSelected(id: string): boolean {
    return this.selectedOptionIds().has(id);
  }

  hasMultiSelection(): boolean {
    return this.selectedOptionIds().size > 0;
  }

  onOptionClick(opt: { id: string; label: string }): void {
    const q = this.question();

    if (!q || this.answered() || this.replying()) {
      return;
    }

    if (q.allowMultiple) {
      const next = new Set(this.selectedOptionIds());

      if (next.has(opt.id)) {
        next.delete(opt.id);
      } else {
        next.add(opt.id);
      }

      this.selectedOptionIds.set(next);

      return;
    }

    if (q.replyKind === 'permission') {
      this.questionReply.emit({
        questionId: q.questionId,
        replyKind: 'permission',
        sessionId: q.sessionId,
        answers: [opt.id],
      });

      return;
    }

    this.questionReply.emit({
      questionId: q.questionId,
      replyKind: 'question',
      sessionId: q.sessionId,
      answers: [opt.label],
    });
  }

  submitMulti(): void {
    const q = this.question();

    if (!q || !q.allowMultiple || this.answered() || this.replying()) {
      return;
    }

    const selected = q.options.filter((o) => this.selectedOptionIds().has(o.id)).map((o) => o.label);

    if (selected.length === 0) {
      return;
    }

    this.questionReply.emit({
      questionId: q.questionId,
      replyKind: 'question',
      sessionId: q.sessionId,
      answers: selected,
    });
  }

  rejectQuestion(): void {
    const q = this.question();

    if (!q || this.answered() || this.replying()) {
      return;
    }

    this.questionReply.emit({
      questionId: q.questionId,
      replyKind: q.replyKind,
      sessionId: q.sessionId,
      reject: true,
    });
  }
}
