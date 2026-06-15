import { AfterViewInit, Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

interface BootstrapPopoverInstance {
  dispose(): void;
  setContent(content: Record<string, string | Element | null | (() => string)>): void;
}

interface BootstrapPopoverConstructor {
  getOrCreateInstance(element: Element, options?: Record<string, unknown>): BootstrapPopoverInstance;
}

function getBootstrapPopover(): BootstrapPopoverConstructor | undefined {
  return (window as Window & { bootstrap?: { Popover?: BootstrapPopoverConstructor } }).bootstrap?.Popover;
}

/** Escape text for safe use inside popover HTML bodies. */
export function escapeHtmlForAgentChatPopover(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Bootstrap 5 popover for agent chat event rows (hover + keyboard focus).
 * Full `detailJson` in `<pre>`; `.popover-body` is the single scroll container.
 */
@Directive({
  selector: '[frameworkAgentChatEventPopover]',
  standalone: true,
})
export class AgentChatEventPopoverDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('frameworkAgentChatEventPopover') title = '';
  @Input('frameworkAgentChatEventPopoverContent') content = '';

  private readonly host = inject(ElementRef<HTMLElement>);
  private instance: BootstrapPopoverInstance | null = null;

  ngAfterViewInit(): void {
    this.ensurePopover();
  }

  ngOnChanges(): void {
    if (!this.instance) {
      return;
    }

    this.instance.setContent({
      '.popover-header': this.title,
      '.popover-body': this.buildBodyElement(),
    });
  }

  ngOnDestroy(): void {
    this.instance?.dispose();
    this.instance = null;
  }

  private ensurePopover(): void {
    const Popover = getBootstrapPopover();
    const detail = this.content.trim();

    if (!Popover || detail.length === 0) {
      return;
    }

    const el = this.host.nativeElement;
    const preStyle = 'white-space: pre-wrap; word-break: break-word; font-size: 0.75rem; margin: 0;';

    this.instance = Popover.getOrCreateInstance(el, {
      trigger: 'hover focus',
      placement: 'auto',
      container: 'body',
      html: true,
      sanitize: false,
      customClass: 'agent-chat-event-popover',
      title: this.title,
      template: [
        '<div class="popover agent-chat-event-popover" role="tooltip" style="max-width: min(90vw, 42rem);">',
        '<div class="popover-arrow"></div>',
        '<h3 class="popover-header"></h3>',
        '<div class="popover-body" style="max-height: min(60vh, 24rem); overflow: auto;"></div>',
        '</div>',
      ].join(''),
      content: () => `<pre style="${preStyle}">${escapeHtmlForAgentChatPopover(detail)}</pre>`,
    });
  }

  private buildBodyElement(): HTMLPreElement {
    const pre = document.createElement('pre');

    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.fontSize = '0.75rem';
    pre.style.margin = '0';
    pre.textContent = this.content;

    return pre;
  }
}
