import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminSettingsFacade,
  type SettingStateView,
  type SettingValueSource,
  type SettingsTarget,
} from '@forepath/shared/frontend/data-access-settings';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcModalComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcBadgeTone,
} from '@forepath/shared/frontend/ui-components';

import { SETTINGS_ADMIN_LABELS, type SettingsAdminLabels } from '../settings-labels';

interface SettingsCategoryView {
  id: string;
  label: string;
  section: string | undefined;
  icon: string | undefined;
  settings: SettingStateView[];
}

interface LevelOption {
  id: string;
  target: SettingsTarget;
  label: string;
  description: string;
}

/** Option id of the override for all tenants in the level switch. */
const GLOBAL_OPTION_ID = '__global__';
/** Image types the backend accepts for `image` settings (base64 data URIs). */
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const DEFAULT_IMAGE_MAX_LENGTH = 65536;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

@Component({
  selector: 'shared-settings-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcModalComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './settings-manager.component.html',
  styleUrl: './settings-manager.component.scss',
})
export class SettingsManagerComponent implements OnInit {
  private readonly facade = inject(AdminSettingsFacade);
  private readonly labels: SettingsAdminLabels = inject(SETTINGS_ADMIN_LABELS, { optional: true }) ?? {
    categories: {},
    settings: {},
  };

  readonly pageTitle = $localize`:@@featureSettings-title:Settings`;

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly pendingKeys = toSignal(this.facade.pendingKeys$, { initialValue: [] as string[] });
  readonly settingErrors = toSignal(this.facade.settingErrors$, { initialValue: {} as Record<string, string> });

  readonly activeCategory = signal<string | null>(null);
  readonly search = signal('');
  readonly levelSwitchOpen = signal(false);
  /** Edited values per setting key (absent = untouched). */
  readonly drafts = signal<Record<string, string>>({});
  /** Client-side errors of picked image files per setting key. */
  readonly fileErrors = signal<Record<string, string>>({});

  readonly imageAccept = IMAGE_MIME_TYPES.join(',');

  /** Level switch: only when the caller may configure more than the own tenant. */
  readonly levelOptions = computed<LevelOption[]>(() => {
    const overview = this.overview();

    if (!overview || !overview.homeTenantId) {
      return [];
    }

    const options: LevelOption[] = [];

    if (overview.canManageGlobal) {
      options.push({
        id: GLOBAL_OPTION_ID,
        target: { level: 'global' },
        label: $localize`:@@featureSettings-levelAllTenants:All tenants`,
        description: $localize`:@@featureSettings-levelAllTenantsDescription:Applies to every tenant without its own value`,
      });
    }

    for (const tenantId of overview.viewableTenants) {
      options.push({
        id: tenantId,
        target: { level: 'tenant', tenantId },
        label: tenantId,
        description:
          tenantId === overview.homeTenantId
            ? $localize`:@@featureSettings-levelOwnTenant:Your tenant`
            : $localize`:@@featureSettings-levelTenant:Tenant`,
      });
    }

    return options.length > 1 ? options : [];
  });

  readonly activeLevelId = computed(() => {
    const overview = this.overview();

    return overview?.level === 'global' ? GLOBAL_OPTION_ID : (overview?.tenantId ?? '');
  });

  readonly activeLevelLabel = computed(
    () => this.levelOptions().find((option) => option.id === this.activeLevelId())?.label ?? '',
  );

  readonly categories = computed<SettingsCategoryView[]>(() => {
    const overview = this.overview();

    if (!overview) {
      return [];
    }

    const query = this.search().trim().toLowerCase();

    return overview.categories
      .map((id) => {
        const label = this.labels.categories[id];

        return {
          id,
          label: label?.label ?? id,
          section: label?.section,
          icon: label?.icon,
          settings: overview.settings.filter(
            (setting) => setting.category === id && (!query || this.matches(setting, query)),
          ),
        };
      })
      .filter((category) => category.settings.length > 0);
  });

  readonly selectedCategoryId = computed(() => {
    const categories = this.categories();
    const active = this.activeCategory();

    return categories.some((category) => category.id === active) ? active : (categories[0]?.id ?? null);
  });

  ngOnInit(): void {
    this.facade.load(null);
  }

