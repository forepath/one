import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  OpencodeConfigService,
  type InheritedAdditiveDto,
  type OpencodeConfigDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  migrateConfigV1ToV2,
  composeLayerOverlay,
  validateOverlayAgainstHeredity,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  filterBuiltinProvidersByAllowDeny,
  formatProviderModelRef,
  getBuiltinProvider,
  parseProviderModelRef,
  providersForKnownModelPicker,
  unusedBuiltinModelsForProvider,
  unusedBuiltinProviders,
  type OpencodeBuiltinProvider,
} from '@forepath/agenstra/shared/util-opencode-providers';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AgentConfigMapListComponent, type ConfigMapEntryView } from '../map-list/agent-config-map-list.component';
import { AgentConfigPathListComponent, type PathListEntryView } from '../path-list/agent-config-path-list.component';
import {
  classifyPathListValue,
  isEditableLocalPath,
  isLocalEditorPath,
  resolveLayerEditorPath,
} from '../path-list/path-list-value.util';
import { AgentConfigSettingsRowComponent } from '../settings-row/settings-row.component';

type EditorLayer = 'global' | 'workspace' | 'agent';
type EditorMode = 'structured' | 'raw';
type PermissionEffect = 'allow' | 'deny' | 'ask';
type PolicyEffect = 'allow' | 'deny';

const NETWORK_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'] as const;
const SHARE_OPTIONS = ['manual', 'auto', 'disabled'] as const;
const UPDATE_OPTIONS = ['true', 'false', 'notify'] as const;
const AGENT_MODES = ['primary', 'subagent', 'all'] as const;
const MCP_TYPES = ['local', 'remote'] as const;
const WEBSEARCH_PROVIDERS = ['exa', 'firecrawl', 'parallel', 'tavily', 'random'] as const;
const PERMISSION_EFFECTS: PermissionEffect[] = ['ask', 'allow', 'deny'];
const POLICY_EFFECTS: PolicyEffect[] = ['allow', 'deny'];
const POLICY_ACTIONS = ['provider.use', 'permission'] as const;
/** Select sentinel that reveals the free-text custom provider id field. */
const CUSTOM_PROVIDER_SELECT_VALUE = '__custom__';

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

@Component({
  selector: 'agenstra-agent-config-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    AgentConfigMapListComponent,
    AgentConfigPathListComponent,
    AgentConfigSettingsRowComponent,
  ],
  templateUrl: './agent-config-editor.component.html',
  styleUrl: './agent-config-editor.component.scss',
})
export class AgentConfigEditorComponent implements OnInit {
  private readonly opencodeConfigService = inject(OpencodeConfigService);
  private readonly destroyRef = inject(DestroyRef);

  readonly layer = input.required<EditorLayer>();
  readonly clientId = input<string | null>(null);
  readonly agentId = input<string | null>(null);
  readonly presentation = input<'page' | 'modal'>('page');

  readonly saved = output<OpencodeConfigDto>();
  readonly cancelled = output<void>();
  /** Request to open a local path in the layer virtual editor / studio. */
  readonly editPathFile = output<string>();
  /** Open an external URL (skills/instructions/repository). */
  readonly openExternalUrl = output<string>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly mode = signal<EditorMode>('structured');
  readonly settingsTab = signal('general');
  readonly config = signal<JsonObject>({});
  /** Raw JSON overrides for this layer (merged over `config`). */
  readonly overrides = signal<JsonObject>({});
  /** Full merged effective config for inherited map summaries (agent → workspace → global). */
  readonly effective = signal<JsonObject>({});
  readonly rawJson = signal('{}');
  readonly rawError = signal<string | null>(null);
  readonly overridesJson = signal('{}');
  readonly overridesError = signal<string | null>(null);
  readonly lockedPaths = signal<string[]>([]);
  readonly inheritedAdditive = signal<InheritedAdditiveDto[]>([]);
  readonly secretKeys = signal<string[]>([]);
  /** Draft password values for layer secrets (network + provider credentials). Never prefilled from API. */
  readonly secretDrafts = signal<Record<string, string>>({});
  /** Secret keys marked for removal on save (empty draft while key was previously set). */
  readonly clearSecretKeys = signal<Set<string>>(new Set());
  /** Serialized editor state after last load/save — used for unsaved drift detection. */
  readonly baselineSnapshot = signal('');
  /** Config object captured with the baseline (for per-field dirty checks). */
  readonly baselineConfig = signal<JsonObject>({});
  /** Overrides object captured with the baseline. */
  readonly baselineOverrides = signal<JsonObject>({});
  readonly draftBuiltinProviderId = signal('');
  readonly draftCustomProviderId = signal('');
  readonly draftEnabledProviderId = signal('');
  readonly draftDisabledProviderId = signal('');
  readonly draftAllowModelProviderId = signal('');
  readonly draftAllowModelId = signal('');
  readonly draftDenyModelProviderId = signal('');
  readonly draftDenyModelId = signal('');
  readonly draftDefaultModelProviderId = signal('');
  readonly draftDefaultModelId = signal('');
  readonly draftProviderEnvName = signal('');
  readonly providerMapExpandedKey = signal<string | null>(null);
  /** Live catalog from GET /opencode-providers (empty until load). */
  readonly builtinProvidersCatalog = signal<readonly OpencodeBuiltinProvider[]>([]);

  readonly modeToggleTitle = computed(() =>
    this.mode() === 'structured'
      ? $localize`:@@featureAgentConfig-switchToRaw:Switch to raw JSON`
      : $localize`:@@featureAgentConfig-switchToStructured:Switch to structured editor`,
  );
  readonly shareOptions = SHARE_OPTIONS;
  readonly updateOptions = UPDATE_OPTIONS;
  readonly agentModes = AGENT_MODES;
  readonly mcpTypes = MCP_TYPES;
  readonly websearchProviders = WEBSEARCH_PROVIDERS;
  readonly permissionEffects = PERMISSION_EFFECTS;
  readonly policyEffects = POLICY_EFFECTS;
  readonly policyActions = POLICY_ACTIONS;
  readonly customProviderSelectValue = CUSTOM_PROVIDER_SELECT_VALUE;
  /** Global admin page has no higher layers; workspace/agent show merged effective JSON. */
  readonly showAccumulatedConfig = computed(() => this.layer() !== 'global');
  readonly effectiveJson = computed(() => JSON.stringify(this.effective(), null, 2));

  readonly showSave = computed(() => this.presentation() === 'modal');
  readonly canSave = computed(
    () => !this.loading() && !this.saving() && !this.rawError() && !this.overridesError() && this.isDirty(),
  );
  readonly isDirty = computed(() => {
    if (this.loading()) {
      return false;
    }

    const baseline = this.baselineSnapshot();

    if (!baseline) {
      return false;
    }

    return this.currentSnapshot() !== baseline;
  });

