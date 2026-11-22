import { TestBed } from '@angular/core/testing';
import {
  AdminSettingsFacade,
  type SettingStateView,
  type SettingsOverviewResponse,
} from '@forepath/shared/frontend/data-access-settings';
import { BehaviorSubject } from 'rxjs';

import { SETTINGS_ADMIN_LABELS } from '../settings-labels';

import { SettingsManagerComponent } from './settings-manager.component';

const setting = (overrides: Partial<SettingStateView> = {}): SettingStateView => ({
  key: 'SMTP_HOST',
  category: 'email',
  type: 'string',
  scope: 'tenant',
  sensitive: false,
  restartRequired: false,
  value: null,
  hasOverride: false,
  inheritedValue: 'mailhog',
  hasInheritedValue: true,
  inheritedSource: 'environment',
  effectiveSource: 'environment',
  ...overrides,
});

describe('SettingsManagerComponent', () => {
  const overview$ = new BehaviorSubject<SettingsOverviewResponse | null>(null);
  const facade = {
    overview$,
    loading$: new BehaviorSubject(false),
    error$: new BehaviorSubject<string | null>(null),
    pendingKeys$: new BehaviorSubject<string[]>([]),
    settingErrors$: new BehaviorSubject<Record<string, string>>({}),
    load: jest.fn(),
    save: jest.fn(),
    reset: jest.fn(),
    clearError: jest.fn(),
  };
  let component: SettingsManagerComponent;
  const overview = (patch: Partial<SettingsOverviewResponse> = {}): SettingsOverviewResponse => ({
    level: 'global',
    tenantId: null,
    homeTenantId: 'default',
    canManageGlobal: true,
    viewableTenants: ['default', 'acme'],
    categories: ['email', 'empty'],
    settings: [
      setting(),
      setting({ key: 'SMTP_PASSWORD', type: 'secret', sensitive: true, inheritedValue: null }),
      setting({ key: 'SMTP_PORT', type: 'integer', value: '2525', hasOverride: true, effectiveSource: 'global' }),
    ],
    ...patch,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: AdminSettingsFacade, useValue: facade },
        {
          provide: SETTINGS_ADMIN_LABELS,
          useValue: {
            categories: { email: { label: 'Email', section: 'Communication' } },
            settings: { SMTP_HOST: { title: 'SMTP host', description: 'Mail server' } },
          },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new SettingsManagerComponent());
    overview$.next(overview());
  });

  it('loads the backend default level on init', () => {
    component.ngOnInit();
    expect(facade.load).toHaveBeenCalledWith(null);
  });

  it('builds categories with settings only and resolves labels', () => {
    expect(component.categories().map((category) => category.id)).toEqual(['email']);
    expect(component.categories()[0]).toMatchObject({ label: 'Email', section: 'Communication' });
    expect(component.title(setting())).toBe('SMTP host');
    expect(component.title(setting({ key: 'UNLABELLED' }))).toBe('UNLABELLED');
  });

  it('filters by key, title and description', () => {
    component.search.set('mail server');
    expect(component.categories()[0].settings.map((entry) => entry.key)).toEqual(['SMTP_HOST']);
    component.search.set('nothing-matches');
    expect(component.categories()).toEqual([]);
  });

  it('saves only changed values and never prefills secrets', () => {
    const host = setting();
    const secret = setting({ key: 'SMTP_PASSWORD', type: 'secret', sensitive: true });

    expect(component.draftValue(host)).toBe('mailhog');
    expect(component.draftValue(secret)).toBe('');

    component.save(host);
    expect(facade.save).not.toHaveBeenCalled();

    component.setDraft(host, 'smtp.example.com');
    expect(component.isDirty(host)).toBe(true);
    component.save(host);
    expect(facade.save).toHaveBeenCalledWith('SMTP_HOST', 'smtp.example.com');
    expect(component.isDirty(host)).toBe(false);
  });

  it('resets only overridden settings', () => {
    component.reset(setting());
    expect(facade.reset).not.toHaveBeenCalled();

    component.reset(setting({ key: 'SMTP_PORT', hasOverride: true }));
    expect(facade.reset).toHaveBeenCalledWith('SMTP_PORT');
  });

  it('offers all tenants and every viewable tenant for global-view tenants', () => {
    expect(component.levelOptions().map((option) => option.id)).toEqual(['__global__', 'default', 'acme']);

    component.selectLevel(component.levelOptions()[2]);
    expect(facade.load).toHaveBeenCalledWith({ level: 'tenant', tenantId: 'acme' });
  });

  it('hides the level switch for a single tenant and without tenants', () => {
    overview$.next(
      overview({
        level: 'tenant',
        tenantId: 'acme',
        homeTenantId: 'acme',
        canManageGlobal: false,
        viewableTenants: ['acme'],
      }),
    );
    expect(component.levelOptions()).toEqual([]);

    overview$.next(overview({ homeTenantId: null, viewableTenants: [] }));
    expect(component.levelOptions()).toEqual([]);
  });

  it('describes what applies after a reset', () => {
    expect(component.inheritedHint(setting())).toBe('Default (Environment): mailhog');
    expect(
      component.inheritedHint(
        setting({ sensitive: true, inheritedValue: null, hasInheritedValue: true, inheritedSource: 'global' }),
      ),
    ).toBe('Default (All tenants): configured');
    expect(
      component.inheritedHint(
        setting({ inheritedValue: null, hasInheritedValue: false, inheritedSource: 'default', defaultValue: '1025' }),
      ),
    ).toBe('Default: 1025');
    expect(
      component.inheritedHint(setting({ inheritedValue: null, hasInheritedValue: true, inheritedSource: 'global' })),
    ).toBe('Default (All tenants): configured');
  });

  describe('image settings', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const image = (overrides: Partial<SettingStateView> = {}) =>
      setting({ key: 'BILLING_DOCUMENT_LOGO', type: 'image', maxLength: 64, inheritedValue: null, ...overrides });
    const readAs = (dataUri: string) => {
      const original = (globalThis as { FileReader: unknown }).FileReader;

      class FakeReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(): void {
          this.result = dataUri;
          this.onload?.();
        }
      }

      (globalThis as { FileReader: unknown }).FileReader = FakeReader;

      return () => ((globalThis as { FileReader: unknown }).FileReader = original);
    };
    const files = (type: string) => ({ item: () => new File(['x'], 'logo', { type }) }) as unknown as FileList;

    it('describes inherited images without printing the data URI', () => {
      expect(component.inheritedHint(image({ inheritedValue: logo }))).toBe('Default (Environment): image set');
      expect(component.inheritedHint(image({ hasInheritedValue: false }))).toBe('Default: no image');
    });

    it('previews the override, then the inherited image', () => {
      expect(component.imagePreview(image({ value: logo, hasOverride: true }))).toBe(logo);
      expect(component.imagePreview(image({ inheritedValue: logo }))).toBe(logo);
      expect(component.imagePreview(image({ value: '', hasOverride: true, inheritedValue: logo }))).toBeNull();
    });

    it('reads a picked image into the draft and saves it', () => {
      const restore = readAs(logo);
      const target = image();

      component.pickImage(target, files('image/png'));
      restore();

      expect(component.draftValue(target)).toBe(logo);
      component.save(target);
      expect(facade.save).toHaveBeenCalledWith('BILLING_DOCUMENT_LOGO', logo);
    });

    it('rejects unsupported and oversized files before uploading', () => {
      const target = image();

      component.pickImage(target, files('image/gif'));
      expect(component.settingError(target)).toContain('PNG, JPEG, WebP or SVG');

      const restore = readAs(`data:image/png;base64,${'A'.repeat(100)}`);

      component.pickImage(target, files('image/png'));
      restore();

      expect(component.settingError(target)).toContain('too large');
      expect(component.isDirty(target)).toBe(false);
    });

    it('saves an empty value to remove an inherited image at this level', () => {
      const target = image({ inheritedValue: logo });

      component.setDraft(target, '');

      expect(component.settingError(target)).toBeNull();
      expect(component.isDirty(target)).toBe(true);
      component.save(target);
      expect(facade.save).toHaveBeenCalledWith('BILLING_DOCUMENT_LOGO', '');
    });
  });

  it('keeps the color picker on a valid color', () => {
    const color = setting({ key: 'BILLING_DOCUMENT_BRAND_COLOR', type: 'color', defaultValue: '#32a852' });

    expect(component.colorPickerValue({ ...color, inheritedValue: null })).toBe('#32a852');
    expect(component.colorPickerValue({ ...color, inheritedValue: '#1D4ED8' })).toBe('#1d4ed8');
    component.pickColor(color, { target: { value: '#ff0000' } } as unknown as Event);
    expect(component.draftValue(color)).toBe('#ff0000');
  });
});
