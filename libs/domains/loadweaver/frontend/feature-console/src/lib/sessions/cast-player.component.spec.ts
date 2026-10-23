import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { parseAsciicast } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcTerminalComponent } from '@forepath/shared/frontend/ui-components';

import { LoadweaverCastPlayerComponent } from './cast-player.component';

const CAST = parseAsciicast(
  [
    '{"version": 2, "width": 80, "height": 24}',
    '[0.5, "o", "$ "]',
    '[1.0, "o", "ls\\r\\n"]',
    '[11.0, "o", "done"]',
  ].join('\n'),
);

describe('LoadweaverCastPlayerComponent', () => {
  let fixture: ComponentFixture<LoadweaverCastPlayerComponent>;
  let write: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [LoadweaverCastPlayerComponent] }).compileComponents();
    fixture = TestBed.createComponent(LoadweaverCastPlayerComponent);
    write = jest.spyOn(
      fixture.debugElement.query(By.directive(FpcTerminalComponent)).componentInstance as FpcTerminalComponent,
      'write',
    );
    fixture.componentRef.setInput('cast', CAST);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  const written = () => write.mock.calls.map(([text]) => text).join('');

  it('replays output in time and caps pauses', () => {
    const player = fixture.componentInstance;

    expect(player.playing()).toBe(true);
    // Idle cap: 10 s of silence become 2 s.
    expect(player.duration()).toBe(3);

    jest.advanceTimersByTime(499);
    expect(written()).not.toContain('$ ');
    jest.advanceTimersByTime(1);
    expect(written()).toContain('$ ');
    jest.advanceTimersByTime(500);
    expect(written()).toContain('ls\r\n');
    jest.advanceTimersByTime(2000);
    expect(written()).toContain('done');
    expect(player.playing()).toBe(false);
    expect(player.position()).toBe(3);
  });

  it('pauses, plays faster and seeks', () => {
    const player = fixture.componentInstance;

    player.pause();
    jest.advanceTimersByTime(5000);
    expect(written()).not.toContain('$ ');

    player.setSpeed(2);
    player.play();
    jest.advanceTimersByTime(250);
    expect(written()).toContain('$ ');

    write.mockClear();
    player.seek(1);
    expect(written()).toBe('\x1bc$ ls\r\n');
    expect(player.position()).toBe(1);

    player.setCapIdle(false);
    expect(player.duration()).toBe(11);
    expect(fixture.nativeElement.querySelector('[data-testid="cast-time"]')).not.toBeNull();
  });

  it('applies resize events to the terminal in order with the output', () => {
    const terminal = fixture.debugElement.query(By.directive(FpcTerminalComponent))
      .componentInstance as FpcTerminalComponent;
    const instance = {
      cols: 0,
      rows: 0,
      resize: jest.fn(function (this: { cols: number; rows: number }, cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
      }),
    };
    const order: string[] = [];

    Object.defineProperty(terminal, 'instance', { get: () => instance });
    write.mockImplementation((text: string) => void order.push(`write:${text}`));
    instance.resize.mockImplementation(function (this: typeof instance, cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      order.push(`resize:${cols}x${rows}`);
    });

    fixture.componentRef.setInput(
      'cast',
      parseAsciicast(
        [
          '{"version": 2, "width": 80, "height": 24}',
          '[0.5, "o", "a"]',
          '[0.5, "r", "120x40"]',
          '[0.5, "o", "b"]',
          '[1.0, "r", "bogus"]',
          '[1.5, "r", "100x30"]',
          '[2.0, "o", "c"]',
        ].join('\n'),
      ),
    );
    fixture.detectChanges();

    // The recording's own size first.
    expect(order).toContain('resize:80x24');

    jest.advanceTimersByTime(500);
    expect(order.slice(-3)).toEqual(['write:a', 'resize:120x40', 'write:b']);

    jest.advanceTimersByTime(1500);
    expect(order.slice(-2)).toEqual(['resize:100x30', 'write:c']);

    // Seeking restores the size at that point.
    order.length = 0;
    fixture.componentInstance.seek(0.7);
    expect(order).toEqual(['write:\x1bc', 'resize:120x40', 'write:ab']);
  });
});