  readonly providerEntries = computed(() => this.mapEntries('providers', '/providers'));
  readonly unusedBuiltinProviderOptions = computed(() =>
    unusedBuiltinProviders(
      this.builtinProvidersCatalog(),
      this.providerEntries().map((entry) => entry.key),
    ),
  );
  readonly isCustomProviderMode = computed(() => this.draftBuiltinProviderId() === CUSTOM_PROVIDER_SELECT_VALUE);
  readonly unusedEnabledProviderOptions = computed(() =>
    unusedBuiltinProviders(this.builtinProvidersCatalog(), this.stringListItems('enabled_providers')),
  );
  readonly unusedDisabledProviderOptions = computed(() =>
    unusedBuiltinProviders(this.builtinProvidersCatalog(), this.stringListItems('disabled_providers')),
  );
  readonly unusedAllowModelProviderOptions = computed(() =>
    providersForKnownModelPicker(
      this.builtinProvidersCatalog(),
      this.stringListItems('enabled_providers'),
      this.stringListItems('disabled_providers'),
      this.stringListItems('model_allow'),
    ),
  );
  readonly unusedDenyModelProviderOptions = computed(() =>
    providersForKnownModelPicker(
      this.builtinProvidersCatalog(),
      this.stringListItems('enabled_providers'),
      this.stringListItems('disabled_providers'),
      this.stringListItems('model_deny'),
    ),
  );
  readonly unusedAllowModelOptions = computed(() =>
    unusedBuiltinModelsForProvider(
      this.builtinProvidersCatalog(),
      this.draftAllowModelProviderId(),
      this.stringListItems('model_allow'),
    ),
  );
  readonly unusedDenyModelOptions = computed(() =>
    unusedBuiltinModelsForProvider(
      this.builtinProvidersCatalog(),
      this.draftDenyModelProviderId(),
      this.stringListItems('model_deny'),
    ),
  );
  readonly allowModelUsesCatalogSelect = computed(() => this.unusedAllowModelOptions().length > 0);
  readonly denyModelUsesCatalogSelect = computed(() => this.unusedDenyModelOptions().length > 0);
  readonly defaultModelProviderOptions = computed(() => {
    const scoped = filterBuiltinProvidersByAllowDeny(
      this.builtinProvidersCatalog(),
      this.stringListItems('enabled_providers'),
      this.stringListItems('disabled_providers'),
    );
    const draftId = this.draftDefaultModelProviderId().trim();

    if (!draftId || scoped.some((provider) => provider.id === draftId)) {
      return scoped;
    }

    const extra = getBuiltinProvider(this.builtinProvidersCatalog(), draftId);

    return extra ? [extra, ...scoped] : scoped;
  });
  readonly defaultModelOptions = computed(() => {
    const provider = getBuiltinProvider(this.builtinProvidersCatalog(), this.draftDefaultModelProviderId());

    return provider?.models ?? [];
  });
  readonly defaultModelUsesCatalogSelect = computed(() => this.defaultModelOptions().length > 0);
  readonly defaultModelUsesPicker = computed(() => {
    const catalog = this.builtinProvidersCatalog();

    if (catalog.length === 0) {
      return false;
    }

    const draftId = this.draftDefaultModelProviderId().trim();

    if (!draftId) {
      return true;
    }

    return !!getBuiltinProvider(catalog, draftId);
  });
  readonly mcpServerEntries = computed(() => this.mapEntries('mcp.servers', '/mcp/servers'));
  readonly commandEntries = computed(() => this.mapEntries('commands', '/commands'));
  readonly agentEntries = computed(() => this.mapEntries('agents', '/agents'));
  readonly referenceEntries = computed(() => this.mapEntries('references', '/references'));
  readonly formatterEntries = computed(() => this.mapEntries('formatter', '/formatter'));
  readonly permissionRules = computed(() => this.ruleEntries('permissions'));
  readonly policyRules = computed(() => this.ruleEntries('experimental.policies'));
  readonly pluginEntries = computed(() => this.readPlugins());
  readonly skillEntries = computed(() => this.pathListEntries('skills', '/skills'));
  readonly instructionEntries = computed(() => this.pathListEntries('instructions', '/instructions'));
  readonly websearchEnabled = computed(() => {
    const value = this.getDisplayPath('websearch');

    return value !== false && value !== undefined;
  });
  readonly formatterEnabled = computed(() => {
    const value = this.getDisplayPath('formatter');

    return value !== false;
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.baselineSnapshot.set('');
    this.baselineConfig.set({});

    forkJoin({
      config: this.loadRequest(),
      providers: this.opencodeConfigService
        .listProviders()
        .pipe(catchError(() => of({ providers: [] as OpencodeBuiltinProvider[] }))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ config, providers }) => {
          this.builtinProvidersCatalog.set(
            (providers.providers ?? []).map((provider) => ({
              ...provider,
              env: provider.env ?? [],
              models: provider.models ?? [],
            })),
          );
          this.applyDto(config);
        },
        error: (err: { message?: string }) => {
          this.error.set(err.message ?? $localize`:@@featureAgentConfig-loadFailed:Failed to load configuration`);
          this.loading.set(false);
        },
      });
  }

  onModeChange(modeId: string | null): void {
    if (modeId === 'structured' || modeId === 'raw') {
      if (modeId === 'raw') {
        if (!this.commitOverrides()) {
          return;
        }

        this.rawJson.set(JSON.stringify(composeLayerOverlay(this.config(), this.overrides()), null, 2));
        this.validateRaw();
      } else if (this.mode() === 'raw') {
        if (this.commitRawToConfig()) {
          this.syncDefaultModelDraftsFromConfig();
        } else {
          return;
        }
      }

      this.mode.set(modeId);
    }
  }

  toggleMode(): void {
    this.onModeChange(this.mode() === 'structured' ? 'raw' : 'structured');
  }

