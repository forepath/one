import { ComponentFixture, TestBed } from '@angular/core/testing';

jest.mock('@xterm/xterm', () => {
  class Terminal {
    static instances: Terminal[] = [];
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    write = jest.fn();
    clear = jest.fn();
    focus = jest.fn();
    dispose = jest.fn();
    open = jest.fn();
    resize = jest.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    dataListener: ((value: string) => void) | null = null;
    _core = { _renderService: { dimensions: { css: { cell: { width: 8, height: 16 } } } } };

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      Terminal.instances.push(this);
    }

    onData(listener: (value: string) => void) {
      this.dataListener = listener;

      return { dispose: jest.fn() };
    }
  }

  return { Terminal };
});

import { Terminal } from '@xterm/xterm';

import { FpcTerminalComponent, fpcTerminalGrid, fpcTerminalTheme } from './terminal.component';
import { fpcReadBrandPalette } from '../brand-tokens/brand-tokens';

interface MockTerminal {
  options: Record<string, unknown>;
  write: jest.Mock;
  clear: jest.Mock;
  focus: jest.Mock;
  dispose: jest.Mock;
  open: jest.Mock;
  resize: jest.Mock;
  dataListener: ((value: string) => void) | null;
}

describe('FpcTerminalComponent', () => {
  let fixture: ComponentFixture<FpcTerminalComponent>;
  let component: FpcTerminalComponent;

  function mock(): MockTerminal {
    return component.instance as unknown as MockTerminal;
  }

  function stubContainerSize(width: number, height: number): void {
    const container = (fixture.nativeElement as HTMLElement).querySelector('.fpc-terminal__container') as HTMLElement;

    container.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  }

  beforeEach(async () => {
    (Terminal as unknown as { instances: unknown[] }).instances = [];
    fixture = TestBed.createComponent(FpcTerminalComponent);
    component = fixture.componentInstance;
    component.write('before-init');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('opens xterm in its container with brand theme and flushes buffered output', () => {
    expect(mock()).toBeTruthy();
    expect(mock().open).toHaveBeenCalledWith(
      (fixture.nativeElement as HTMLElement).querySelector('.fpc-terminal__container'),
    );
    expect(mock().options['fontSize']).toBe(13);
    expect(mock().options['theme']).toEqual(fpcTerminalTheme(fpcReadBrandPalette()));
    expect(mock().write).toHaveBeenCalledWith('before-init');
  });

  it('forwards user input through (data)', () => {
    const spy = jest.fn();

    component.data.subscribe(spy);
    mock().dataListener?.('ls -la\r');

    expect(spy).toHaveBeenCalledWith('ls -la\r');
  });

  it('delegates write / clear / focus', () => {
    component.write('hello');
    component.clear();
    component.focus();

    expect(mock().write).toHaveBeenCalledWith('hello');
    expect(mock().clear).toHaveBeenCalled();
    expect(mock().focus).toHaveBeenCalled();
  });

  it('fits the grid to the container using the renderer cell size and emits (sizeChange) once per size', () => {
    const spy = jest.fn();

    component.sizeChange.subscribe(spy);
    stubContainerSize(800, 320);
    component.fit();
    component.fit();

    expect(mock().resize).toHaveBeenCalledWith(100, 20);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ cols: 100, rows: 20 });
  });

  it('does not resize while hidden or when the container has no size', () => {
    const spy = jest.fn();

    component.sizeChange.subscribe(spy);
    stubContainerSize(0, 0);
    component.fit();

    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    stubContainerSize(800, 320);
    component.fit();

    expect(spy).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('fpc-terminal--hidden');
  });

  it('applies font size changes and disposes on destroy', () => {
    fixture.componentRef.setInput('fontSize', 16);
    fixture.detectChanges();
    expect(mock().options['fontSize']).toBe(16);

    const terminal = mock();

    fixture.destroy();
    expect(terminal.dispose).toHaveBeenCalled();
    expect(component.instance).toBeNull();
  });
});

describe('fpcTerminalGrid', () => {
  it('computes cols / rows with minimums', () => {
    expect(fpcTerminalGrid(805, 330, 8, 16)).toEqual({ cols: 100, rows: 20 });
    expect(fpcTerminalGrid(4, 4, 8, 16)).toEqual({ cols: 2, rows: 1 });
    expect(fpcTerminalGrid(800, 300, 0, 16)).toEqual({ cols: 0, rows: 0 });
  });
});
