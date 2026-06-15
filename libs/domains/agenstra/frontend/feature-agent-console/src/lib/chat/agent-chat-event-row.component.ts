import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { AgentChatEventDisplayRow } from './agent-chat-event-display';
import { AgentChatEventPopoverDirective } from './agent-chat-event-popover.directive';

@Component({
  selector: 'framework-agent-chat-event-row',
  standalone: true,
  imports: [NgClass, AgentChatEventPopoverDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './agent-chat-event-row.component.scss',
  template: `
    <div class="small mb-2 d-flex align-items-center gap-2">
      <span class="badge rounded-pill" [ngClass]="row().badgeClass">{{ row().kindLabel }}</span>
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex align-items-center gap-1 flex-wrap">
          <span class="fw-semibold">{{ row().summaryTitle }}</span>
          @if (row().toolPair) {
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
          } @else if (showDetailPopover()) {
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
        </div>
      </div>
    </div>
  `,
})
export class AgentChatEventRowComponent {
  readonly row = input.required<AgentChatEventDisplayRow>();

  protected readonly toolInvocationPopoverTitle = $localize`:@@featureChat-agentToolInvocationPopover:Tool invocation`;
  protected readonly toolResultPopoverTitle = $localize`:@@featureChat-agentToolResultPopover:Tool result`;
  protected readonly toolAwaitingResultTitle = $localize`:@@featureChat-agentToolAwaitingResultTitle:Awaiting tool result`;
  protected readonly toolAwaitingResultBody = $localize`:@@featureChat-agentToolAwaitingResultBody:The tool has not returned a result yet.`;

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
}