  private matches(setting: SettingStateView, query: string): boolean {
    const label = this.labels.settings[setting.key];

    return [setting.key, label?.title, label?.description].some((text) => text?.toLowerCase().includes(query));
  }

  title(setting: SettingStateView): string {
    return this.labels.settings[setting.key]?.title ?? setting.key;
  }

  description(setting: SettingStateView): string | null {
    return this.labels.settings[setting.key]?.description ?? null;
  }

  controlId(setting: SettingStateView): string {
    return `setting-${setting.key}`;
  }

  /** Value the control shows before editing: the override, otherwise what currently applies. */
  baseline(setting: SettingStateView): string {
    if (setting.sensitive) {
      return '';
    }

    return setting.value ?? setting.inheritedValue ?? '';
  }

  draftValue(setting: SettingStateView): string {
    return this.drafts()[setting.key] ?? this.baseline(setting);
  }

  setDraft(setting: SettingStateView, value: string | null | undefined): void {
    this.drafts.update((drafts) => ({ ...drafts, [setting.key]: value ?? '' }));
    this.setFileError(setting, null);
    this.facade.clearError(setting.key);
  }

  /** Reads a picked image into a base64 data URI draft (the backend validates the bytes again). */
  pickImage(setting: SettingStateView, files: FileList | null): void {
    const file = files?.item(0);

    if (!file) {
      return;
    }

    if (!IMAGE_MIME_TYPES.includes(file.type)) {
      this.setFileError(setting, $localize`:@@featureSettings-imageUnsupported:Choose a PNG, JPEG, WebP or SVG image.`);

      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      const maxLength = setting.maxLength ?? DEFAULT_IMAGE_MAX_LENGTH;

      if (dataUri.length > maxLength) {
        const maxKilobytes = Math.floor((maxLength * 3) / 4 / 1024);

        this.setFileError(
          setting,
          $localize`:@@featureSettings-imageTooLarge:The image is too large (at most about ${maxKilobytes}:maxKilobytes: KB).`,
        );

        return;
      }

      this.setDraft(setting, dataUri);
    };

    reader.onerror = () =>
      this.setFileError(setting, $localize`:@@featureSettings-imageUnreadable:The image could not be read.`);
    reader.readAsDataURL(file);
  }

  pickColor(setting: SettingStateView, event: Event): void {
    this.setDraft(setting, (event.target as HTMLInputElement).value);
  }

  /** Image shown for an `image` setting: the edited / overridden / inherited value, if any. */
  imagePreview(setting: SettingStateView): string | null {
    const value = this.draftValue(setting);

    return value.startsWith('data:image/') ? value : null;
  }

  /** Value of the native color picker (it cannot be empty): the draft, else the default, else black. */
  colorPickerValue(setting: SettingStateView): string {
    const value = this.draftValue(setting);

    if (HEX_COLOR_PATTERN.test(value)) {
      return value.toLowerCase();
    }

    return setting.defaultValue && HEX_COLOR_PATTERN.test(setting.defaultValue) ? setting.defaultValue : '#000000';
  }

  private setFileError(setting: SettingStateView, message: string | null): void {
    this.fileErrors.update((errors) => {
      const next = { ...errors };

      if (message) {
        next[setting.key] = message;
      } else {
        delete next[setting.key];
      }

      return next;
    });
  }

  isDirty(setting: SettingStateView): boolean {
    const draft = this.drafts()[setting.key];

    if (draft === undefined) {
      return false;
    }

    return setting.sensitive ? draft.length > 0 : draft !== this.baseline(setting);
  }

  isPending(setting: SettingStateView): boolean {
    return this.pendingKeys().includes(setting.key);
  }

  settingError(setting: SettingStateView): string | null {
    return this.fileErrors()[setting.key] ?? this.settingErrors()[setting.key] ?? null;
  }

  save(setting: SettingStateView): void {
    if (!this.isDirty(setting) || this.isPending(setting)) {
      return;
    }

    this.facade.save(setting.key, this.draftValue(setting));
    this.discard(setting);
  }

  reset(setting: SettingStateView): void {
    if (!setting.hasOverride || this.isPending(setting)) {
      return;
    }

    this.facade.reset(setting.key);
    this.discard(setting);
  }

