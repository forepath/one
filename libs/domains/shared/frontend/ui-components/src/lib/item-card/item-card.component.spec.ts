import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcItemCardComponent } from './item-card.component';

@Component({
  standalone: true,
  imports: [FpcItemCardComponent],
  template: `
    <fpc-item-card [title]="title">
      <span fpcItemCardTitle data-testid="title-extra">extra</span>
      <button fpcItemCardActions type="button" data-testid="action">Remove</button>
      <p data-testid="body">Fields</p>
    </fpc-item-card>
  `,
})
class HostComponent {
  title = 'Line 1';
}

describe('FpcItemCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders a non-sticky header with the projected title content and actions', () => {
    const header = host.querySelector('.fpc-item-card__header');

    expect(header?.querySelector('.fpc-list-header__title-text')?.textContent?.trim()).toBe('Line 1');
    expect(header?.classList).not.toContain('fpc-list-header--sticky');
    expect(header?.querySelector('[data-testid="title-extra"]')).not.toBeNull();
    expect(header?.querySelector('[data-testid="action"]')).not.toBeNull();
  });

  it('projects the default content into the padded body', () => {
    expect(host.querySelector('.fpc-item-card__body [data-testid="body"]')).not.toBeNull();
  });

  it('drops the header without a title', () => {
    fixture.componentInstance.title = '';
    fixture.detectChanges();

    expect(host.querySelector('.fpc-item-card__header')).toBeNull();
    expect(host.querySelector('.fpc-item-card__body [data-testid="body"]')).not.toBeNull();
  });
});
