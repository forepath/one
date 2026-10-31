import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  compressIdle,
  delayToNext,
  eventsUntil,
  outputUntil,
  parseResize,
  type Asciicast,
  type AsciicastEvent,
  type CastCursor,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcTerminalComponent,
} from '@forepath/shared/frontend/ui-components';

/** Pauses longer than this are shortened (as `asciinema play -i 2`). */
export const CAST_IDLE_LIMIT = 2;
export const CAST_SPEEDS = [0.5, 1, 2, 4, 8];
/** A full terminal reset before replaying from a position. */
const RESET = '\x1bc';

/** Replays an asciicast v2 recording into a terminal: play / pause, speed, idle cap, seek. */
@Component({
  selector: 'loadweaver-cast-player',
  imports: [
    CommonModule,
    FormsModule,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcTerminalComponent,
  ],
  standalone: true,
  styles: `
    .lw-cast__position {
      flex: 1 1 10rem;
      min-width: 10rem;
    }
    .lw-cast__screen {
      flex: 1 1 26rem;
      min-height: 16rem;
    }
  `,
  template: `
    <div class="d-flex flex-column flex-grow-1 gap-2 min-h-0" data-testid="cast-player">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <fpc-button
          variant="primary"
          size="sm"
          [iconOnly]="true"
          [ariaLabel]="playing() ? pauseLabel : playLabel"
          [title]="playing() ? pauseLabel : playLabel"
          (clicked)="toggle()"
          data-testid="cast-toggle"
        >
          <i class="bi" [class.bi-pause-fill]="playing()" [class.bi-play-fill]="!playing()" aria-hidden="true"></i>
        </fpc-button>
        <fpc-button
          variant="dark"
          size="sm"
          [iconOnly]="true"
          [ariaLabel]="restartLabel"
          [title]="restartLabel"
          (clicked)="restart()"
        >
          <i class="bi bi-skip-backward-fill" aria-hidden="true"></i>
        </fpc-button>
        <input
          type="range"
          class="form-range lw-cast__position"
          min="0"
          [max]="duration()"
          step="0.1"
          [attr.aria-label]="positionLabel"
          [value]="position()"
          (change)="seek(+$any($event.target).value)"
        />
        <span class="small font-monospace text-nowrap" data-testid="cast-time"
          >{{ clock(position()) }} / {{ clock(duration()) }}</span
        >
        <label class="visually-hidden" for="lw-cast-speed">{{ speedLabel }}</label>
        <fpc-form-control
          controlType="select"
          controlId="lw-cast-speed"
          size="sm"
          [ngModel]="'' + speed()"
          (ngModelChange)="setSpeed($event)"
          data-testid="cast-speed"
        >
          @for (s of speeds; track s) {
            <option [value]="'' + s">{{ s }}×</option>
          }
        </fpc-form-control>
        <fpc-form-check
          class="small"
          checkId="lw-cast-idle"
          [inline]="true"
          [label]="skipIdleLabel"
          [checked]="capIdle()"
          (checkedChange)="setCapIdle($event)"
          data-testid="cast-idle"
        />
      </div>
      <div class="border rounded lw-cast__screen">
        <fpc-terminal class="d-block h-100" [ariaLabel]="title()" />
      </div>
    </div>
  `,
})
export class LoadweaverCastPlayerComponent {
  private readonly terminal = viewChild(FpcTerminalComponent);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cursor: CastCursor = { index: 0, position: 0 };

  readonly cast = input.required<Asciicast>();
  readonly title = input('Recording');
  /** Starts playing when a cast is set. */
  readonly autoplay = input(true);

  readonly playing = signal(false);
  readonly speed = signal(1);
  readonly capIdle = signal(true);
  readonly position = signal(0);

  /** The cast with the idle cap applied. */
  readonly timeline = computed(() => compressIdle(this.cast(), this.capIdle() ? CAST_IDLE_LIMIT : null));
  readonly duration = computed(() => this.timeline().duration);

