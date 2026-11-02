import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsoleAlertsFacade, createSilenceSuccess } from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverAlertSilenceModalComponent } from './alert-silence-modal.component';

describe('LoadweaverAlertSilenceModalComponent', () => {
  let fixture: ComponentFixture<LoadweaverAlertSilenceModalComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let actions$: Subject<unknown>;

  beforeEach(async () => {
    facade = facadeStub({ silenceSaving$: false, actionError$: null }, ['createSilence', 'clearActionError']);
    actions$ = new Subject();

    await TestBed.configureTestingModule({
      imports: [LoadweaverAlertSilenceModalComponent],
      providers: [
        { provide: ConsoleAlertsFacade, useValue: facade },
        { provide: Actions, useValue: actions$ },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverAlertSilenceModalComponent);
    fixture.componentRef.setInput('prefill', { rule: 'builtin:node-down', key: 'node/n1', project: null });
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  });

  it('starts from the alert and creates the silence', () => {
    const component = fixture.componentInstance;

    expect(component.rule).toBe('builtin:node-down');
    expect(component.key).toBe('node/n1');

    component.submit();
    expect(component.invalid()).toBe(component.needsReason);
    expect(facade['createSilence']).not.toHaveBeenCalled();

    component.reason = 'replacing the disk';
    component.submit();
    expect(facade['createSilence']).toHaveBeenCalledWith(
      expect.objectContaining({ rule: 'builtin:node-down', key: 'node/n1', reason: 'replacing the disk' }),
    );
  });

  it('needs a matcher and a window ending after its start', () => {
    const component = fixture.componentInstance;

    component.rule = '';
    component.key = '';
    component.reason = 'x';
    component.submit();
    expect(component.invalid()).toBe(component.needsMatcher);

    component.rule = 'rule:shop/*';
    component.endsAt = '2000-01-01T00:00';
    component.submit();
    expect(component.invalid()).toBe(component.badWindow);
  });

  it('closes once the silence is created', () => {
    actions$.next(
      createSilenceSuccess({
        silence: {
          id: 's',
          rule: null,
          project: null,
          key: 'k',
          reason: 'r',
          createdBy: null,
          startsAt: '',
          endsAt: '',
        },
      }),
    );

    expect(fixture.componentInstance.open()).toBe(false);
  });
});
