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
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

interface TerminalSession {
  sessionId: string;
  terminal: Terminal;
  createdAt: Date;
}

@Component({
  selector: 'framework-terminal',
  imports: [CommonModule],
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.scss'],
  standalone: true,
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  private readonly socketsFacade = inject(SocketsFacade);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  clientId = input.required<string>();
  agentId = input.required<string>();
  visible = input<boolean>(false);

  // ViewChild for terminal container
  @ViewChild('terminalContainer', { static: false }) terminalContainerRef?: ElementRef<HTMLDivElement>;

  // Terminal sessions
  private readonly sessions = signal<Map<string, TerminalSession>>(new Map());
  readonly activeSessionId = signal<string | null>(null);
  readonly sessionIds = signal<string[]>([]);

  // Terminal instance for active session
  private activeTerminal: Terminal | null = null;

  // ResizeObserver for terminal container
  private resizeObserver?: ResizeObserver;

  // Track input buffer per session (for line-based input)
  private readonly inputBuffer = new Map<string, string>();

  // Track cursor position within input buffer per session
  private readonly inputCursorPosition = new Map<string, number>();

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
    // Clean up all terminal sessions
    for (const session of this.sessions().values()) {
      session.terminal.dispose();
    }

    this.sessions.set(new Map());
    this.activeTerminal = null;

    // Clean up buffers
    this.inputBuffer.clear();
    this.inputCursorPosition.clear();
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
   * Switch to a different terminal session
   */
  onSwitchSession(sessionId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.setActiveSession(sessionId);
  }

  /**
   * Handle terminal created event
   */
  private handleTerminalCreated(sessionId: string): void {
    // Create xterm terminal instance
    const terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        cursorAccent: '#aeafad',
        selectionBackground: '#264f78',
        selectionForeground: '#d4d4d4',
        selectionInactiveBackground: '#264f78',
        black: '#000000',
        red: '#ff0000',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0000ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#808080',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#0000ff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff',
      },
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

    // Set up terminal input handler
    // Strategy: Intercept all input, buffer it, and manually control display
    // When Enter is pressed, send the complete line to backend
    // Backend will echo it back, and we'll erase our local display to avoid duplication
    //
    // Note: All buffers are session-specific (keyed by sessionId), so each terminal
    // session maintains its own input buffer, echo tracking, and output accumulator.
    // This ensures proper isolation when switching between multiple terminal sessions.

    terminal.onData((data: string) => {
      const isEnter = data === '\r' || data === '\n';
      let buffer = this.inputBuffer.get(sessionId) || '';
      let cursorPos = this.inputCursorPosition.get(sessionId) ?? buffer.length;

      if (isEnter) {
        // Enter pressed - send the complete buffered line
        if (buffer.length > 0) {
          // Erase only the characters the user typed (not the prompt)
          // First, move cursor to the end of the input if it's not already there
          const remainingChars = buffer.length - cursorPos;

          if (remainingChars > 0) {
            // Move cursor forward to end
            for (let i = 0; i < remainingChars; i++) {
              terminal.write('\x1b[C'); // Move cursor forward
            }
          }

          // Now move back and clear all typed characters
          for (let i = 0; i < buffer.length; i++) {
            terminal.write('\b'); // Move cursor back
          }

          terminal.write('\x1b[K'); // Clear from cursor to end of line

          // Send the line with newline
          const lineToSend = buffer + '\n';

          this.socketsFacade.forwardTerminalInput(sessionId, lineToSend, this.agentId());

          // Clear the buffer and cursor position
          this.inputBuffer.delete(sessionId);
          this.inputCursorPosition.delete(sessionId);
        } else {
          // Empty line - just send newline
          this.socketsFacade.forwardTerminalInput(sessionId, '\n', this.agentId());
        }
      } else if (data === '\b' || data === '\x7f') {
        // Backspace - remove character before cursor
        if (cursorPos > 0) {
          // Remove character before cursor
          cursorPos--;
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
          this.inputBuffer.set(sessionId, buffer);
          this.inputCursorPosition.set(sessionId, cursorPos);

          // Move cursor back and redraw the line
          terminal.write('\b');
          this.redrawInputLine(terminal, buffer, cursorPos);
        }
      } else if (data === '\x03') {
        // Ctrl+C - clear buffer and send interrupt
        this.inputBuffer.delete(sessionId);
        this.inputCursorPosition.delete(sessionId);
        this.socketsFacade.forwardTerminalInput(sessionId, '\x03', this.agentId());
      } else if (data === '\x04') {
        // Ctrl+D - send EOF
        this.inputBuffer.delete(sessionId);
        this.inputCursorPosition.delete(sessionId);
        this.socketsFacade.forwardTerminalInput(sessionId, '\x04', this.agentId());
      } else {
        // Check if this is an arrow key sequence
        const firstChar = data.charCodeAt(0);
        const isEscapeSequence = firstChar === 0x1b;

        if (isEscapeSequence) {
          // Parse arrow key sequences: ^[[D (left), ^[[C (right)
          if (data === '\x1b[D') {
            // Left arrow - move cursor left within input
            if (cursorPos > 0) {
              cursorPos--;
              this.inputCursorPosition.set(sessionId, cursorPos);
              terminal.write('\b'); // Move cursor back one position
            }
          } else if (data === '\x1b[C') {
            // Right arrow - move cursor right within input
            if (cursorPos < buffer.length) {
              cursorPos++;
              this.inputCursorPosition.set(sessionId, cursorPos);
              terminal.write('\x1b[C'); // Move cursor forward one position
            }
          } else {
            // Other escape sequences (up/down for history, tab, etc.) - send to backend
            // Clear input buffer since backend will send back updated command line
            this.inputBuffer.delete(sessionId);
            this.inputCursorPosition.delete(sessionId);
            this.socketsFacade.forwardTerminalInput(sessionId, data, this.agentId());
          }
        } else {
          const isTab = data === '\t';
          const isControlChar = (firstChar < 0x20 && firstChar !== 0x09) || firstChar === 0x7f;

          if (isTab) {
            // Tab - send to backend for autocomplete
            this.inputBuffer.delete(sessionId);
            this.inputCursorPosition.delete(sessionId);
            this.socketsFacade.forwardTerminalInput(sessionId, data, this.agentId());
          } else if (isControlChar) {
            // Other control characters - send immediately
            this.socketsFacade.forwardTerminalInput(sessionId, data, this.agentId());
          } else {
            // Regular printable character - insert at cursor position
            buffer = buffer.slice(0, cursorPos) + data + buffer.slice(cursorPos);
            cursorPos++;
            this.inputBuffer.set(sessionId, buffer);
            this.inputCursorPosition.set(sessionId, cursorPos);

            // Write the inserted character and redraw the rest
            terminal.write(data);
            this.redrawInputLine(terminal, buffer, cursorPos);
          }
        }
      }
    });
  }

  /**
   * Redraw the input line from the cursor position
   * Used when inserting/deleting characters in the middle of the input
   */
  private redrawInputLine(terminal: Terminal, buffer: string, cursorPos: number): void {
    // Get remaining characters after cursor
    const remainingChars = buffer.length - cursorPos;

    // Clear from cursor to end of line
    terminal.write('\x1b[K');

    // Write remaining characters after cursor
    if (remainingChars > 0) {
      terminal.write(buffer.slice(cursorPos));

      // Move cursor back to the correct position
      for (let i = 0; i < remainingChars; i++) {
        terminal.write('\b');
      }
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
    const session = this.sessions().get(sessionId);

    if (session) {
      session.terminal.dispose();
    }

    // Clean up buffers
    this.inputBuffer.delete(sessionId);
    this.inputCursorPosition.delete(sessionId);
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
    }
  }

  /**
   * Update session IDs array for template
   */
  private updateSessionIds(): void {
    this.sessionIds.set(Array.from(this.sessions().keys()));
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