  readonly speeds = CAST_SPEEDS;
  readonly playLabel = $localize`:@@lwConsoleCast-play:Play`;
  readonly pauseLabel = $localize`:@@lwConsoleCast-pause:Pause`;
  readonly restartLabel = $localize`:@@lwConsoleCast-restart:From the start`;
  readonly positionLabel = $localize`:@@lwConsoleCast-position:Position`;
  readonly speedLabel = $localize`:@@lwConsoleCast-speed:Speed`;
  readonly skipIdleLabel = $localize`:@@lwConsoleCast-skipIdle:Skip pauses`;

  constructor() {
    effect(() => {
      this.cast();
      untracked(() => {
        this.restart();

        if (this.autoplay()) this.play();
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));

    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  play(): void {
    if (this.cursor.index >= this.timeline().events.length) this.restart();

    this.playing.set(true);
    this.schedule();
  }

  pause(): void {
    this.stop();
    this.playing.set(false);
  }

  restart(): void {
    this.stop();
    this.cursor = { index: 0, position: 0 };
    this.position.set(0);
    this.terminal()?.write(RESET);
    this.applySize(this.sizeAt(this.timeline(), 0));

    if (this.playing()) this.schedule();
  }

  setSpeed(speed: number | string): void {
    this.speed.set(Number(speed) || 1);

    if (this.playing()) {
      this.stop();
      this.schedule();
    }
  }

  /** The idle cap changes the timeline: continue at the same event. */
  setCapIdle(cap: boolean): void {
    const index = this.cursor.index;

    this.capIdle.set(cap);

    const events = this.timeline().events;
    const position = index > 0 ? (events[index - 1]?.time ?? 0) : 0;

    this.cursor = { index, position };
    this.position.set(position);

    if (this.playing()) {
      this.stop();
      this.schedule();
    }
  }

  /** Jumps to `time` (seconds of the timeline): reset, write everything before it, continue from there. */
  seek(time: number): void {
    const timeline = this.timeline();
    const at = Math.min(Math.max(0, time), timeline.duration);

    this.stop();
    this.terminal()?.write(RESET);
    this.applySize(this.sizeAt(timeline, at));
    this.terminal()?.write(outputUntil(timeline, at));
    this.cursor = eventsUntil(timeline, { index: 0, position: 0 }, at).cursor;
    this.position.set(at);

    if (this.playing()) this.schedule();
  }

  /** Writes what is due and waits for the next event. */
  private schedule(): void {
    this.stop();

    const timeline = this.timeline();
    const delay = delayToNext(timeline, this.cursor, this.speed());

    if (delay === null) {
      this.playing.set(false);

      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;

      const next = timeline.events[this.cursor.index];
      const { events, cursor } = eventsUntil(timeline, this.cursor, next.time);

      this.replay(events);

      this.cursor = cursor;
      this.position.set(cursor.position);
      this.schedule();
    }, delay);
  }

  /** Writes output events and applies resizes (`r`, `COLSxROWS`) in their order. */
  private replay(events: readonly AsciicastEvent[]): void {
    let output = '';

    for (const event of events) {
      if (event.code === 'o') {
        output += event.data;
      } else if (event.code === 'r') {
        const size = parseResize(event.data);

        if (!size) continue;

        if (output) this.terminal()?.write(output);

        output = '';
        this.applySize(size);
      }
    }

    if (output) this.terminal()?.write(output);
  }

  /** The terminal size at `time`: the last resize before it, else the recording's own. */
  private sizeAt(timeline: Asciicast, time: number): { cols: number; rows: number } {
    let size = { cols: timeline.header.width, rows: timeline.header.height };

    for (const event of timeline.events) {
      if (event.time > time) break;

      if (event.code === 'r') size = parseResize(event.data) ?? size;
    }

    return size;
  }

  /** The replay uses the recorded grid, so lines wrap as they did in the session. */
  private applySize(size: { cols: number; rows: number }): void {
    const instance = this.terminal()?.instance;

    if (instance && size.cols > 0 && size.rows > 0 && (instance.cols !== size.cols || instance.rows !== size.rows))
      instance.resize(size.cols, size.rows);
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);

    this.timer = null;
  }
}
