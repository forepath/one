import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcPagerComponent } from './pager.component';

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
});
