import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { ConnectionsShellComponent, connectionsSectionFromUrl } from './connections-shell.component';

@Component({ standalone: true, template: '<p data-testid="page">page</p>' })
class EmptyPageComponent {}

describe('ConnectionsShellComponent', () => {
  async function setup(url: string) {
    await TestBed.configureTestingModule({
      imports: [ConnectionsShellComponent],
      providers: [
        // The fixture is the shell itself, so its outlet renders the connection pages directly.
        provideRouter([
          { path: 'connections/deployments', component: EmptyPageComponent },
          { path: 'connections/atlassian', component: EmptyPageComponent },
        ]),
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);

    await router.navigateByUrl(url);

    const fixture = TestBed.createComponent(ConnectionsShellComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, router };
  }

  it('resolves the section from the url', () => {
    expect(connectionsSectionFromUrl('/connections/atlassian?x=1')).toBe('atlassian');
    expect(connectionsSectionFromUrl('/connections/deployments')).toBe('deployments');
    expect(connectionsSectionFromUrl('/connections')).toBe('deployments');
  });

  it('shows both connection kinds in the left rail and marks the routed one active', async () => {
    const { fixture } = await setup('/connections/atlassian');
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLElement[];

    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['CI/CD', 'Atlassian']);
    expect(fixture.componentInstance.activeSection()).toBe('atlassian');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="page"]')).toHaveLength(1);
  });

  it('navigates to the selected connection kind', async () => {
    const { fixture, router } = await setup('/connections/deployments');
    const navigate = jest.spyOn(router, 'navigate');

    fixture.componentInstance.onSelectSection('atlassian');
    fixture.componentInstance.onSelectSection('deployments');
    fixture.componentInstance.onSelectSection('unknown');

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/connections', 'atlassian']);
  });

  it('switches to a horizontal tab bar on phone widths', async () => {
    const original = window.matchMedia;

    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;

    try {
      const { fixture } = await setup('/connections/deployments');

      expect(fixture.componentInstance.phone()).toBe(true);
      expect(fixture.nativeElement.querySelector('fpc-tab-group').classList).toContain('fpc-tab-group--horizontal');
    } finally {
      window.matchMedia = original;
    }
  });
});