  discard(setting: SettingStateView): void {
    this.setFileError(setting, null);
    this.drafts.update((drafts) => {
      const next = { ...drafts };

      delete next[setting.key];

      return next;
    });
  }

  selectLevel(option: LevelOption): void {
    this.levelSwitchOpen.set(false);

    if (option.id === this.activeLevelId()) {
      return;
    }

    this.drafts.set({});
    this.fileErrors.set({});
    this.facade.load(option.target);
  }

  reload(): void {
    const overview = this.overview();

    this.drafts.set({});
    this.fileErrors.set({});
    this.facade.load(overview ? { level: overview.level, tenantId: overview.tenantId } : null);
  }

  isNumeric(setting: SettingStateView): boolean {
    return setting.type === 'integer' || setting.type === 'number';
  }

  inputType(setting: SettingStateView): string {
    switch (setting.type) {
      case 'secret':
        return 'password';
      case 'integer':
      case 'number':
        return 'number';
      case 'email':
        return 'email';
      case 'url':
        return 'url';
      default:
        return 'text';
    }
  }

  step(setting: SettingStateView): string | null {
    if (setting.type === 'integer') {
      return '1';
    }

    return setting.type === 'number' ? 'any' : null;
  }

  sourceLabel(source: SettingValueSource): string {
    switch (source) {
      case 'tenant':
        return $localize`:@@featureSettings-sourceTenant:Tenant`;
      case 'global':
        return $localize`:@@featureSettings-sourceGlobal:All tenants`;
      case 'environment':
        return $localize`:@@featureSettings-sourceEnvironment:Environment`;
      default:
        return $localize`:@@featureSettings-sourceDefault:Default`;
    }
  }

  /** Label of the own override at the viewed level. */
  overrideLabel(): string {
    const overview = this.overview();

    if (!overview?.homeTenantId) {
      return $localize`:@@featureSettings-sourceOverride:Override`;
    }

    return this.sourceLabel(overview.level === 'global' ? 'global' : 'tenant');
  }

  sourceTone(setting: SettingStateView): FpcBadgeTone {
    if (setting.hasOverride) {
      return 'primary';
    }

    return setting.effectiveSource === 'default' ? 'neutral' : 'info';
  }

  effectiveLabel(setting: SettingStateView): string {
    return setting.hasOverride ? this.overrideLabel() : this.sourceLabel(setting.effectiveSource);
  }

  /** Hint what applies after a reset (or without an override). */
  inheritedHint(setting: SettingStateView): string {
    const source = this.sourceLabel(setting.inheritedSource);

    // Secrets, and deployment values hidden from tenant admins without global access.
    if (setting.sensitive || (setting.inheritedValue === null && setting.hasInheritedValue)) {
      return setting.hasInheritedValue
        ? $localize`:@@featureSettings-inheritedSecretConfigured:Default (${source}:source:): configured`
        : $localize`:@@featureSettings-inheritedSecretUnset:Default (${source}:source:): not set`;
    }

    // Images are shown as a preview, never as their (long) data URI.
    if (setting.type === 'image') {
      return setting.hasInheritedValue
        ? $localize`:@@featureSettings-inheritedImageConfigured:Default (${source}:source:): image set`
        : $localize`:@@featureSettings-inheritedImageUnset:Default: no image`;
    }

    if (setting.inheritedValue !== null && setting.inheritedValue !== '') {
      return $localize`:@@featureSettings-inheritedValue:Default (${source}:source:): ${setting.inheritedValue}:value:`;
    }

    if (setting.defaultValue !== undefined) {
      return $localize`:@@featureSettings-inheritedBuiltIn:Default: ${setting.defaultValue}:value:`;
    }

    return $localize`:@@featureSettings-inheritedUnset:Default: not set`;
  }

  enumOptionLabel(option: string): string {
    return option === '' ? $localize`:@@featureSettings-optionNone:(none)` : option;
  }

  secretPlaceholder(setting: SettingStateView): string {
    return setting.hasOverride
      ? $localize`:@@featureSettings-secretReplace:Configured. Enter a new value to replace it`
      : $localize`:@@featureSettings-secretEnter:Enter a value to override`;
  }
}
