import { TestBed } from '@angular/core/testing';

import { FpcEmptyStateComponent } from './empty-state.component';

describe('FpcEmptyStateComponent loading', () => {
  it('shows a spinner in place of the icon, in the same box', () => {
    const fixture = TestBed.createComponent(FpcEmptyStateComponent);

    fixture.componentRef.setInput('icon', 'inbox');
    fixture.componentRef.setInput('title', 'Loading plans');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.bi-inbox')).not.toBeNull();
    expect(el.querySelector('fpc-spinner')).toBeNull();

    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect(el.querySelector('.bi-inbox')).toBeNull();
    expect(el.querySelector('fpc-spinner')).not.toBeNull();
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.fpc-empty-state__title')?.textContent).toContain('Loading plans');
  });
});
