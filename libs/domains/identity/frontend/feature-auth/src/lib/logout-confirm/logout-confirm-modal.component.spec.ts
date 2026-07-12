import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of } from 'rxjs';

import { IdentityLogoutConfirmModalComponent } from './logout-confirm-modal.component';

describe('IdentityLogoutConfirmModalComponent', () => {
  let component: IdentityLogoutConfirmModalComponent;
  let fixture: ComponentFixture<IdentityLogoutConfirmModalComponent>;
  let mockAuthFacade: jest.Mocked<Partial<AuthenticationFacade>>;

  beforeEach(async () => {
    mockAuthFacade = {
      authenticationType$: of('users'),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityLogoutConfirmModalComponent],
      providers: [{ provide: AuthenticationFacade, useValue: mockAuthFacade }],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityLogoutConfirmModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows single-browser logout message in users mode', () => {
    expect(component.modalMessage()).toContain('this browser only');
  });

  it('emits invalidateAllSessions false by default', () => {
    const confirmed = jest.fn();

    component.confirmed.subscribe(confirmed);
    component.onConfirm();

    expect(confirmed).toHaveBeenCalledWith({ invalidateAllSessions: false });
  });

  it('emits invalidateAllSessions true when checkbox is selected', () => {
    const confirmed = jest.fn();

    component.logoutAllSessions.set(true);
    component.confirmed.subscribe(confirmed);
    component.onConfirm();

    expect(confirmed).toHaveBeenCalledWith({ invalidateAllSessions: true });
  });
});
