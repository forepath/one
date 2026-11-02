import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcPagerComponent, fpcPagerWindow } from './pager.component';

describe('FpcPagerComponent', () => {
  let fixture: ComponentFixture<FpcPagerComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcPagerComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  const previous = () => host.querySelector('.fpc-pager__previous') as HTMLButtonElement;
  const next = () => host.querySelector('.fpc-pager__next') as HTMLButtonElement;

  it('renders the page and disables the buttons without neighbours', () => {
    fixture.componentRef.setInput('page', 3);
    fixture.componentRef.setInput('hasPrevious', false);
    fixture.componentRef.setInput('pageLabel', 'Page');
    fixture.detectChanges();

    expect(host.querySelector('.fpc-pager__page')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Page 3');
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    expect(host.querySelector('select')).toBeNull();
  });

  it('emits previous and next', () => {
    const emitted: string[] = [];

    fixture.componentInstance.previous.subscribe(() => emitted.push('previous'));
    fixture.componentInstance.next.subscribe(() => emitted.push('next'));
    fixture.componentRef.setInput('hasPrevious', true);
    fixture.componentRef.setInput('hasNext', true);
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();

    previous().click();
    next().click();

    expect(emitted).toEqual(['previous', 'next']);
    expect(host.querySelector('ul')?.classList).toContain('pagination-sm');
  });

  it('blocks navigation while disabled', () => {
    const emitted: string[] = [];

    fixture.componentInstance.next.subscribe(() => emitted.push('next'));
    fixture.componentRef.setInput('hasNext', true);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(next().disabled).toBe(true);
    next().click();
    expect(emitted).toEqual([]);
  });

  it('selects the page size', () => {
    const changes: Array<number | null> = [];

    fixture.componentInstance.pageSize.subscribe((value) => changes.push(value));
    fixture.componentRef.setInput('pageSizes', [25, 50, 100]);
    fixture.componentRef.setInput('pageSize', 50);
    fixture.detectChanges();

    const select = host.querySelector('select') as HTMLSelectElement;

    expect(select.options.length).toBe(3);
    expect(select.value).toBe('50');

    select.value = '100';
    select.dispatchEvent(new Event('change'));

    expect(changes).toEqual([100]);
    expect(fixture.componentInstance.pageSize()).toBe(100);
  });

  it('puts arrows, page label and page-size select on the same control tier', () => {
    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('pageSizes', [25, 50]);
    fixture.detectChanges();

    // `.pagination-sm .page-link` and `.form-select-sm` both resolve to `--fpc-control-height-sm`.
    expect(host.querySelector('ul')?.classList).toContain('pagination-sm');
    expect(host.querySelector('select')?.classList).toContain('form-select-sm');

    fixture.componentRef.setInput('size', 'md');
    fixture.detectChanges();

    expect(host.querySelector('ul')?.className).not.toMatch(/pagination-(sm|lg)/);
    expect(host.querySelector('select')?.className).not.toMatch(/form-select-(sm|lg)/);
  });

  it('shows "x–y of N" and numbered pages when the total is known', () => {
    fixture.componentRef.setInput('total', 130);
    fixture.componentRef.setInput('pageSize', 25);
    fixture.componentRef.setInput('page', 2);
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('26–50 of 130');
    expect(Array.from(host.querySelectorAll('.fpc-pager__number')).map((b) => b.textContent?.trim())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    (host.querySelector('[data-page="4"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(4);
    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('76–100 of 130');
    next().click();
    next().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(6);
    expect(next().disabled).toBe(true);
  });

  it('shows an open range without a total and moves with hasNext', () => {
    fixture.componentRef.setInput('pageSize', 25);
    fixture.componentRef.setInput('itemCount', 25);
    fixture.componentRef.setInput('hasNext', true);
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('1–25');
    next().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(2);
    expect(host.querySelector('[data-testid="fpc-pager-range"]')?.textContent?.trim()).toBe('26–50');
  });
});

describe('fpcPagerWindow', () => {
  it('keeps first / last and gaps around the current page', () => {
    expect(fpcPagerWindow(1, 3)).toEqual([1, 2, 3]);
    expect(fpcPagerWindow(6, 20)).toEqual([1, 'gap', 5, 6, 7, 'gap', 20]);
    expect(fpcPagerWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(fpcPagerWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });
});
