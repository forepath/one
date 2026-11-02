import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OpencodeBuiltinProvider } from '@forepath/agenstra/shared/util-opencode-providers';

import { ProviderModelSelectComponent } from './provider-model-select.component';

const PROVIDERS: OpencodeBuiltinProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    env: [],
    models: [
      { id: 'claude-a', name: 'Claude A' },
      { id: 'claude-b', name: 'claude-b' },
    ],
  } as OpencodeBuiltinProvider,
  { id: 'local', name: 'Local', env: [], models: [] } as OpencodeBuiltinProvider,
];

describe('ProviderModelSelectComponent', () => {
  let fixture: ComponentFixture<ProviderModelSelectComponent>;
  let component: ProviderModelSelectComponent;
  let emitted: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProviderModelSelectComponent] }).compileComponents();
    fixture = TestBed.createComponent(ProviderModelSelectComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.valueChange.subscribe((v) => emitted.push(v));
  });

  it('shows the provider + model picker for a catalog provider and resolves the stored value', () => {
    fixture.componentRef.setInput('providers', PROVIDERS);
    fixture.componentRef.setInput('value', 'anthropic/claude-b');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="provider-model-picker"]')).not.toBeNull();
    expect(component.draftProviderId()).toBe('anthropic');
    expect(component.draftModelId()).toBe('claude-b');
    expect(component.modelOptions().map((m) => m.id)).toEqual(['claude-a', 'claude-b']);
  });

  it('emits provider/model once both are picked (a new provider clears the model)', () => {
    fixture.componentRef.setInput('providers', PROVIDERS);
    fixture.detectChanges();

    component.onProviderChange('anthropic');
    component.onModelChange('claude-a');

    expect(emitted).toEqual(['', 'anthropic/claude-a']);
  });

  it('a provider without catalog models takes a typed model id', () => {
    fixture.componentRef.setInput('providers', PROVIDERS);
    fixture.detectChanges();

    component.onProviderChange('local');
    component.onModelChange('my-model');

    expect(component.modelOptions()).toEqual([]);
    expect(emitted.at(-1)).toBe('local/my-model');
  });

  it('falls back to free text when the catalog is empty or the provider is unknown (value kept)', () => {
    fixture.componentRef.setInput('providers', []);
    fixture.componentRef.setInput('value', 'custom/model');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="provider-model-text"]')).not.toBeNull();

    fixture.componentRef.setInput('providers', PROVIDERS);
    fixture.detectChanges();
    expect(component.usesPicker()).toBe(false);
  });
});
