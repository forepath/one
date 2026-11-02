import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  output,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { type ITheme, Terminal } from '@xterm/xterm';

import {
  type FpcBrandPalette,
  fpcObserveBrandChanges,
  fpcReadBrandPalette,
  fpcWithAlpha,
} from '../brand-tokens/brand-tokens';

export interface FpcTerminalSize {
  cols: number;
  rows: number;
}

/** ANSI base colours tuned for light / dark surfaces; brand tokens override the semantic ones. */
const ANSI_DARK: ITheme = {
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

const ANSI_LIGHT: ITheme = {
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

/** xterm.js theme from the active brand palette (surface, text, cursor, selection, semantic ANSI). */
export function fpcTerminalTheme(palette: FpcBrandPalette): ITheme {
  const ansi = palette.isDark ? ANSI_DARK : ANSI_LIGHT;

  return {
    ...ansi,
    background: palette.tertiaryBg,
    foreground: palette.bodyColor,
    cursor: palette.primary,
    cursorAccent: palette.tertiaryBg,
    selectionBackground: fpcWithAlpha(palette.primary, 0.35),
    selectionInactiveBackground: fpcWithAlpha(palette.secondaryColor, 0.25),
    red: palette.danger,
    green: palette.success,
    yellow: palette.warning,
    blue: palette.primary,
    cyan: palette.info,
  };
}

/** Columns / rows that fit `width` × `height` pixels for a given cell size (minimum 2 × 1). */
export function fpcTerminalGrid(width: number, height: number, cellWidth: number, cellHeight: number): FpcTerminalSize {
  if (!(cellWidth > 0) || !(cellHeight > 0)) {
    return { cols: 0, rows: 0 };
  }

  return {
    cols: Math.max(2, Math.floor(width / cellWidth)),
    rows: Math.max(1, Math.floor(height / cellHeight)),
  };
}

interface XtermCellDimensions {
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
}

/**
 * Presentational xterm.js terminal. It knows nothing about the transport: wire `(data)` to the
 * remote input and call `write()` with remote output; `(sizeChange)` reports the grid size whenever the
 * container changes. The grid is computed from the renderer's measured cell size with a
 * ResizeObserver (no fit addon). Colours follow the brand and light / dark switches.
 */
@Component({
  selector: 'fpc-terminal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // xterm creates its DOM imperatively; its stylesheet must reach those nodes.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'fpc-terminal', '[class.fpc-terminal--hidden]': '!visible()' },
  template: `<div #container class="fpc-terminal__container" [attr.aria-label]="ariaLabel()"></div>`,
  styleUrl: './terminal.component.scss',
})
export class FpcTerminalComponent {
  private readonly ngZone = inject(NgZone);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly fontSize = input(13);
  /** When false the terminal is hidden and does not measure / resize (keep it alive in tabs). */
  readonly visible = input(true);
  readonly ariaLabel = input('Terminal');
  /** Lines kept in the scroll-back buffer. */
  readonly scrollback = input(5000);

  /** User keystrokes / pasted text, to forward to the remote process. */
  readonly data = output<string>();
  /** Terminal grid size after a container resize (deduplicated). */
  readonly sizeChange = output<FpcTerminalSize>();

  private terminal: Terminal | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private stopBrandObserver: (() => void) | null = null;
  private frame: number | null = null;
  private lastSize: FpcTerminalSize | null = null;
  private pending: string[] = [];

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      const fontSize = this.fontSize();

      untracked(() => {
        if (this.terminal) {
          this.terminal.options.fontSize = fontSize;
          this.scheduleFit();
        }
      });
    });

    effect(() => {
      if (this.visible()) {
        untracked(() => this.scheduleFit());
      }
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /** The underlying xterm instance (null before the first render). */
  get instance(): Terminal | null {
    return this.terminal;
  }

  /** Writes raw output (ANSI sequences allowed). Calls before init are buffered. */
  write(text: string): void {
    if (this.terminal) {
      this.terminal.write(text);
    } else {
      this.pending.push(text);
    }
  }

  /** Clears the screen and scroll-back. */
  clear(): void {
    this.pending = [];
    this.terminal?.clear();
  }

  focus(): void {
    this.terminal?.focus();
  }

  /** Re-measures the container now (e.g. after a parent animation). */
  fit(): void {
    this.applyFit();
  }

  private init(): void {
    if (this.terminal) {
      return;
    }

    const palette = fpcReadBrandPalette();

    this.ngZone.runOutsideAngular(() => {
      const terminal = new Terminal({
        theme: fpcTerminalTheme(palette),
        fontSize: this.fontSize(),
        fontFamily: palette.monospaceFontFamily,
        scrollback: this.scrollback(),
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: false,
      });

      terminal.onData((value) => this.ngZone.run(() => this.data.emit(value)));
      terminal.open(this.container().nativeElement);
      this.terminal = terminal;

      for (const chunk of this.pending) {
        terminal.write(chunk);
      }

      this.pending = [];

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
        this.resizeObserver.observe(this.container().nativeElement);
      }
    });

    this.stopBrandObserver = fpcObserveBrandChanges(() => {
      if (this.terminal) {
        this.terminal.options.theme = fpcTerminalTheme(fpcReadBrandPalette());
      }
    });

    this.scheduleFit();
  }

  private teardown(): void {
    if (this.frame !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.frame);
    }

    this.resizeObserver?.disconnect();
    this.stopBrandObserver?.();
    this.terminal?.dispose();
    this.terminal = null;
  }

  private scheduleFit(): void {
    if (!this.terminal || this.frame !== null) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.applyFit();

      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.applyFit();
      });
    });
  }

  private applyFit(): void {
    const terminal = this.terminal;

    if (!terminal || !this.visible()) {
      return;
    }

    const element = this.container().nativeElement;
    const { width, height } = element.getBoundingClientRect();

    if (width <= 0 || height <= 0) {
      return;
    }

    const { width: cellWidth, height: cellHeight } = this.cellSize(terminal);
    const size = fpcTerminalGrid(width, height, cellWidth, cellHeight);

    if (size.cols === 0 || (this.lastSize?.cols === size.cols && this.lastSize?.rows === size.rows)) {
      return;
    }

    this.lastSize = size;

    if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
      terminal.resize(size.cols, size.rows);
    }

    this.ngZone.run(() => this.sizeChange.emit(size));
  }

  /** Cell size from xterm's renderer; falls back to a font-based estimate before the first paint. */
  private cellSize(terminal: Terminal): { width: number; height: number } {
    const cell = (terminal as unknown as XtermCellDimensions)._core?._renderService?.dimensions?.css?.cell;

    if (cell?.width && cell?.height) {
      return { width: cell.width, height: cell.height };
    }

    const fontSize = terminal.options.fontSize ?? this.fontSize();

    return { width: fontSize * 0.6, height: Math.ceil(fontSize * 1.2) };
  }
}