  /** True when Advanced overrides differ from the saved baseline. */
  isOverridesDirty(): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    return !this.valuesEqual(this.baselineOverrides(), this.overrides());
  }

  /** True when `path` (dot path into config) differs from the saved baseline. */
  isConfigPathDirty(path: string): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    return !this.valuesEqual(this.readPath(this.baselineConfig(), path), this.getPath(path));
  }

  /** True when a map entry field differs from baseline. */
  isMapEntryFieldDirty(mapPath: string, key: string, field: string): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baselineMap = this.readPath(this.baselineConfig(), mapPath);
    const currentMap = this.getPath(mapPath);
    const baselineEntry = isPlainObject(baselineMap) ? baselineMap[key] : undefined;
    const currentEntry = isPlainObject(currentMap) ? currentMap[key] : undefined;
    const baselineValue = isPlainObject(baselineEntry) ? this.getNested(baselineEntry, field) : undefined;
    const currentValue = isPlainObject(currentEntry) ? this.getNested(currentEntry, field) : undefined;

    return !this.valuesEqual(baselineValue, currentValue);
  }

  /** True when an array rule field differs from baseline. */
  isRuleFieldDirty(arrayPath: string, index: number, field: string): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baselineArr = this.readPath(this.baselineConfig(), arrayPath);
    const currentArr = this.getPath(arrayPath);
    const baselineRule =
      Array.isArray(baselineArr) && isPlainObject(baselineArr[index]) ? (baselineArr[index] as JsonObject) : null;
    const currentRule =
      Array.isArray(currentArr) && isPlainObject(currentArr[index]) ? (currentArr[index] as JsonObject) : null;

    return !this.valuesEqual(baselineRule?.[field], currentRule?.[field]);
  }

  isSecretDirty(key: string): boolean {
    return (this.secretDrafts()[key]?.trim() ?? '') !== '' || this.clearSecretKeys().has(key);
  }

  isNetworkSecretDirty(key: string): boolean {
    return this.isSecretDirty(key);
  }

  isPluginPackageDirty(index: number): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baseline = this.readPath(this.baselineConfig(), 'plugins');
    const current = this.getPath('plugins');
    const baselinePkg = Array.isArray(baseline) ? this.pluginPackageName(baseline[index]) : undefined;
    const currentPkg = Array.isArray(current) ? this.pluginPackageName(current[index]) : undefined;

    return baselinePkg !== currentPkg;
  }

  isPluginOptionsDirty(index: number): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baseline = this.readPath(this.baselineConfig(), 'plugins');
    const current = this.getPath('plugins');
    const baselineOpts = Array.isArray(baseline) ? this.pluginOptionsObject(baseline[index]) : undefined;
    const currentOpts = Array.isArray(current) ? this.pluginOptionsObject(current[index]) : undefined;

    return !this.valuesEqual(baselineOpts, currentOpts);
  }

  isWebsearchEnabledDirty(): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baseline = this.readPath(this.baselineConfig(), 'websearch');
    const current = this.getPath('websearch');
    const baselineEnabled = baseline !== false && baseline !== undefined;
    const currentEnabled = current !== false && current !== undefined;

    return baselineEnabled !== currentEnabled;
  }

  isFormatterEnabledDirty(): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baseline = this.readPath(this.baselineConfig(), 'formatter');
    const current = this.getPath('formatter');

    return (baseline === false) !== (current === false);
  }

  onRawJsonChange(value: string): void {
    this.rawJson.set(value);
    this.validateRaw();
  }

  onOverridesJsonChange(value: string): void {
    this.overridesJson.set(value);
    this.validateOverrides();
  }

  isFullyLocked(): boolean {
    return (
      this.lockedPaths().length > 0 &&
      Object.keys(this.config()).length === 0 &&
      Object.keys(this.overrides()).length === 0
    );
  }

  isLocked(pointer: string): boolean {
    const normalized = pointer.startsWith('/') ? pointer : `/${pointer}`;

    return this.lockedPaths().some((locked) => normalized === locked || normalized.startsWith(`${locked}/`));
  }

  inheritedKeys(path: string): string[] {
    const normalized = path.startsWith('/') ? path : `/${path}`;

    return this.inheritedAdditive().find((entry) => entry.path === normalized)?.keys ?? [];
  }

  inheritedItems(path: string): unknown[] {
    const normalized = path.startsWith('/') ? path : `/${path}`;

    return this.inheritedAdditive().find((entry) => entry.path === normalized)?.items ?? [];
  }

  stringValue(path: string): string {
    const value = this.getDisplayPath(path);

    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  booleanValue(path: string): boolean {
    return this.getDisplayPath(path) === true;
  }

  numberValue(path: string): number | null {
    const value = this.getDisplayPath(path);

    return typeof value === 'number' ? value : null;
  }

  stringListValue(path: string): string {
    return this.stringListItems(path).join('\n');
  }

  stringListItems(path: string): string[] {
    const value = this.getDisplayPath(path);

    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  subtreeJson(path: string): string {
    const value = this.getDisplayPath(path);

    return value === undefined ? '' : JSON.stringify(value, null, 2);
  }

  setString(path: string, value: string): void {
    if (this.isLocked(`/${path.split('.')[0]}`) || this.isLocked(`/${path.replace(/\./g, '/')}`)) {
      return;
    }

    this.patchPath(path, value.trim() === '' ? undefined : value);
  }

  setBoolean(path: string, value: boolean): void {
    if (this.isLocked(`/${path.replace(/\./g, '/')}`)) {
      return;
    }

    this.patchPath(path, value);
  }

  setNumber(path: string, value: string): void {
    if (this.isLocked(`/${path.replace(/\./g, '/')}`)) {
      return;
    }

    const trimmed = value.trim();

    this.patchPath(path, trimmed === '' ? undefined : Number(trimmed));
  }

  setStringList(path: string, value: string): void {
    if (this.isLocked(`/${path.replace(/\./g, '/')}`)) {
      return;
    }

    const items = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    this.patchPath(path, items.length ? items : undefined);
  }

  setSubtreeJson(path: string, value: string): void {
    if (this.isLocked(`/${path.replace(/\./g, '/')}`)) {
      return;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      this.patchPath(path, undefined);

      return;
    }

    try {
      this.patchPath(path, JSON.parse(trimmed) as unknown);
      this.error.set(null);
    } catch {
      this.error.set($localize`:@@featureAgentConfig-invalidSubtreeJson:Invalid JSON in structured field`);
    }
  }

  setSecretDraft(key: string, value: string): void {
    this.secretDrafts.update((current) => ({ ...current, [key]: value }));
    this.clearSecretKeys.update((current) => {
      const next = new Set(current);

      if (value.trim() === '' && this.secretKeys().includes(key)) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  }

  setNetworkSecret(key: (typeof NETWORK_KEYS)[number], value: string): void {
    this.setSecretDraft(key, value);
  }

  secretSet(key: string): boolean {
    return this.secretKeys().includes(key);
  }

  networkSecretSet(key: string): boolean {
    return this.secretSet(key);
  }

  providerEnvKeys(providerId: string): string[] {
    const catalog = getBuiltinProvider(this.builtinProvidersCatalog(), providerId);

    if (catalog?.env.length) {
      return [...catalog.env];
    }

    const local = this.mapEntryStringListItems('providers', providerId, 'env');

    if (local.length) {
      return local;
    }

    const effectiveMap = this.getEffectiveMap('providers');
    const entry = effectiveMap?.[providerId];

    if (!isPlainObject(entry)) {
      return [];
    }

    const env = entry['env'];

    if (!Array.isArray(env)) {
      return [];
    }

    return env.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  /**
   * Catalog providers already declare credential env names; only custom / catalog-without-env
   * providers need a free-form "Add credential env" control.
   */
  canAddProviderCredentialEnv(providerId: string): boolean {
    const catalog = getBuiltinProvider(this.builtinProvidersCatalog(), providerId);

    return !(catalog && catalog.env.length > 0);
  }

  providerCatalogModels(providerId: string): Array<{ id: string; name: string }> {
    const catalog = getBuiltinProvider(this.builtinProvidersCatalog(), providerId);

    return catalog?.models?.length ? catalog.models : [];
  }

  /**
   * Built-in providers with catalog models are locked to that list; custom / catalog-without-models
   * still use free-text model ids.
   */
  canEditProviderModels(providerId: string): boolean {
    return this.providerCatalogModels(providerId).length === 0;
  }

  mapEntryStringListItems(path: string, key: string, field: string): string[] {
    const value = this.getNested(this.mapEntryObject(path, key), field);

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  addProviderEnvKey(providerId: string): void {
    const name = this.draftProviderEnvName().trim();

    if (!name || this.isLocked('/providers') || !this.canAddProviderCredentialEnv(providerId)) {
      return;
    }

    const existing = this.providerEnvKeys(providerId);

    if (existing.includes(name)) {
      this.draftProviderEnvName.set('');

      return;
    }

    this.patchMapEntryField('providers', providerId, 'env', [...existing, name]);
    this.draftProviderEnvName.set('');
  }

  removeProviderEnvKey(providerId: string, envKey: string): void {
    if (this.isLocked('/providers') || !this.canAddProviderCredentialEnv(providerId)) {
      return;
    }

    const next = this.providerEnvKeys(providerId).filter((name) => name !== envKey);

    this.patchMapEntryField('providers', providerId, 'env', next.length ? next : undefined);

    if (this.secretKeys().includes(envKey)) {
      this.setSecretDraft(envKey, '');
    } else {
      this.secretDrafts.update((current) => {
        const copy = { ...current };
        delete copy[envKey];

        return copy;
      });
      this.clearSecretKeys.update((current) => {
        const cleared = new Set(current);
        cleared.delete(envKey);

        return cleared;
      });
    }
  }

  mapEntries(path: string, inheritedPath: string): ConfigMapEntryView[] {
    const localValue = this.getPath(path);
    const local = isPlainObject(localValue) ? localValue : {};
    const baselineMapRaw = this.readPath(this.baselineConfig(), path);
    const baselineLocal = isPlainObject(baselineMapRaw) ? baselineMapRaw : {};
    const inheritedKeysList = this.inheritedKeys(inheritedPath);
    const inherited = new Set(inheritedKeysList);
    const effectiveMap = this.getEffectiveMap(path);
    const pathLocked = this.isPathMutationLocked(path);
    // When a parent replace/scalar-locks the whole map, surface effective keys as read-only.
    const lockedEffectiveKeys = pathLocked && effectiveMap ? Object.keys(effectiveMap) : [];
    const activeKeys = [...new Set([...Object.keys(local), ...inheritedKeysList, ...lockedEffectiveKeys])].sort(
      (a, b) => a.localeCompare(b),
    );
    const deletedKeys = Object.keys(baselineLocal)
      .filter((key) => !(key in local) && !inherited.has(key))
      .sort((a, b) => a.localeCompare(b));

    const active = activeKeys.map((key) => {
      const value = key in local ? local[key] : effectiveMap?.[key];
      const isInherited = inherited.has(key) || (pathLocked && !(key in local));
      const dirty = !isInherited && this.isMapEntryDirty(path, key);

      return {
        key,
        inherited: isInherited,
        dirty,
        deleted: false,
        summary:
          value !== undefined
            ? this.summarizeMapEntry(path, key, value)
            : $localize`:@@featureAgentConfig-inheritedEntrySummary:Inherited from a higher layer`,
      };
    });

    const deleted = deletedKeys.map((key) => ({
      key,
      inherited: false,
      dirty: true,
      deleted: true,
      summary: $localize`:@@featureAgentConfig-removedEntrySummary:Removed (unsaved)`,
    }));

    return [...active, ...deleted];
  }

  /** True when a map entry (whole object) differs from baseline — new, updated, or deleted. */
  isMapEntryDirty(mapPath: string, key: string): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baselineMap = this.readPath(this.baselineConfig(), mapPath);
    const currentMap = this.getPath(mapPath);
    const baselineEntry = isPlainObject(baselineMap) ? baselineMap[key] : undefined;
    const currentEntry = isPlainObject(currentMap) ? currentMap[key] : undefined;

    return !this.valuesEqual(baselineEntry, currentEntry);
  }

  addMapEntry(path: string, key: string, seed: JsonObject = {}): void {
    const trimmed = key.trim();

    if (this.isPathMutationLocked(path) || !trimmed || this.isMapKeyInherited(path, trimmed)) {
      return;
    }

    const current = isPlainObject(this.getPath(path)) ? { ...(this.getPath(path) as JsonObject) } : {};

    if (trimmed in current) {
      return;
    }

    current[trimmed] = structuredClone(seed);
    this.patchPath(path, current);
  }

  addBuiltinProvider(): void {
    const id = this.draftBuiltinProviderId().trim();

    if (!id || id === CUSTOM_PROVIDER_SELECT_VALUE) {
      return;
    }

    const catalog = getBuiltinProvider(this.builtinProvidersCatalog(), id);

    if (!catalog || this.isLocked('/providers')) {
      return;
    }

    this.addMapEntry('providers', catalog.id, {
      env: [...catalog.env],
      models: {},
    });
    this.draftBuiltinProviderId.set('');
    this.providerMapExpandedKey.set(catalog.id);
  }

  onProviderSelectChange(value: string): void {
    this.draftBuiltinProviderId.set(value);

    if (value !== CUSTOM_PROVIDER_SELECT_VALUE) {
      this.draftCustomProviderId.set('');
    }
  }

  addCustomProvider(): void {
    const id = this.draftCustomProviderId().trim();

    if (!id || this.isLocked('/providers') || !this.isCustomProviderMode()) {
      return;
    }

    this.addMapEntry('providers', id, { env: [], models: {} });
    this.draftCustomProviderId.set('');
    this.draftBuiltinProviderId.set('');
    this.providerMapExpandedKey.set(id);
  }

  appendKnownProviderToList(path: 'enabled_providers' | 'disabled_providers', id: string): void {
    const trimmed = id.trim();

    if (!trimmed || this.isLocked(`/${path}`)) {
      return;
    }

    const existing = this.stringListValue(path)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (existing.includes(trimmed)) {
      return;
    }

    this.setStringList(path, [...existing, trimmed].join('\n'));
  }

  addKnownEnabledProvider(): void {
    this.appendKnownProviderToList('enabled_providers', this.draftEnabledProviderId());
    this.draftEnabledProviderId.set('');
  }

  addKnownDisabledProvider(): void {
    this.appendKnownProviderToList('disabled_providers', this.draftDisabledProviderId());
    this.draftDisabledProviderId.set('');
  }

  onAllowModelProviderChange(providerId: string): void {
    this.draftAllowModelProviderId.set(providerId);
    this.draftAllowModelId.set('');
  }

  onDenyModelProviderChange(providerId: string): void {
    this.draftDenyModelProviderId.set(providerId);
    this.draftDenyModelId.set('');
  }

  onDefaultModelProviderChange(providerId: string): void {
    if (this.isLocked('/model')) {
      return;
    }

    this.draftDefaultModelProviderId.set(providerId);
    this.draftDefaultModelId.set('');
    this.applyDefaultModelDrafts();
  }

  onDefaultModelIdChange(modelId: string): void {
    if (this.isLocked('/model')) {
      return;
    }

    this.draftDefaultModelId.set(modelId);
    this.applyDefaultModelDrafts();
  }

  onDefaultModelFreeTextChange(value: string): void {
    if (this.isLocked('/model')) {
      return;
    }

    this.setString('model', value);
    this.syncDefaultModelDraftsFromConfig();
  }

  appendKnownModelToList(path: 'model_allow' | 'model_deny', providerId: string, modelId: string): void {
    const provider = providerId.trim();
    const model = modelId.trim();

    if (!provider || !model) {
      return;
    }

    if (this.isLocked(`/${path}`)) {
      return;
    }

    const ref = formatProviderModelRef(provider, model);
    const existing = this.stringListItems(path);

    if (existing.includes(ref)) {
      return;
    }

    this.setStringList(path, [...existing, ref].join('\n'));
  }

  addKnownAllowModel(): void {
    this.appendKnownModelToList('model_allow', this.draftAllowModelProviderId(), this.draftAllowModelId());
    this.draftAllowModelId.set('');

    if (this.unusedAllowModelOptions().length === 0) {
      this.draftAllowModelProviderId.set('');
    }
  }

  addKnownDenyModel(): void {
    this.appendKnownModelToList('model_deny', this.draftDenyModelProviderId(), this.draftDenyModelId());
    this.draftDenyModelId.set('');

    if (this.unusedDenyModelOptions().length === 0) {
      this.draftDenyModelProviderId.set('');
    }
  }

  builtinProviderLabel(provider: OpencodeBuiltinProvider): string {
    return `${provider.name} (${provider.id})`;
  }

  builtinModelLabel(model: { id: string; name: string }): string {
    return model.name === model.id ? model.id : `${model.name} (${model.id})`;
  }

  removeMapEntry(path: string, key: string): void {
    if (this.isPathMutationLocked(path) || this.isMapKeyInherited(path, key)) {
      return;
    }

    const current = isPlainObject(this.getPath(path)) ? { ...(this.getPath(path) as JsonObject) } : {};
    delete current[key];
    this.patchPath(path, Object.keys(current).length ? current : undefined);
  }

  mapEntryObject(path: string, key: string): JsonObject {
    const localValue = this.getPath(path);

    if (isPlainObject(localValue) && isPlainObject(localValue[key])) {
      return localValue[key] as JsonObject;
    }

    const effectiveMap = this.getEffectiveMap(path);

    if (effectiveMap && isPlainObject(effectiveMap[key])) {
      return effectiveMap[key] as JsonObject;
    }

    return {};
  }

  mapEntryString(path: string, key: string, field: string): string {
    const entry = this.mapEntryObject(path, key);
    const value = this.getNested(entry, field);

    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  mapEntryBoolean(path: string, key: string, field: string): boolean {
    return this.getNested(this.mapEntryObject(path, key), field) === true;
  }

  mapEntryNumber(path: string, key: string, field: string): number | null {
    const value = this.getNested(this.mapEntryObject(path, key), field);

    return typeof value === 'number' ? value : null;
  }

  mapEntryStringList(path: string, key: string, field: string): string {
    const value = this.getNested(this.mapEntryObject(path, key), field);

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string').join('\n');
    }

    if (isPlainObject(value)) {
      // Provider models are a keyed object; summarize as ids. Env/headers stay KEY=value.
      if (field === 'models') {
        return Object.keys(value).join('\n');
      }

      return Object.entries(value)
        .map(([envKey, envValue]) => `${envKey}=${typeof envValue === 'string' ? envValue : ''}`)
        .join('\n');
    }

    return '';
  }

  setMapEntryString(path: string, key: string, field: string, value: string): void {
    this.patchMapEntryField(path, key, field, value.trim() === '' ? undefined : value);
  }

  setMapEntryBoolean(path: string, key: string, field: string, value: boolean): void {
    this.patchMapEntryField(path, key, field, value || undefined);
  }

  setMapEntryNumber(path: string, key: string, field: string, value: string): void {
    const trimmed = value.trim();
    this.patchMapEntryField(path, key, field, trimmed === '' ? undefined : Number(trimmed));
  }

  setMapEntryStringList(path: string, key: string, field: string, value: string, asObject = false): void {
    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      this.patchMapEntryField(path, key, field, undefined);

      return;
    }

    if (asObject) {
      const record: JsonObject = {};

      for (const line of lines) {
        const split = line.indexOf('=');
        const envKey = (split >= 0 ? line.slice(0, split) : line).trim();
        const envValue = split >= 0 ? line.slice(split + 1) : '';

        if (envKey) {
          record[envKey] = envValue;
        }
      }

      this.patchMapEntryField(path, key, field, record);

      return;
    }

    this.patchMapEntryField(path, key, field, lines);
  }

  setProviderModels(providerKey: string, value: string): void {
    if (!this.canEditProviderModels(providerKey)) {
      return;
    }

    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const existing = this.mapEntryObject('providers', providerKey);
    const previousModels = isPlainObject(existing['models']) ? (existing['models'] as JsonObject) : {};
    const nextModels: JsonObject = {};

    for (const modelId of lines) {
      nextModels[modelId] = isPlainObject(previousModels[modelId]) ? previousModels[modelId] : {};
    }

    this.patchMapEntryField(
      'providers',
      providerKey,
      'models',
      Object.keys(nextModels).length ? nextModels : undefined,
    );
  }

  setMcpType(key: string, type: string): void {
    const entry: JsonObject = { ...this.mapEntryObject('mcp.servers', key), type };

    if (type === 'local') {
      delete entry['url'];
      delete entry['headers'];
      delete entry['oauth'];

      if (!Array.isArray(entry['command'])) {
        entry['command'] = [];
      }
    } else {
      delete entry['command'];
      delete entry['environment'];
      delete entry['cwd'];

      if (typeof entry['url'] !== 'string') {
        entry['url'] = '';
      }
    }

    this.replaceMapEntry('mcp.servers', key, entry);
  }

  objectArray(path: string): JsonObject[] {
    return this.asObjectArray(this.getPath(path));
  }

  displayObjectArray(path: string): JsonObject[] {
    return this.asObjectArray(this.getDisplayPath(path));
  }

  addPermissionRule(): void {
    if (this.isLocked('/permissions')) {
      return;
    }

    this.patchPath('permissions', [
      ...this.objectArray('permissions'),
      { action: 'bash', resource: '*', effect: 'ask' },
    ]);
  }

  addPolicyRule(): void {
    if (this.isLocked('/experimental') || this.isLocked('/experimental/policies')) {
      return;
    }

    const current = this.objectArray('experimental.policies');
    this.patchPath('experimental.policies', [...current, { effect: 'deny', action: 'provider.use', resource: '*' }]);
  }

  updateRuleField(path: string, index: number, field: string, value: string): void {
    if (this.isPathMutationLocked(path)) {
      return;
    }

    const rules = this.objectArray(path).map((rule) => ({ ...rule }));

    if (!rules[index]) {
      return;
    }

    rules[index][field] = value;
    this.patchPath(path, rules);
  }

  removeRule(path: string, index: number): void {
    if (this.isPathMutationLocked(path)) {
      return;
    }

    const rules = this.objectArray(path).filter((_, ruleIndex) => ruleIndex !== index);
    this.patchPath(path, rules.length ? rules : undefined);
  }

  moveRule(path: string, index: number, delta: number): void {
    if (this.isPathMutationLocked(path)) {
      return;
    }

    const rules = this.objectArray(path).map((rule) => ({ ...rule }));
    const target = index + delta;

    if (target < 0 || target >= rules.length) {
      return;
    }

    const [item] = rules.splice(index, 1);
    rules.splice(target, 0, item);
    this.patchPath(path, rules);
  }

  readPlugins(): Array<{
    index: number;
    packageName: string;
    optionsJson: string;
    inherited: boolean;
    dirty: boolean;
    deleted: boolean;
  }> {
    const value = this.getPath('plugins');
    const inheritedItems = this.inheritedItems('/plugins');
    const baselineRaw = this.readPath(this.baselineConfig(), 'plugins');
    const baselineArr = Array.isArray(baselineRaw) ? baselineRaw : [];
    const currentArr = Array.isArray(value) ? value : [];

    const inherited = inheritedItems.map((item, index) => this.toPluginEntryView(item, -1 - index, true, false, false));

    const current = currentArr.map((item, index) => {
      const dirty = !this.valuesEqual(baselineArr[index], item);

      return this.toPluginEntryView(item, index, false, dirty, false);
    });

    const deleted = baselineArr
      .slice(currentArr.length)
      .map((item, offset) => this.toPluginEntryView(item, currentArr.length + offset, false, true, true));

    return [...inherited, ...current, ...deleted];
  }

  isRuleEntryDirty(arrayPath: string, index: number): boolean {
    if (!this.baselineSnapshot()) {
      return false;
    }

    const baselineArr = this.readPath(this.baselineConfig(), arrayPath);
    const currentArr = this.getPath(arrayPath);
    const baselineRule = Array.isArray(baselineArr) ? baselineArr[index] : undefined;
    const currentRule = Array.isArray(currentArr) ? currentArr[index] : undefined;

    return !this.valuesEqual(baselineRule, currentRule);
  }

  ruleEntries(arrayPath: string): Array<JsonObject & { __index: number; __dirty: boolean; __deleted: boolean }> {
    const locked = this.isPathMutationLocked(arrayPath);
    const current = locked ? this.displayObjectArray(arrayPath) : this.objectArray(arrayPath);
    const baselineRaw = this.readPath(this.baselineConfig(), arrayPath);
    const baseline = Array.isArray(baselineRaw) ? baselineRaw.filter(isPlainObject) : [];

    const active = current.map((rule, index) => ({
      ...rule,
      __index: index,
      __dirty: locked ? false : this.isRuleEntryDirty(arrayPath, index),
      __deleted: false,
    }));

    const deleted = locked
      ? []
      : baseline.slice(current.length).map((rule, offset) => ({
          ...rule,
          __index: current.length + offset,
          __dirty: true,
          __deleted: true,
        }));

    return [...active, ...deleted];
  }

  pathListEntries(configPath: string, inheritedPath: string): PathListEntryView[] {
    const inherited = this.inheritedItems(inheritedPath)
      .filter((item): item is string => typeof item === 'string')
      .map((value, index) => ({
        value,
        inherited: true,
        index: -1 - index,
        dirty: false,
        deleted: false,
      }));
    const localRaw = this.getPath(configPath);
    const localValues = Array.isArray(localRaw)
      ? localRaw.filter((item): item is string => typeof item === 'string')
      : [];
    const baselineRaw = this.readPath(this.baselineConfig(), configPath);
    const baselineValues = Array.isArray(baselineRaw)
      ? baselineRaw.filter((item): item is string => typeof item === 'string')
      : [];
    const local = localValues.map((value, index) => ({
      value,
      inherited: false,
      index,
      dirty: !this.valuesEqual(baselineValues[index], value),
      deleted: false,
    }));
    const deleted = baselineValues.slice(localValues.length).map((value, offset) => ({
      value,
      inherited: false,
      index: localValues.length + offset,
      dirty: true,
      deleted: true,
    }));

    return [...inherited, ...local, ...deleted];
  }

  addPathListEntry(configPath: string, value: string): void {
    if (this.isPathMutationLocked(configPath)) {
      return;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    const current = Array.isArray(this.getPath(configPath)) ? [...(this.getPath(configPath) as string[])] : [];
    current.push(trimmed);
    this.patchPath(configPath, current);
  }

  updatePathListEntry(configPath: string, index: number, value: string): void {
    if (this.isPathMutationLocked(configPath) || index < 0) {
      return;
    }

    const current = Array.isArray(this.getPath(configPath)) ? [...(this.getPath(configPath) as string[])] : [];

    if (index >= current.length) {
      return;
    }

    current[index] = value;
    this.patchPath(configPath, current.length ? current : undefined);
  }

  removePathListEntry(configPath: string, index: number): void {
    if (this.isPathMutationLocked(configPath) || index < 0) {
      return;
    }

    const current = Array.isArray(this.getPath(configPath)) ? [...(this.getPath(configPath) as string[])] : [];

    if (index >= current.length) {
      return;
    }

    current.splice(index, 1);
    this.patchPath(configPath, current.length ? current : undefined);
  }

  onEditPathFile(path: string): void {
    const resolved = resolveLayerEditorPath(path);

    if (!resolved) {
      return;
    }

    this.editPathFile.emit(resolved);
  }

  onOpenExternalUrl(url: string): void {
    const trimmed = url.trim();

    if (classifyPathListValue(trimmed) !== 'url') {
      return;
    }

    this.openExternalUrl.emit(trimmed);
    window.open(trimmed, '_blank', 'noopener,noreferrer');
  }

  canEditLocalPathValue(value: string, inherited: boolean): boolean {
    return isEditableLocalPath(value, inherited);
  }

  isLocalEditorPathValue(value: string): boolean {
    return isLocalEditorPath(value);
  }

  isMapEntryInherited(path: string, key: string): boolean {
    return this.isMapKeyInherited(path, key);
  }

  pathValueKind(value: string): 'url' | 'local' | 'other' {
    return classifyPathListValue(value);
  }

  addPlugin(): void {
    if (this.isPathMutationLocked('plugins')) {
      return;
    }

    const current = Array.isArray(this.getPath('plugins')) ? [...(this.getPath('plugins') as unknown[])] : [];
    current.push('');
    this.patchPath('plugins', current);
  }

  updatePluginPackage(index: number, packageName: string): void {
    if (this.isPathMutationLocked('plugins')) {
      return;
    }

    const current = Array.isArray(this.getPath('plugins')) ? [...(this.getPath('plugins') as unknown[])] : [];
    const existing = current[index];

    if (isPlainObject(existing)) {
      current[index] = { ...existing, package: packageName };
    } else {
      current[index] = packageName;
    }

    this.patchPath('plugins', current);
  }

  updatePluginOptions(index: number, optionsJson: string): void {
    if (this.isPathMutationLocked('plugins')) {
      return;
    }

    const current = Array.isArray(this.getPath('plugins')) ? [...(this.getPath('plugins') as unknown[])] : [];
    const packageName =
      typeof current[index] === 'string'
        ? current[index]
        : isPlainObject(current[index])
          ? String((current[index] as JsonObject)['package'] ?? '')
          : '';
    const trimmed = optionsJson.trim();

    if (!trimmed) {
      current[index] = packageName;
      this.patchPath('plugins', current);
      this.error.set(null);

      return;
    }

    try {
      current[index] = { package: packageName, options: JSON.parse(trimmed) as unknown };
      this.patchPath('plugins', current);
      this.error.set(null);
    } catch {
      this.error.set($localize`:@@featureAgentConfig-invalidPluginOptions:Invalid plugin options JSON`);
    }
  }

  removePlugin(index: number): void {
    if (this.isPathMutationLocked('plugins')) {
      return;
    }

    const current = Array.isArray(this.getPath('plugins')) ? [...(this.getPath('plugins') as unknown[])] : [];
    current.splice(index, 1);
    this.patchPath('plugins', current.length ? current : undefined);
  }

  setWebsearchEnabled(enabled: boolean): void {
    if (this.isLocked('/websearch')) {
      return;
    }

    if (!enabled) {
      this.patchPath('websearch', false);

      return;
    }

    const current = this.getPath('websearch');

    if (isPlainObject(current)) {
      return;
    }

    this.patchPath('websearch', { provider: 'exa' });
  }

  setWebsearchProvider(provider: string): void {
    if (this.isLocked('/websearch')) {
      return;
    }

    this.patchPath('websearch', { provider });
  }

  setFormatterEnabled(enabled: boolean): void {
    if (this.isLocked('/formatter')) {
      return;
    }

    // Inherited formatter keys must remain; turning the root off would wipe parents.
    if (!enabled && this.inheritedKeys('/formatter').length > 0) {
      return;
    }

    if (!enabled) {
      this.patchPath('formatter', false);

      return;
    }

    const current = this.getPath('formatter');

    if (current === false || current === undefined) {
      this.patchPath('formatter', {});
    }
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  onSave(): void {
    this.error.set(null);

    if (this.mode() === 'raw') {
      if (!this.commitRawToConfig()) {
        return;
      }
    } else if (!this.commitOverrides()) {
      return;
    }

    const overlay = this.config();
    const overridesOverlay = this.overrides();
    const heredityError =
      validateOverlayAgainstHeredity(overlay, this.lockedPaths(), this.inheritedAdditive()) ??
      validateOverlayAgainstHeredity(overridesOverlay, this.lockedPaths(), this.inheritedAdditive());

    if (heredityError) {
      this.error.set(heredityError);

      return;
    }

    const secrets = this.buildSecretsPayload();
    const payload = {
      config: overlay,
      overrides: overridesOverlay,
      ...(secrets ? { secrets } : {}),
    };

    this.saving.set(true);
    this.saveRequest(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dto) => {
          this.applyDto(dto);
          this.saving.set(false);
          this.saved.emit(dto);
        },
        error: (err: { message?: string }) => {
          this.error.set(err.message ?? $localize`:@@featureAgentConfig-saveFailed:Failed to save configuration`);
          this.saving.set(false);
        },
      });
  }

  private currentSnapshot(): string {
    let configValue: JsonObject = this.config();
    let overridesValue: JsonObject = this.overrides();

    if (this.mode() === 'raw') {
      try {
        configValue = JSON.parse(this.rawJson()) as JsonObject;
        // Raw view is the composed layer; snapshot treats it as absorbed config with cleared overrides.
        overridesValue = {};
      } catch {
        return `__invalid_raw__:${this.rawJson()}\0${this.overridesJson()}\0${JSON.stringify(this.secretDrafts())}\0${[
          ...this.clearSecretKeys(),
        ]
          .sort()
          .join(',')}`;
      }
    } else {
      try {
        overridesValue = JSON.parse(this.overridesJson()) as JsonObject;
      } catch {
        return `__invalid_overrides__:${JSON.stringify(this.config())}\0${this.overridesJson()}\0${JSON.stringify(
          this.secretDrafts(),
        )}\0${[...this.clearSecretKeys()].sort().join(',')}`;
      }
    }

    return JSON.stringify({
      config: configValue,
      overrides: overridesValue,
      secretDrafts: this.secretDrafts(),
      clearSecretKeys: [...this.clearSecretKeys()].sort(),
    });
  }

  private captureBaseline(): void {
    this.baselineConfig.set(structuredClone(this.config()));
    this.baselineOverrides.set(structuredClone(this.overrides()));
    this.baselineSnapshot.set(this.currentSnapshot());
  }

  private readPath(root: JsonObject, path: string): unknown {
    const segments = path.split('.');
    let current: unknown = root;

    for (const segment of segments) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }

      current = (current as JsonObject)[segment];
    }

    return current;
  }

  private valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }

    if (left === undefined && right === undefined) {
      return true;
    }

    if (left === null && right === null) {
      return true;
    }

    return JSON.stringify(left) === JSON.stringify(right);
  }

  private pluginPackageName(entry: unknown): string | undefined {
    if (typeof entry === 'string') {
      return entry;
    }

    if (isPlainObject(entry) && typeof entry['package'] === 'string') {
      return entry['package'];
    }

    return undefined;
  }

  private pluginOptionsObject(entry: unknown): JsonObject | undefined {
    if (!isPlainObject(entry)) {
      return undefined;
    }

    const options = entry['options'];

    return isPlainObject(options) ? options : undefined;
  }

  private loadRequest() {
    const layer = this.layer();

    if (layer === 'global') {
      return this.opencodeConfigService.getGlobal();
    }

    const clientId = this.clientId();

    if (!clientId) {
      throw new Error('clientId is required');
    }

    if (layer === 'workspace') {
      return this.opencodeConfigService.getWorkspace(clientId);
    }

    const agentId = this.agentId();

    if (!agentId) {
      throw new Error('agentId is required');
    }

    return this.opencodeConfigService.getAgent(clientId, agentId);
  }

  private saveRequest(payload: { config: JsonObject; overrides: JsonObject; secrets?: Record<string, string> | null }) {
    const layer = this.layer();

    if (layer === 'global') {
      return this.opencodeConfigService.putGlobal(payload);
    }

    const clientId = this.clientId();

    if (!clientId) {
      throw new Error('clientId is required');
    }

    if (layer === 'workspace') {
      return this.opencodeConfigService.putWorkspace(clientId, payload);
    }

    const agentId = this.agentId();

    if (!agentId) {
      throw new Error('agentId is required');
    }

    return this.opencodeConfigService.putAgent(clientId, agentId, payload);
  }

  private applyDto(dto: OpencodeConfigDto): void {
    const migrated = migrateConfigV1ToV2((dto.config ?? {}) as JsonObject);
    const migratedOverrides = migrateConfigV1ToV2((dto.overrides ?? {}) as JsonObject);

    this.config.set(migrated);
    this.overrides.set(migratedOverrides);
    this.effective.set(migrateConfigV1ToV2((dto.effective ?? {}) as JsonObject));
    this.rawJson.set(JSON.stringify(composeLayerOverlay(migrated, migratedOverrides), null, 2));
    this.overridesJson.set(JSON.stringify(migratedOverrides, null, 2));
    this.lockedPaths.set(dto.lockedPaths ?? []);
    this.inheritedAdditive.set(dto.inheritedAdditive ?? []);
    this.secretKeys.set(dto.secretKeys ?? []);
    this.secretDrafts.set({});
    this.clearSecretKeys.set(new Set());
    this.draftProviderEnvName.set('');
    this.syncDefaultModelDraftsFromConfig();
    this.loading.set(false);
    this.validateRaw();
    this.validateOverrides();
    this.captureBaseline();
  }

  private syncDefaultModelDraftsFromConfig(): void {
    const parsed = parseProviderModelRef(this.stringValue('model'));

    this.draftDefaultModelProviderId.set(parsed?.providerId ?? '');
    this.draftDefaultModelId.set(parsed?.modelId ?? '');
  }

  private applyDefaultModelDrafts(): void {
    const provider = this.draftDefaultModelProviderId().trim();
    const model = this.draftDefaultModelId().trim();

    if (!provider || !model) {
      this.setString('model', '');

      return;
    }

    this.setString('model', formatProviderModelRef(provider, model));
  }

  private validateRaw(): void {
    try {
      const parsed = JSON.parse(this.rawJson()) as JsonObject;
      const message = validateOverlayAgainstHeredity(parsed, this.lockedPaths(), this.inheritedAdditive());

      this.rawError.set(message);
    } catch {
      this.rawError.set($localize`:@@featureAgentConfig-invalidJson:Invalid JSON`);
    }
  }

  private validateOverrides(): void {
    try {
      const parsed = JSON.parse(this.overridesJson()) as JsonObject;
      const message = validateOverlayAgainstHeredity(parsed, this.lockedPaths(), this.inheritedAdditive());

      this.overridesError.set(message);

      if (!message) {
        this.overrides.set(migrateConfigV1ToV2(parsed));
      }
    } catch {
      this.overridesError.set($localize`:@@featureAgentConfig-invalidJson:Invalid JSON`);
    }
  }

  /**
   * Commit Advanced overrides JSON into `overrides`.
   * Returns false when JSON/heredity validation fails.
   */
  private commitOverrides(): boolean {
    try {
      const parsed = JSON.parse(this.overridesJson()) as JsonObject;
      const message = validateOverlayAgainstHeredity(parsed, this.lockedPaths(), this.inheritedAdditive());

      if (message) {
        this.overridesError.set(message);
        this.error.set(message);

        return false;
      }

      this.overrides.set(migrateConfigV1ToV2(parsed));
      this.overridesError.set(null);

      return true;
    } catch {
      const message = $localize`:@@featureAgentConfig-invalidJson:Invalid JSON`;

      this.overridesError.set(message);
      this.error.set(message);

      return false;
    }
  }

  /**
   * Absorb Configuration JSON into `config` and clear overrides.
   * Raw view is compose(config, overrides); saving collapses that into structured config.
   */
  private commitRawToConfig(): boolean {
    try {
      const parsed = JSON.parse(this.rawJson()) as JsonObject;
      const message = validateOverlayAgainstHeredity(parsed, this.lockedPaths(), this.inheritedAdditive());

      if (message) {
        this.rawError.set(message);
        this.error.set(message);

        return false;
      }

      this.config.set(migrateConfigV1ToV2(parsed));
      this.overrides.set({});
      this.overridesJson.set('{}');
      this.rawError.set(null);
      this.overridesError.set(null);

      return true;
    } catch {
      const message = $localize`:@@featureAgentConfig-invalidJson:Invalid JSON`;

      this.rawError.set(message);
      this.error.set(message);

      return false;
    }
  }

  private buildSecretsPayload(): Record<string, string> | null {
    const payload: Record<string, string> = {};
    let touched = false;
    const providerEnvNames = new Set<string>();

    for (const entry of this.providerEntries()) {
      for (const envKey of this.providerEnvKeys(entry.key)) {
        providerEnvNames.add(envKey);
      }
    }

    const keys = new Set<string>([...NETWORK_KEYS, ...providerEnvNames, ...this.clearSecretKeys()]);

    for (const key of keys) {
      const value = this.secretDrafts()[key]?.trim() ?? '';

      if (value) {
        payload[key] = value;
        touched = true;
      } else if (this.clearSecretKeys().has(key)) {
        payload[key] = '';
        touched = true;
      }
    }

    return touched ? payload : null;
  }

  private isPathMutationLocked(path: string): boolean {
    const pointer = `/${path.replace(/\./g, '/')}`;
    const root = `/${path.split('.')[0]}`;

    return this.isLocked(pointer) || this.isLocked(root);
  }

  /**
   * Value shown in the structured editor: local overlay when set, otherwise the merged
   * effective value when the path is locked by a higher layer (so disabled fields are not blank).
   */
  private getDisplayPath(path: string): unknown {
    const local = this.getPath(path);

    if (local !== undefined) {
      return local;
    }

    if (this.isPathMutationLocked(path)) {
      return this.readPath(this.effective(), path);
    }

    return undefined;
  }

  private asObjectArray(value: unknown): JsonObject[] {
    return Array.isArray(value) ? value.filter(isPlainObject) : [];
  }

  private toPluginEntryView(
    item: unknown,
    index: number,
    inherited: boolean,
    dirty: boolean,
    deleted: boolean,
  ): {
    index: number;
    packageName: string;
    optionsJson: string;
    inherited: boolean;
    dirty: boolean;
    deleted: boolean;
  } {
    if (typeof item === 'string') {
      return {
        index,
        packageName: item,
        optionsJson: '',
        inherited,
        dirty,
        deleted,
      };
    }

    if (isPlainObject(item) && typeof item['package'] === 'string') {
      const options = item['options'];

      return {
        index,
        packageName: item['package'],
        optionsJson: options === undefined ? '' : JSON.stringify(options, null, 2),
        inherited,
        dirty,
        deleted,
      };
    }

    return {
      index,
      packageName: '',
      optionsJson: JSON.stringify(item, null, 2),
      inherited,
      dirty,
      deleted,
    };
  }

  private isMapKeyInherited(path: string, key: string): boolean {
    return this.inheritedKeys(`/${path.replace(/\./g, '/')}`).includes(key);
  }

  private getEffectiveMap(path: string): JsonObject | null {
    const segments = path.split('.');
    let current: unknown = this.effective();

    for (const segment of segments) {
      if (!isPlainObject(current)) {
        return null;
      }

      current = current[segment];
    }

    return isPlainObject(current) ? current : null;
  }

  private summarizeMapEntry(path: string, key: string, value: unknown): string {
    if (!isPlainObject(value)) {
      return key;
    }

    if (path === 'mcp.servers') {
      const type = typeof value['type'] === 'string' ? value['type'] : 'server';
      const target =
        type === 'remote'
          ? typeof value['url'] === 'string'
            ? value['url']
            : ''
          : Array.isArray(value['command'])
            ? value['command'].filter((part): part is string => typeof part === 'string').join(' ')
            : '';

      return `${type}${target ? ` · ${target}` : ''}`;
    }

    if (path === 'commands') {
      return typeof value['description'] === 'string' ? value['description'] : 'command';
    }

    if (path === 'agents') {
      const mode = typeof value['mode'] === 'string' ? value['mode'] : 'agent';
      const model = typeof value['model'] === 'string' ? value['model'] : '';

      return model ? `${mode} · ${model}` : mode;
    }

    if (path === 'references') {
      if (typeof value['path'] === 'string') {
        return `path · ${value['path']}`;
      }

      if (typeof value['repository'] === 'string') {
        return `git · ${value['repository']}`;
      }
    }

    if (path === 'providers') {
      const catalog = getBuiltinProvider(this.builtinProvidersCatalog(), key);
      const models = isPlainObject(value['models']) ? Object.keys(value['models']).length : 0;
      const modelSummary = models ? `${models} model(s)` : 'provider';

      return catalog ? `${catalog.name} · ${modelSummary}` : modelSummary;
    }

    if (path === 'formatter') {
      return value['disabled'] === true ? 'disabled' : 'enabled';
    }

    return key;
  }

  private replaceMapEntry(path: string, key: string, entry: JsonObject): void {
    if (this.isPathMutationLocked(path) || this.isMapKeyInherited(path, key)) {
      return;
    }

    const current = isPlainObject(this.getPath(path)) ? { ...(this.getPath(path) as JsonObject) } : {};
    current[key] = entry;
    this.patchPath(path, current);
  }

  private patchMapEntryField(path: string, key: string, field: string, value: unknown): void {
    if (this.isPathMutationLocked(path) || this.isMapKeyInherited(path, key)) {
      return;
    }

    const entry = { ...this.mapEntryObject(path, key) };
    this.setNested(entry, field, value);
    this.replaceMapEntry(path, key, entry);
  }

  private getNested(source: JsonObject, field: string): unknown {
    const segments = field.split('.');
    let current: unknown = source;

    for (const segment of segments) {
      if (!isPlainObject(current)) {
        return undefined;
      }

      current = current[segment];
    }

    return current;
  }

  private setNested(target: JsonObject, field: string, value: unknown): void {
    const segments = field.split('.');
    let cursor: JsonObject = target;

    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index];
      const next = cursor[segment];

      if (!isPlainObject(next)) {
        cursor[segment] = {};
      }

      cursor = cursor[segment] as JsonObject;
    }

    const leaf = segments[segments.length - 1];

    if (value === undefined) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = value as never;
    }
  }

  private getPath(path: string): unknown {
    const segments = path.split('.');
    let current: unknown = this.config();

    for (const segment of segments) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }

      current = (current as JsonObject)[segment];
    }

    return current;
  }

  private patchPath(path: string, value: unknown): void {
    const segments = path.split('.');
    const root = structuredClone(this.config());
    let cursor: JsonObject = root;

    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index];
      const next = cursor[segment];

      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        cursor[segment] = {};
      }

      cursor = cursor[segment] as JsonObject;
    }

    const leaf = segments[segments.length - 1];

    if (value === undefined) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = value as never;
    }

    this.pruneEmpty(root);
    this.config.set(root);
  }

  private pruneEmpty(node: JsonObject): void {
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.pruneEmpty(value as JsonObject);

        if (Object.keys(value as JsonObject).length === 0) {
          delete node[key];
        }
      }
    }
  }
}
