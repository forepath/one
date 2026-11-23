import { TestBed } from '@angular/core/testing';

import { WorkspaceChipComponent } from './workspace-chip.component';

describe('WorkspaceChipComponent', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.configureTestingModule({ imports: [WorkspaceChipComponent] }).createComponent(
      WorkspaceChipComponent,
    );

    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('shows the building icon by default (boards)', () => {
    const el = render({ name: 'Alpha' });

    expect(el.querySelector('i')?.className).toBe('bi bi-building');
    expect(el.textContent).toContain('Alpha');
  });

  it('takes another icon for combined views', () => {
    expect(render({ name: 'All workspaces', icon: 'buildings' }).querySelector('i')?.className).toBe('bi bi-buildings');
  });
});
