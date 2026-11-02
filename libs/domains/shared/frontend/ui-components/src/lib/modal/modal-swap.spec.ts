import { signal } from '@angular/core';

import { FPC_MODAL_TRANSITION_MS, FpcModalSwap } from './modal-swap';

describe('FpcModalSwap (modal "flapping": hide, overlay, back)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function root(): { host: HTMLElement; input: HTMLInputElement; scroller: HTMLElement } {
    const host = document.createElement('div');

    host.innerHTML = '<div class="modal"><div class="modal-body"><div class="list"></div><input /></div></div>';
    document.body.appendChild(host);

    return {
      host,
      input: host.querySelector('input')!,
      scroller: host.querySelector('.list')!,
    };
  }

  it('hides the underlying modal first and shows the overlay after the fade', () => {
    const overlay = signal(false);
    const swap = new FpcModalSwap(overlay);

    swap.toOverlay();

    expect(swap.suspended()).toBe(true);
    expect(overlay()).toBe(false);

    jest.advanceTimersByTime(FPC_MODAL_TRANSITION_MS);
    expect(overlay()).toBe(true);

    // A second request while swapped is ignored.
    swap.toOverlay();
    expect(swap.suspended()).toBe(true);
  });

  it('back() closes the overlay and brings the underlying modal back after the current event', () => {
    const overlay = signal(false);
    const swap = new FpcModalSwap(overlay);

    swap.toOverlay();
    jest.advanceTimersByTime(FPC_MODAL_TRANSITION_MS);
    swap.back();

    expect(overlay()).toBe(false);
    expect(swap.suspended()).toBe(true);

    jest.advanceTimersByTime(0);
    expect(swap.suspended()).toBe(false);
  });

  it('back() restores the focused control and the scroll offsets inside the root', () => {
    const { host, input, scroller } = root();
    const overlay = signal(false);
    const swap = new FpcModalSwap(overlay);

    input.focus();
    // jsdom has no layout: a writable scrollTop stands in for a scrolled list.
    Object.defineProperty(scroller, 'scrollTop', { value: 40, writable: true, configurable: true });
    swap.toOverlay(host);
    jest.advanceTimersByTime(FPC_MODAL_TRANSITION_MS);
    input.blur();
    scroller.scrollTop = 0;

    swap.back(host);
    jest.advanceTimersByTime(1);
    expect(swap.suspended()).toBe(false);
    expect(scroller.scrollTop).toBe(0);

    // The reopened dialog takes its own initial focus (as `fpc-modal` does), then the view state comes back.
    const dialog = host.querySelector('.modal') as HTMLElement;

    dialog.tabIndex = -1;
    dialog.focus();

    expect(document.activeElement).toBe(input);
    expect(scroller.scrollTop).toBe(40);
    host.remove();
  });

  it('finish() closes the overlay without bringing the underlying modal back; reset() cancels a pending swap', () => {
    const overlay = signal(false);
    const swap = new FpcModalSwap(overlay);

    swap.toOverlay();
    jest.advanceTimersByTime(FPC_MODAL_TRANSITION_MS);
    swap.finish();

    expect(overlay()).toBe(false);
    expect(swap.suspended()).toBe(false);

    swap.toOverlay();
    swap.reset();
    jest.advanceTimersByTime(FPC_MODAL_TRANSITION_MS);
    expect(overlay()).toBe(false);
    expect(swap.suspended()).toBe(false);
  });

  it('back() without a pending swap does nothing', () => {
    const overlay = signal(true);
    const swap = new FpcModalSwap(overlay);

    swap.back();
    expect(overlay()).toBe(true);
  });
});
