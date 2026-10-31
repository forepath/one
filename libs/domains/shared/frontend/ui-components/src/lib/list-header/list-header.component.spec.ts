import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcListHeaderComponent } from './list-header.component';

describe('FpcListHeaderComponent', () => {
  let fixture: ComponentFixture<FpcListHeaderComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcListHeaderComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function count(): string | null {
    return host.querySelector('[data-testid="fpc-list-header-count"]')?.textContent?.trim() ?? null;
  }

  it('renders the title and hides the count by default', () => {
    fixture.componentRef.setInput('title', 'Clusters');
    fixture.detectChanges();

    expect(host.querySelector('.fpc-list-header__title-text')?.textContent?.trim()).toBe('Clusters');
    expect(count()).toBeNull();
    expect(host.classList).toContain('fpc-list-header--sticky');
  });

  it('renders the count, and count / total while filtered', () => {
    fixture.componentRef.setInput('title', 'Clusters');
    fixture.componentRef.setInput('count', 4);
    fixture.detectChanges();
    expect(count()).toBe('4');

    fixture.componentRef.setInput('total', 4);
    fixture.detectChanges();
    expect(count()).toBe('4');

    fixture.componentRef.setInput('count', 1);
    fixture.detectChanges();
    expect(count()).toBe('1 / 4');
  });

  it('can opt out of the sticky position', () => {
    fixture.componentRef.setInput('sticky', false);
    fixture.detectChanges();

    expect(host.classList).not.toContain('fpc-list-header--sticky');
  });
});
