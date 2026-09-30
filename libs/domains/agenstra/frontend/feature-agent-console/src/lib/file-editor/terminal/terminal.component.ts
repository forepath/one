import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  SocketsFacade,
  type SuccessResponse,
  type TerminalClosedData,
  type TerminalCreatedData,
  type TerminalOutputData,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcButtonComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
} from '@forepath/shared/frontend/ui-components';
import { type ITheme, Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { ThemeService } from '../../theme.service';

interface TerminalSession {
  sessionId: string;
  terminal: Terminal;
  createdAt: Date;
}

const XTERM_THEME_DARK: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#d4d4d4',
  selectionInactiveBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const XTERM_THEME_LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#526fff',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#383a42',
  selectionInactiveBackground: '#e5ebf1',
  black: '#000000',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

@Component({
  selector: 'framework-terminal',
  imports: [CommonModule, FpcButtonComponent, FpcDropdownComponent, FpcDropdownItemComponent],
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.scss'],
  standalone: true,
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  private readonly socketsFacade = inject(SocketsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeService = inject(ThemeService);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  visible = input<boolean>(false);

  // ViewChild for terminal container
  @ViewChild('terminalContainer', { static: false }) terminalContainerRef?: ElementRef<HTMLDivElement>;

  readonly sessionMenuOpen = signal(false);

  // Terminal sessions
  private readonly sessions = signal<Map<string, TerminalSession>>(new Map());
  readonly activeSessionId = signal<string | null>(null);
  readonly sessionIds = signal<string[]>([]);

  // Terminal instance for active session
  private activeTerminal: Terminal | null = null;

  // When refreshing the sole session, close this id after the replacement is created
  private pendingRefreshReplaceSessionId: string | null = null;

  // ResizeObserver for terminal container
  private resizeObserver?: ResizeObserver;

  // Track how many terminal output events have been processed per session
  // This counter tells us how many messages to skip from the events array
  private readonly processedEventCount = new Map<string, number>();

  constructor() {
    // Automatically create a terminal session when the panel becomes visible and no sessions exist
    effect(() => {
      if (this.visible() && this.sessions().size === 0 && this.clientId() && this.agentId()) {
        setTimeout(() => {
          this.onCreateTerminal();
        }, 0);
      }
    });

    effect(() => {
      const theme = this.resolveXtermTheme(this.themeService.isDarkMode());

      for (const session of this.sessions().values()) {
        session.terminal.options.theme = theme;
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up resize observer for terminal container
    setTimeout(() => {
      if (this.terminalContainerRef) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.activeTerminal) {
            requestAnimationFrame(() => {
              this.resizeTerminal();
            });
          }
        });
        this.resizeObserver.observe(this.terminalContainerRef.nativeElement);

        // If there's an active session but terminal isn't opened yet, open it now
        const activeSessionId = this.activeSessionId();

        if (activeSessionId) {
          const session = this.sessions().get(activeSessionId);

          if (session && !this.activeTerminal) {
            this.openTerminalInContainer(session);
          }
        }
      }
    }, 0);

    // Subscribe to terminal events from socket
    this.socketsFacade
      .getForwardedEventsByEvent$('terminalCreated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        if (events.length > 0) {
          const latest = events[events.length - 1];
          const response = latest.payload as SuccessResponse<TerminalCreatedData>;

          if (response.success && response.data) {
            this.handleTerminalCreated(response.data.sessionId);
          }
        }
      });

    this.socketsFacade
      .getForwardedEventsByEvent$('terminalOutput')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        // Group events by sessionId to process per session
        const eventsBySession = new Map<string, typeof events>();

        for (const event of events) {
          const response = event.payload as SuccessResponse<TerminalOutputData>;

          if (response.success && response.data) {
            const sessionId = response.data.sessionId;

            if (!eventsBySession.has(sessionId)) {
              eventsBySession.set(sessionId, []);
            }

            const sessionEvents = eventsBySession.get(sessionId);

            if (sessionEvents) {
              sessionEvents.push(event);
            }
          }
        }

        // Process events per session, skipping already processed ones
        for (const [sessionId, sessionEvents] of eventsBySession) {
          const skipCount = this.processedEventCount.get(sessionId) || 0;
          const eventsToProcess = sessionEvents.slice(skipCount);

          for (const event of eventsToProcess) {
            const response = event.payload as SuccessResponse<TerminalOutputData>;

            if (response.success && response.data) {
              this.handleTerminalOutput(response.data.sessionId, response.data.data);
            }
          }

          // Update counter: total events for this session
          this.processedEventCount.set(sessionId, sessionEvents.length);
        }
      });

    this.socketsFacade
      .getForwardedEventsByEvent$('terminalClosed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        for (const event of events) {
          const response = event.payload as SuccessResponse<TerminalClosedData>;

          if (response.success && response.data) {
            this.handleTerminalClosed(response.data.sessionId);
          }
        }
      });
  }

  ngOnDestroy(): void {
    for (const sessionId of this.sessions().keys()) {
      this.socketsFacade.forwardCloseTerminal(sessionId, this.agentId());
    }

    for (const session of this.sessions().values()) {
      session.terminal.dispose();
    }

    this.sessions.set(new Map());
    this.activeTerminal = null;
    this.pendingRefreshReplaceSessionId = null;
    this.processedEventCount.clear();

    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  /**
   * Create a new terminal session
   */
  onCreateTerminal(): void {
    const sessionId = `${this.clientId()}-${this.agentId()}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    this.socketsFacade.forwardCreateTerminal(sessionId, undefined, this.agentId());
  }

  /**
   * Close a terminal session
   */
  onCloseTerminal(sessionId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.socketsFacade.forwardCloseTerminal(sessionId, this.agentId());
  }

  /**
   * Replace the sole remaining terminal with a fresh session.
   * Create first, then close the old one once the replacement is ready (avoids racing the create forward).
   */
  onRefreshTerminal(sessionId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.sessionMenuOpen.set(false);
    this.pendingRefreshReplaceSessionId = sessionId;
    this.onCreateTerminal();
  }

  /**
   * Switch to a different terminal session
   */
  onSwitchSession(sessionId: string, event?: Event): void {
    event?.preventDefault();
    this.sessionMenuOpen.set(false);
    this.setActiveSession(sessionId);
  }

  /**
   * Handle terminal created event
   */
  private handleTerminalCreated(sessionId: string): void {
    // Create xterm terminal instance
    const terminal = new Terminal({
      theme: this.resolveXtermTheme(this.themeService.isDarkMode()),
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'block',
    });
    // Create session
    const session: TerminalSession = {
      sessionId,
      terminal,
      createdAt: new Date(),
    };
    // Add to sessions map
    const sessions = new Map(this.sessions());

    sessions.set(sessionId, session);
    this.sessions.set(sessions);
    this.updateSessionIds();

    // Always switch to the newly created terminal
    // This ensures that when user clicks "New", they immediately see the new terminal
    this.setActiveSession(sessionId);

    terminal.onData((data: string) => {
      this.socketsFacade.forwardTerminalInput(sessionId, data, this.agentId());
    });

    const replaceSessionId = this.pendingRefreshReplaceSessionId;

    if (replaceSessionId && replaceSessionId !== sessionId) {
      this.pendingRefreshReplaceSessionId = null;
      this.socketsFacade.forwardCloseTerminal(replaceSessionId, this.agentId());
      // Tear down locally immediately so the dropdown does not keep the old session if close is delayed.
      this.handleTerminalClosed(replaceSessionId);
    }
  }

  /**
   * Handle terminal output event
   * Very simple: Just write whatever comes through
   *
   * Note: Output is written to the session's terminal instance regardless of whether
   * it's currently active. Each session maintains its own terminal state, so output
   * is preserved when switching between sessions.
   */
  private handleTerminalOutput(sessionId: string, data: string): void {
    const session = this.sessions().get(sessionId);

    if (!session?.terminal) {
      return;
    }

    try {
      // Just write the data directly - no filtering
      session.terminal.write(data);
    } catch (error) {
      console.error('Error writing to terminal:', error);
    }
  }

  /**
   * Handle terminal closed event
   */
  private handleTerminalClosed(sessionId: string): void {
    if (this.pendingRefreshReplaceSessionId === sessionId) {
      this.pendingRefreshReplaceSessionId = null;
    }

    const session = this.sessions().get(sessionId);

    if (!session) {
      return;
    }

    session.terminal.dispose();
    this.processedEventCount.delete(sessionId);

    // Remove from sessions
    const sessions = new Map(this.sessions());

    sessions.delete(sessionId);
    this.sessions.set(sessions);
    this.updateSessionIds();

    // If this was the active session, switch to another or clear
    if (this.activeSessionId() === sessionId) {
      const remainingSessions = Array.from(sessions.keys());

      if (remainingSessions.length > 0) {
        this.setActiveSession(remainingSessions[0]);
      } else {
        this.setActiveSession(null);
      }
    }
  }

  /**
   * Set the active terminal session
   */
  private setActiveSession(sessionId: string | null): void {
    this.activeSessionId.set(sessionId);

    if (!sessionId) {
      this.activeTerminal = null;

      return;
    }

    const session = this.sessions().get(sessionId);

    if (!session) {
      return;
    }

    // If terminal container is not available yet, wait for it
    if (!this.terminalContainerRef) {
      setTimeout(() => {
        if (this.terminalContainerRef && this.activeSessionId() === sessionId) {
          this.openTerminalInContainer(session);
        }
      }, 0);

      return;
    }

    this.openTerminalInContainer(session);
  }

  /**
   * Open terminal in the container element
   * Uses show/hide approach to preserve terminal state when switching sessions
   */
  private openTerminalInContainer(session: TerminalSession): void {
    if (!this.terminalContainerRef) {
      return;
    }

    try {
      const container = this.terminalContainerRef.nativeElement;

      // Hide the currently active terminal if it exists and is different
      if (this.activeTerminal && this.activeTerminal !== session.terminal && this.activeTerminal.element) {
        const currentElement = this.activeTerminal.element;

        if (currentElement.parentElement === container) {
          // Hide the current terminal but keep it in DOM to preserve state
          (currentElement as HTMLElement).style.display = 'none';
        }
      }

      const terminalElement = session.terminal.element;

      // Check if this terminal is already in the container
      if (terminalElement && terminalElement.parentElement === container) {
        // Terminal is already in DOM - just show it
        (terminalElement as HTMLElement).style.display = '';
      } else {
        // Terminal not in DOM yet - open it for the first time
        if (terminalElement && terminalElement.parentElement) {
          // Terminal is attached elsewhere - remove it first
          terminalElement.parentElement.removeChild(terminalElement);
        }

        // Open the terminal - this will create the element and attach it to container
        session.terminal.open(container);
      }

      this.activeTerminal = session.terminal;

      // Resize and focus after DOM updates
      // Important: Resize after showing to ensure proper dimensions
      // (terminal might have been hidden during container resize)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.resizeTerminal();
          session.terminal.focus();
        });
      });
    } catch (error) {
      console.error('Error opening terminal:', error);
    }
  }

  /**
   * Resize terminal to fit container
   */
  private resizeTerminal(): void {
    if (!this.activeTerminal || !this.terminalContainerRef) {
      return;
    }

    const container = this.terminalContainerRef.nativeElement;
    const containerRect = container.getBoundingClientRect();
    const charWidth = 8.4;
    const charHeight = 17;
    const cols = Math.floor(containerRect.width / charWidth);
    const rows = Math.floor(containerRect.height / charHeight);

    if (cols > 0 && rows > 0) {
      this.activeTerminal.resize(cols, rows);

      const activeSessionId = this.activeSessionId();

      if (activeSessionId) {
        this.socketsFacade.forwardTerminalResize(activeSessionId, cols, rows, this.agentId());
      }
    }
  }

  /**
   * Update session IDs array for template
   */
  private updateSessionIds(): void {
    this.sessionIds.set(Array.from(this.sessions().keys()));
  }

  private resolveXtermTheme(isDarkMode: boolean): ITheme {
    return isDarkMode ? XTERM_THEME_DARK : XTERM_THEME_LIGHT;
  }

  /**
   * Get session display name
   */
  getSessionName(sessionId: string): string {
    const session = this.sessions().get(sessionId);

    if (!session) {
      return sessionId;
    }

    const index = this.sessionIds().indexOf(sessionId) + 1;

    return `Terminal ${index}`;
  }
}
