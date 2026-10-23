import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcVncChannelAdapter } from './vnc-channel';
import { FPC_VNC_RFB_LOADER, FpcVncViewerComponent, type FpcRfbInstance } from './vnc-viewer.component';

class FakeRfb implements FpcRfbInstance {
  static instances: FakeRfb[] = [];
  scaleViewport = false;
  resizeSession = false;
  clipViewport = false;
  viewOnly = false;
  background = '';
  readonly listeners = new Map<string, (event: Event & { detail?: Record<string, unknown> }) => void>();
  disconnect = jest.fn();
  sendCtrlAltDel = jest.fn();
  sendCredentials = jest.fn();
  focus = jest.fn();

  constructor(
    readonly target: HTMLElement,
    readonly channel: unknown,
  ) {
    FakeRfb.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event & { detail?: Record<string, unknown> }) => void): void {
    this.listeners.set(type, listener);
  }

  fire(type: string, detail: Record<string, unknown> = {}): void {
    this.listeners.get(type)?.(Object.assign(new Event(type), { detail }));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FpcVncChannelAdapter', () => {
  it('relays bytes both ways with WebSocket semantics', () => {
    const sent: ArrayBuffer[] = [];
    const transport = { send: (data: ArrayBuffer) => sent.push(data), close: jest.fn() };
    const channel = new FpcVncChannelAdapter(transport);
    const received: number[][] = [];
    const closed: unknown[] = [];

    // Bytes before noVNC attached are kept.
    channel.deliver(new Uint8Array([1, 2]));
    channel.onmessage = (event) => received.push([...new Uint8Array(event.data)]);
    channel.onclose = (event) => closed.push(event);
    channel.send(new Uint8Array([9]));
    expect(sent).toEqual([]);
    channel.opened();
    expect(channel.readyState).toBe('open');
    expect(received).toEqual([[1, 2]]);

    // noVNC reuses its send buffer: the adapter copies.
    const buffer = new Uint8Array([5, 6, 7]);

    channel.send(new Uint8Array(buffer.buffer, 1, 2));
    buffer[1] = 0;
    expect([...new Uint8Array(sent[0])]).toEqual([6, 7]);
    channel.deliver(new Uint8Array([3]).buffer);
    expect(received).toEqual([[1, 2], [3]]);

    channel.close();
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(channel.readyState).toBe('closed');
    expect(closed).toEqual([{ code: 1000, reason: 'closed', wasClean: true }]);
    channel.failed('late');
    expect(closed).toHaveLength(1);
  });

  it('has every property noVNC checks on a raw channel', () => {
    const channel = new FpcVncChannelAdapter({ send: jest.fn(), close: jest.fn() });
    const props = [...Object.keys(channel), ...Object.getOwnPropertyNames(Object.getPrototypeOf(channel))];

    for (const prop of ['send', 'close', 'binaryType', 'onerror', 'onmessage', 'onopen', 'protocol', 'readyState'])
      expect(props).toContain(prop);
  });
});

describe('FpcVncViewerComponent', () => {
  let fixture: ComponentFixture<FpcVncViewerComponent>;
  let ref: ComponentRef<FpcVncViewerComponent>;

  beforeEach(async () => {
    FakeRfb.instances = [];
    await TestBed.configureTestingModule({
      imports: [FpcVncViewerComponent],
      providers: [{ provide: FPC_VNC_RFB_LOADER, useValue: async () => FakeRfb }],
    }).compileComponents();
    fixture = TestBed.createComponent(FpcVncViewerComponent);
    ref = fixture.componentRef;
    ref.setInput('placeholder', 'Connecting…');
    fixture.detectChanges();
  });

  it('connects noVNC to the channel, scales and reports state', async () => {
    const channel = new FpcVncChannelAdapter({ send: jest.fn(), close: jest.fn() });
    const connected = jest.fn();
    const disconnected = jest.fn();

    fixture.componentInstance.connected.subscribe(connected);
    fixture.componentInstance.disconnected.subscribe(disconnected);
    ref.setInput('channel', channel);
    fixture.detectChanges();
    await flush();

    const rfb = FakeRfb.instances[0];

    expect(rfb.channel).toBe(channel);
    expect(rfb.scaleViewport).toBe(true);
    expect(fixture.componentInstance.state()).toBe('connecting');
    expect(fixture.nativeElement.textContent).toContain('Connecting…');

    rfb.fire('connect');
    fixture.detectChanges();
    expect(connected).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Connecting…');

    ref.setInput('viewOnly', true);
    fixture.detectChanges();
    expect(rfb.viewOnly).toBe(true);
    fixture.componentInstance.sendCtrlAltDel();
    expect(rfb.sendCtrlAltDel).toHaveBeenCalled();

    rfb.fire('disconnect', { clean: true });
    expect(disconnected).toHaveBeenCalledWith({ clean: true });
    expect(fixture.componentInstance.state()).toBe('disconnected');
  });

  it('reconnects on a new channel and disconnects on null / destroy', async () => {
    ref.setInput('channel', new FpcVncChannelAdapter({ send: jest.fn(), close: jest.fn() }));
    fixture.detectChanges();
    await flush();
    ref.setInput('channel', new FpcVncChannelAdapter({ send: jest.fn(), close: jest.fn() }));
    fixture.detectChanges();
    await flush();

    expect(FakeRfb.instances).toHaveLength(2);
    expect(FakeRfb.instances[0].disconnect).toHaveBeenCalled();

    ref.setInput('channel', null);
    fixture.detectChanges();
    await flush();
    expect(FakeRfb.instances[1].disconnect).toHaveBeenCalled();
    expect(fixture.componentInstance.state()).toBe('idle');
    fixture.destroy();
  });
});
