import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AuthService } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { WorkspaceUserSelectComponent } from './workspace-user-select.component';

describe('WorkspaceUserSelectComponent', () => {
  let fixture: ComponentFixture<WorkspaceUserSelectComponent>;
  let component: WorkspaceUserSelectComponent;
  let authService: { listUsers: jest.Mock };

  beforeEach(async () => {
    authService = {
      listUsers: jest.fn(() =>
        of([{ id: 'u-1', email: 'ada@example.test', role: 'user', createdAt: '', updatedAt: '' }]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceUserSelectComponent],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compileComponents();
  });

  function create(): void {
    fixture = TestBed.createComponent(WorkspaceUserSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders a typeahead while nothing is picked', () => {
    create();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-user-typeahead"]')).not.toBeNull();
  });

  it('searches the user directory with { search, limit: 20 } after 300 ms', fakeAsync(() => {
    create();
    component.onSearchChange('ada');
    fixture.detectChanges();
    tick(299);
    expect(authService.listUsers).not.toHaveBeenCalled();
    tick(1);

    expect(authService.listUsers).toHaveBeenCalledWith({ search: 'ada', limit: 20 });
    expect(component.searchResults().map((u) => u.email)).toEqual(['ada@example.test']);
  }));

  it('picking stores the email (the value the add-user call takes) and shows a chip; clear empties it', () => {
    create();
    const event = new Event('mousedown');

    component.pickUser({ id: 'u-1', email: 'ada@example.test' } as never, event);
    fixture.detectChanges();

    expect(component.email()).toBe('ada@example.test');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-user-chip"]')?.textContent).toContain(
      'ada@example.test',
    );

    component.clearSelection();
    expect(component.email()).toBe('');
  });

  it('401 / 403 emits denied (the caller falls back to the email field), no error', fakeAsync(() => {
    create();
    const denied = jest.fn();

    component.denied.subscribe(denied);
    authService.listUsers.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    component.onSearchChange('ada');
    fixture.detectChanges();
    tick(300);

    expect(denied).toHaveBeenCalledTimes(1);
    expect(component.searchResults()).toEqual([]);
    expect(component.suggestionsOpen()).toBe(false);
  }));

  it('other errors are an empty list without the fallback', fakeAsync(() => {
    create();
    const denied = jest.fn();

    component.denied.subscribe(denied);
    authService.listUsers.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    component.onSearchChange('ada');
    fixture.detectChanges();
    tick(300);

    expect(denied).not.toHaveBeenCalled();
    expect(component.searchResults()).toEqual([]);
  }));
});
