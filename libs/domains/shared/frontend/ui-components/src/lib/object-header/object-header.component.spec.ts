import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FpcDensityService } from '../density/density.service';
import { FpcMenuItem } from '../menu/menu.types';
import { FpcObjectHeaderComponent } from './object-header.component';

describe('FpcObjectHeaderComponent', () => {
  let fixture: ComponentFixture<FpcObjectHeaderComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(FpcObjectHeaderComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('title', 'web-1');
    fixture.componentRef.setInput('crumbs', [
      { label: 'Cluster', link: '/resources/cluster' },
      { label: 'Site eu', link: ['/resources/site', 'eu'] },
      { label: 'web-1' },
    ]);
  });

  it('renders crumbs as breadcrumb items with links except the current object', () => {
    fixture.detectChanges();
    const items = host.querySelectorAll('fpc-breadcrumb-item');
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/resources/cluster');
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/resources/site/eu');
    expect(items[2].querySelector('a, button')).toBeNull();
    expect(items[2].getAttribute('aria-current')).toBe('page');
    expect(items[2].classList).toContain('active');
    // Truncating crumbs keep their full label as the tooltip; the shared chevron divider.
    expect(items[1].getAttribute('title')).toBe('Site eu');
    expect(items[2].getAttribute('title')).toBe('web-1');
    expect(
      (host.querySelector('.fpc-breadcrumbs__list') as HTMLElement).style.getPropertyValue('--bs-breadcrumb-divider'),
    ).toBe('"›"');
    expect(host.querySelector('h1')?.textContent).toContain('web-1');
  });

  it('renders link-less ancestors as plain text, never as dead buttons', () => {
    fixture.componentRef.setInput('crumbs', [
      { label: 'Cluster', link: '/resources/cluster', icon: 'diagram-3' },
      { label: 'Unassigned' },
      { label: 'web-1', title: 'web-1 (draft)' },
    ]);
    fixture.detectChanges();
    const list = host.querySelector('.fpc-breadcrumbs__list') as HTMLElement;
    expect(list.querySelectorAll(':scope > button, .fpc-breadcrumb-item > button')).toHaveLength(0);
    expect(host.querySelectorAll('fpc-breadcrumb-item')).toHaveLength(2);
    const plain = list.querySelector(':scope > span.fpc-breadcrumb-item') as HTMLElement;
    expect(plain.textContent?.trim()).toBe('Unassigned');
    expect(plain.getAttribute('role')).toBe('listitem');
    expect(plain.getAttribute('title')).toBe('Unassigned');
    expect(plain.hasAttribute('aria-current')).toBe(false);
    expect(host.querySelector('fpc-breadcrumb-item .fpc-breadcrumb-item__icon.bi-diagram-3')).not.toBeNull();
    expect(host.querySelector('fpc-breadcrumb-item.active')?.getAttribute('title')).toBe('web-1 (draft)');
  });

  it('shows the draft mark and follows the app density', () => {
    fixture.componentRef.setInput('mark', true);
    fixture.detectChanges();
    expect(host.querySelector('.fpc-object-header__mark')).not.toBeNull();
    expect(host.classList).toContain('fpc-object-header--compact');

    TestBed.inject(FpcDensityService).set('comfortable');
    fixture.detectChanges();
    expect(host.classList).not.toContain('fpc-object-header--compact');
  });

  it('emits the chosen "More" entry', () => {
    const items: FpcMenuItem[] = [
      { id: 'drain', label: 'Drain' },
      { id: 'leave', label: 'Leave', danger: true, dividerBefore: true },
    ];
    const chosen: string[] = [];
    fixture.componentRef.setInput('moreItems', items);
    fixture.componentInstance.moreSelect.subscribe((item) => chosen.push(item.id));
    fixture.detectChanges();

    (host.querySelector('[data-testid="fpc-object-header-more"] [fpcDropdownTrigger]') as HTMLElement).click();
    fixture.detectChanges();
    (host.querySelector('[data-item-id="leave"] a') as HTMLElement).click();
    expect(chosen).toEqual(['leave']);
  });

  it('groups crumbs + title in the head and renders an icon-only, labelled "More"', () => {
    fixture.componentRef.setInput('moreItems', [{ id: 'drain', label: 'Drain' }]);
    fixture.componentRef.setInput('moreLabel', 'More actions');
    fixture.detectChanges();

    const head = host.querySelector('.fpc-object-header__head');
    expect(head?.querySelector('fpc-breadcrumbs')).not.toBeNull();
    expect(head?.querySelector('h1')).not.toBeNull();
    // The tab slot is a sibling of the padded head (full-bleed), not inside it.
    expect(host.querySelector('.fpc-object-header__tabs')?.parentElement).toBe(host);
    expect(head?.contains(host.querySelector('.fpc-object-header__tabs'))).toBe(false);

    const more = host.querySelector('[data-testid="fpc-object-header-more"] button') as HTMLButtonElement;
    expect(more.getAttribute('aria-label')).toBe('More actions');
    expect(more.getAttribute('title')).toBe('More actions');
    expect(more.textContent?.trim()).toBe('');
    // Menu-button semantics wired to the dropdown's open state.
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.hasAttribute('aria-controls')).toBe(false);

    more.click();
    fixture.detectChanges();

    const menuId = more.getAttribute('aria-controls');

    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(menuId).toBeTruthy();
    expect(host.querySelector('[role="menu"]')?.id).toBe(menuId);
  });
});
