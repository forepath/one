import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  filterReferenceOptions,
  isReferenceAccessDenied,
  mergeReferenceOptions,
  ReferenceComboboxComponent,
  type ReferenceComboboxOption,
} from './reference-combobox.component';
import { commandAgentLoader } from './reference-loaders';

const OPTIONS: ReferenceComboboxOption[] = [
  { value: 'main', detail: 'Local branch' },
  { value: 'feat/login', detail: 'Local branch' },
  { value: 'origin/release', detail: 'Remote branch' },
];

describe('reference combobox helpers', () => {
  it('filters on value, label and detail (case-insensitive) and caps the list', () => {
    expect(filterReferenceOptions(OPTIONS, 'LOGIN', 20).map((o) => o.value)).toEqual(['feat/login']);
    expect(filterReferenceOptions(OPTIONS, 'remote', 20).map((o) => o.value)).toEqual(['origin/release']);
    expect(filterReferenceOptions(OPTIONS, '', 2)).toHaveLength(2);
  });

  it('merges lists without duplicate values (first list wins)', () => {
    expect(mergeReferenceOptions([{ value: 'a', detail: 'x' }], [{ value: 'a' }, { value: 'b' }])).toEqual([
      { value: 'a', detail: 'x' },
      { value: 'b' },
    ]);
  });

  it('treats 401 / 403 as "may not list", everything else as an empty list', () => {
    expect(isReferenceAccessDenied(new HttpErrorResponse({ status: 403 }))).toBe(true);
    expect(isReferenceAccessDenied(new HttpErrorResponse({ status: 401 }))).toBe(true);
    expect(isReferenceAccessDenied(new HttpErrorResponse({ status: 500 }))).toBe(false);
    expect(isReferenceAccessDenied(new Error('x'))).toBe(false);
  });

  it('command agents come from the environment-scoped agent list', (done) => {
    const service = {
      listAgentAgents: jest.fn(() =>
        of({
          agents: [
            { name: 'build', mode: 'primary' as const, builtIn: true },
            { name: 'reviewer', mode: 'subagent' as const, builtIn: false, description: 'Reviews code' },
          ],
        }),
      ),
    };

    commandAgentLoader(service, 'client-1', 'env-1', 'Built-in agent')().subscribe((options) => {
      expect(service.listAgentAgents).toHaveBeenCalledWith('client-1', 'env-1');
      expect(options).toEqual([
        { value: 'build', detail: 'Built-in agent' },
        { value: 'reviewer', detail: 'Reviews code' },
      ]);
      done();
    });
  });
});

describe('ReferenceComboboxComponent', () => {
  let fixture: ComponentFixture<ReferenceComboboxComponent>;
  let component: ReferenceComboboxComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ReferenceComboboxComponent] }).compileComponents();
    fixture = TestBed.createComponent(ReferenceComboboxComponent);
    component = fixture.componentInstance;
  });

  it('renders a typeahead over the given list; focus lists all, typing filters and writes the value', () => {
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('fpc-typeahead-select')).not.toBeNull();

    component.setOpen(true);
    expect(component.visibleOptions().map((o) => o.value)).toEqual(['main', 'feat/login', 'origin/release']);

    component.type('feat');
    expect(component.value()).toBe('feat');
    expect(component.visibleOptions().map((o) => o.value)).toEqual(['feat/login']);
  });

  it('keeps free text: a value the list does not have is stored as typed', () => {
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.detectChanges();

    component.type('hotfix/new');
    expect(component.value()).toBe('hotfix/new');
    expect(component.visibleOptions()).toEqual([]);
  });

  it('picking stores the option value and closes the menu', () => {
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.detectChanges();
    component.setOpen(true);

    const event = new Event('mousedown');
    const prevent = jest.spyOn(event, 'preventDefault');

    component.pick(OPTIONS[2], event);

    expect(prevent).toHaveBeenCalled();
    expect(component.value()).toBe('origin/release');
    expect(component.open()).toBe(false);
  });

  it('asks the loader once, on the first open, and merges it after the static options', () => {
    const loader = jest.fn(() => of([{ value: 'remote-only' }, { value: 'main' }]));

    fixture.componentRef.setInput('options', [{ value: 'main' }]);
    fixture.componentRef.setInput('loader', loader);
    fixture.detectChanges();

    expect(loader).not.toHaveBeenCalled();
    component.setOpen(true);
    component.setOpen(false);
    component.setOpen(true);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(component.visibleOptions().map((o) => o.value)).toEqual(['main', 'remote-only']);
  });

  it('asks again when the loader (scope) changes', () => {
    const first = jest.fn(() => of([{ value: 'a' }]));
    const second = jest.fn(() => of([{ value: 'b' }]));

    fixture.componentRef.setInput('loader', first);
    fixture.detectChanges();
    component.setOpen(true);
    component.setOpen(false);

    fixture.componentRef.setInput('loader', second);
    fixture.detectChanges();
    component.setOpen(true);

    expect(second).toHaveBeenCalledTimes(1);
    expect(component.visibleOptions().map((o) => o.value)).toEqual(['b']);
  });

  it('401 / 403: menu stays closed, the hint shows, typing still writes the value (never an error)', () => {
    fixture.componentRef.setInput('loader', () => throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.detectChanges();

    component.setOpen(true);
    fixture.detectChanges();

    expect(component.isDenied()).toBe(true);
    expect(component.open()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="ref-combobox-denied"]')?.textContent).toContain(
      'Type the value',
    );

    component.setOpen(true);
    expect(component.open()).toBe(false);

    component.type('main');
    expect(component.value()).toBe('main');
  });

  it('without a list or a loader (nothing to list yet) the menu stays closed: a plain input', () => {
    fixture.detectChanges();

    component.setOpen(true);
    expect(component.open()).toBe(false);

    component.type('owner/repo');
    expect(component.value()).toBe('owner/repo');
  });

  it('other errors are an empty list (no hint)', () => {
    fixture.componentRef.setInput('loader', () => throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.detectChanges();

    component.setOpen(true);

    expect(component.isDenied()).toBe(false);
    expect(component.visibleOptions()).toEqual([]);
  });
});
