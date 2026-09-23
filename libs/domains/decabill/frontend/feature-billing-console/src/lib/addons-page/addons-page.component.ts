import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal, type WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AddonsFacade,
  AddonsService,
  MetersFacade,
  ServiceTypesFacade,
  type AddonConfigEnvVariableDefinition,
  type AddonConfigSchema,
  type AddonConfigSchemaInput,
  type AddonImplementationType,
  type AddonResponse,
  type AttachedMeterResponse,
  type BillingIntervalType,
  type CreateAddonDto,
  type MeterResponse,
  type ProviderDetail,
  type UpdateAddonDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, forkJoin, map, of, skip, switchMap, take } from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass, resolveNamedLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { MonacoEditorWrapperComponent } from '../monaco-editor-wrapper/monaco-editor-wrapper.component';
import { optionalNumberInputValue } from '../optional-number-input.util';

interface EnvVariableFormRow {
  key: string;
  label: string;
  description: string;
  showInOrderForm: boolean;
  defaultValue: string;
  useRandomDefault: boolean;
  randomDefaultLength: number;
  randomDefaultSpecialChars: boolean;
}

interface AddonForm {
  key: string;
  name: string;
  description: string;
  implementationType: AddonImplementationType;
  moduleKey: string;
  scriptTemplate: string;
  deprovisionScriptTemplate: string;
  compatibleProviders: string[];
  basePrice: string;
  priceIntervalType: BillingIntervalType;
  priceIntervalValue: number;
  isActive: boolean;
  environmentVariableRows: EnvVariableFormRow[];
  moduleEnvFields: AddonConfigEnvVariableDefinition[];
  moduleDefaultValues: Record<string, string>;
}

const MIN_RANDOM_DEFAULT_LENGTH = 21;

@Component({
  selector: 'framework-billing-addons-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MonacoEditorWrapperComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './addons-page.component.html',
  styleUrls: ['./addons-page.component.scss'],
})
export class AddonsPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteConfirmModalOpen = signal(false);

  private readonly facade = inject(AddonsFacade);
  private readonly addonsService = inject(AddonsService);
  private readonly metersFacade = inject(MetersFacade);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAddons-title:Addons`;
  readonly addAddonAriaLabel = $localize`:@@featureAddons-add:Add addon`;
  readonly searchPlaceholder = $localize`:@@featureAddons-searchPlaceholder:Search addons`;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly addons$ = this.facade.getAddons$();
  readonly providerOptions$ = this.serviceTypesFacade
    .getProviderDetails$()
    .pipe(map((providers) => providers.filter((provider) => provider.supportsAddons === true)));
  readonly activeMeters$ = this.metersFacade.getActiveMeters$();
  readonly loading$ = this.facade.getAddonsLoading$();
  readonly loadingAny$ = this.facade.getAddonsLoadingAny$();
  readonly creating$ = this.facade.getAddonsCreating$();
  readonly updating$ = this.facade.getAddonsUpdating$();
  readonly deleting$ = this.facade.getAddonsDeleting$();
  readonly error$ = this.facade.getAddonsError$();
  readonly implementationTypes: AddonImplementationType[] = ['module', 'cloud_init_script'];
  readonly intervalTypes: BillingIntervalType[] = ['hour', 'day', 'month', 'year'];
  readonly minRandomDefaultLength = MIN_RANDOM_DEFAULT_LENGTH;
  readonly scriptEnvHint = $localize`:@@featureAddons-scriptEnvHint:Use {{env.KEY}} placeholders in the script for configured environment variables.`;
  readonly deprovisionScriptHint = $localize`:@@featureAddons-deprovisionScriptHint:Leave empty for status-only mid-life removal (no SSH reverse script).`;
  readonly compareProviderId = (left: string, right: string): boolean => left === right;

  createForm = this.defaultForm();
  editForm: AddonForm & { id: string } = { ...this.defaultForm(), id: '' };
  addonToDelete: AddonResponse | null = null;
  createAttachedMeters: AttachedMeterResponse[] = [];
  editAttachedMeters: AttachedMeterResponse[] = [];
  createAddonMeterAttachMeterId = '';
  createAddonMeterAttachUnitPrice: string | number | null = '';
  createAddonMeterAttachIncludedUsage: string | number | null = '';
  editAddonMeterAttachMeterId = '';
  editAddonMeterAttachUnitPrice: string | number | null = '';
  editAddonMeterAttachIncludedUsage: string | number | null = '';
  addonMeterAttachLoading = false;
  addonMeterAttachError: string | null = null;

  ngOnInit(): void {
    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadAddons({ search: search.trim() || undefined });
      });

    this.facade.loadAddons();
    this.metersFacade.loadMeters();
    this.serviceTypesFacade.loadProviderDetails();
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    this.createForm = this.defaultForm();
    this.metersFacade.loadMeters();
    this.createAttachedMeters = [];
    this.resetAddonMeterAttachForm('create');
    this.addonMeterAttachError = null;
    this.openModalWithMonacoLayout(this.createModalOpen);
  }

  openEditModal(addon: AddonResponse): void {
    this.metersFacade.loadMeters();
    this.addonsService
      .getAddon(addon.id)
      .pipe(take(1))
      .subscribe((detail) => {
        const envFields = this.parseEnvFields(detail.configSchema);
        const isScript = detail.implementationType === 'cloud_init_script';

        this.editForm = {
          id: detail.id,
          key: detail.key,
          name: detail.name,
          description: detail.description ?? '',
          implementationType: detail.implementationType,
          moduleKey: detail.moduleKey ?? '',
          scriptTemplate: detail.scriptTemplate ?? '',
          deprovisionScriptTemplate: detail.deprovisionScriptTemplate ?? '',
          compatibleProviders: [...detail.compatibleProviders],
          basePrice: detail.basePrice ?? '',
          priceIntervalType: detail.priceIntervalType ?? 'month',
          priceIntervalValue: detail.priceIntervalValue ?? 1,
          isActive: detail.isActive,
          environmentVariableRows: isScript
            ? envFields.map((row) => ({
                key: row.key,
                label: row.label,
                description: row.description ?? '',
                showInOrderForm: row.showInOrderForm,
                defaultValue: row.useRandomDefault ? '' : (detail.defaultValues?.[row.key] ?? ''),
                useRandomDefault: row.useRandomDefault === true,
                randomDefaultLength: row.randomDefaultLength ?? MIN_RANDOM_DEFAULT_LENGTH,
                randomDefaultSpecialChars: row.randomDefaultSpecialChars === true,
              }))
            : [],
          moduleEnvFields: isScript ? [] : envFields,
          moduleDefaultValues: isScript
            ? {}
            : Object.fromEntries(
                envFields
                  .filter((row) => row.useRandomDefault !== true)
                  .map((row) => [row.key, detail.defaultValues?.[row.key] ?? '']),
              ),
        };
        showBillingModal(this.editModalOpen);
        this.resetAddonMeterAttachForm('edit');
        this.addonMeterAttachError = null;
        this.editAttachedMeters = detail.meters ?? [];
        this.loadAddonAttachedMeters(detail.id);
        this.scheduleMonacoLayout();
      });
  }

  attachedMetersFor(mode: string): AttachedMeterResponse[] {
    return mode === 'create' ? this.createAttachedMeters : this.editAttachedMeters;
  }

  availableMetersForAddonAttach(meters: MeterResponse[] | null, mode: string): MeterResponse[] {
    const attachedIds = new Set(this.attachedMetersFor(mode).map((item) => item.meterId));

    return (meters ?? []).filter((meter) => !attachedIds.has(meter.id));
  }

  loadAddonAttachedMeters(addonId: string): void {
    this.addonMeterAttachLoading = true;
    this.addonMeterAttachError = null;
    this.addonsService
      .listAddonMeters(addonId)
      .pipe(take(1))
      .subscribe({
        next: (meters) => {
          this.editAttachedMeters = meters;
          this.addonMeterAttachLoading = false;
        },
        error: (error: unknown) => {
          this.addonMeterAttachError = this.formatMeterHttpError(error, 'Failed to load addon meters');
          this.addonMeterAttachLoading = false;
        },
      });
  }

  resetAddonMeterAttachForm(mode: string): void {
    if (mode === 'create') {
      this.createAddonMeterAttachMeterId = '';
      this.createAddonMeterAttachUnitPrice = '';
      this.createAddonMeterAttachIncludedUsage = '';
      return;
    }

    this.editAddonMeterAttachMeterId = '';
    this.editAddonMeterAttachUnitPrice = '';
    this.editAddonMeterAttachIncludedUsage = '';
  }

  attachAddonMeter(mode: string): void {
    const meterId = mode === 'create' ? this.createAddonMeterAttachMeterId : this.editAddonMeterAttachMeterId;
    const unitPriceRaw = optionalNumberInputValue(
      mode === 'create' ? this.createAddonMeterAttachUnitPrice : this.editAddonMeterAttachUnitPrice,
    );
    const includedUsageRaw = optionalNumberInputValue(
      mode === 'create' ? this.createAddonMeterAttachIncludedUsage : this.editAddonMeterAttachIncludedUsage,
    );

    if (!meterId) return;

    if (mode === 'create') {
      this.addonMeterAttachError = null;
      this.activeMeters$.pipe(take(1)).subscribe((meters) => {
        const meter = meters.find((item) => item.id === meterId);

        if (!meter) {
          this.addonMeterAttachError = 'Selected meter is not available';
          return;
        }

        const override = unitPriceRaw ? Number(unitPriceRaw) : null;
        const includedOverride = includedUsageRaw ? Number(includedUsageRaw) : null;

        this.createAttachedMeters = [
          ...this.createAttachedMeters,
          this.toPendingAttachedMeter(
            meter,
            Number.isFinite(override as number) ? override : null,
            Number.isFinite(includedOverride as number) ? includedOverride : null,
          ),
        ];
        this.resetAddonMeterAttachForm('create');
      });

      return;
    }

    if (!this.editForm.id) return;

    this.addonMeterAttachLoading = true;
    this.addonMeterAttachError = null;
    this.addonsService
      .attachAddonMeter(this.editForm.id, {
        meterId,
        unitPriceNet: unitPriceRaw ? Number(unitPriceRaw) : undefined,
        includedUsage: includedUsageRaw ? Number(includedUsageRaw) : undefined,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.resetAddonMeterAttachForm('edit');
          this.loadAddonAttachedMeters(this.editForm.id);
          this.facade.loadAddons();
        },
        error: (error: unknown) => {
          this.addonMeterAttachError = this.formatMeterHttpError(error, 'Failed to attach meter');
          this.addonMeterAttachLoading = false;
        },
      });
  }

  updateAttachedAddonMeter(
    mode: string,
    meter: AttachedMeterResponse,
    unitPriceInput: string,
    includedUsageInput: string,
  ): void {
    const trimmed = unitPriceInput.trim();
    const override = trimmed ? Number(trimmed) : null;
    const includedTrimmed = includedUsageInput.trim();
    const includedOverride = includedTrimmed ? Number(includedTrimmed) : null;

    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.map((item) =>
        item.meterId === meter.meterId
          ? {
              ...item,
              unitPriceNetOverride: Number.isFinite(override as number) ? override : null,
              effectiveUnitPriceNet:
                Number.isFinite(override as number) && override != null ? override : item.defaultUnitPriceNet,
              includedUsageOverride: Number.isFinite(includedOverride as number) ? includedOverride : null,
              effectiveIncludedUsage:
                Number.isFinite(includedOverride as number) && includedOverride != null
                  ? includedOverride
                  : item.defaultIncludedUsage,
            }
          : item,
      );

      return;
    }

    if (!this.editForm.id) return;

    this.addonMeterAttachLoading = true;
    this.addonMeterAttachError = null;
    this.addonsService
      .updateAddonMeter(this.editForm.id, meter.meterId, {
        unitPriceNet: trimmed ? Number(trimmed) : null,
        includedUsage: includedTrimmed ? Number(includedTrimmed) : null,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadAddonAttachedMeters(this.editForm.id);
          this.facade.loadAddons();
        },
        error: (error: unknown) => {
          this.addonMeterAttachError = this.formatMeterHttpError(error, 'Failed to update meter price');
          this.addonMeterAttachLoading = false;
        },
      });
  }

  detachAddonMeter(mode: string, meterId: string): void {
    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.filter((item) => item.meterId !== meterId);

      return;
    }

    if (!this.editForm.id) return;

    this.addonMeterAttachLoading = true;
    this.addonMeterAttachError = null;
    this.addonsService
      .detachAddonMeter(this.editForm.id, meterId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadAddonAttachedMeters(this.editForm.id);
          this.facade.loadAddons();
        },
        error: (error: unknown) => {
          this.addonMeterAttachError = this.formatMeterHttpError(error, 'Failed to detach meter');
          this.addonMeterAttachLoading = false;
        },
      });
  }

  attachedMeterOverrideInput(meter: AttachedMeterResponse): string {
    return meter.unitPriceNetOverride != null ? String(meter.unitPriceNetOverride) : '';
  }

  attachedMeterIncludedUsageOverrideInput(meter: AttachedMeterResponse): string {
    return meter.includedUsageOverride != null ? String(meter.includedUsageOverride) : '';
  }

  addonMeterCount(addon: AddonResponse): number {
    return addon.meters?.length ?? 0;
  }

  private toPendingAttachedMeter(
    meter: MeterResponse,
    unitPriceNetOverride: number | null,
    includedUsageOverride: number | null,
  ): AttachedMeterResponse {
    return {
      meterId: meter.id,
      key: meter.key,
      name: meter.name,
      description: meter.description ?? null,
      unitLabel: meter.unitLabel ?? null,
      aggregator: meter.aggregator,
      defaultUnitPriceNet: meter.defaultUnitPriceNet,
      unitPriceNetOverride,
      effectiveUnitPriceNet: unitPriceNetOverride != null ? unitPriceNetOverride : meter.defaultUnitPriceNet,
      defaultIncludedUsage: meter.defaultIncludedUsage ?? 0,
      includedUsageOverride,
      effectiveIncludedUsage: includedUsageOverride != null ? includedUsageOverride : (meter.defaultIncludedUsage ?? 0),
      isActive: meter.isActive,
      source: 'manual',
      required: false,
    };
  }

  private flushPendingCreateAddonMeters(pendingMeters?: AttachedMeterResponse[]): void {
    const pending = pendingMeters ?? [...this.createAttachedMeters];

    if (pending.length === 0) {
      return;
    }

    this.facade
      .getSelectedAddon$()
      .pipe(
        take(1),
        switchMap((addon) => {
          if (!addon) {
            return of(null);
          }

          return forkJoin(
            pending.map((meter) =>
              this.addonsService
                .attachAddonMeter(addon.id, {
                  meterId: meter.meterId,
                  unitPriceNet: meter.unitPriceNetOverride ?? undefined,
                  includedUsage: meter.includedUsageOverride ?? undefined,
                })
                .pipe(catchError(() => of(null))),
            ),
          );
        }),
        take(1),
      )
      .subscribe(() => this.facade.loadAddons());
  }

  private formatMeterHttpError(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error) {
      const body = (error as { error?: unknown }).error;

      if (typeof body === 'string' && body.trim()) {
        return body.trim();
      }

      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;

        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }

        if (Array.isArray(message) && message.length > 0) {
          return message.map(String).join(', ');
        }
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return fallback;
  }

  openDeleteConfirm(addon: AddonResponse): void {
    this.addonToDelete = addon;
    showBillingModal(this.deleteConfirmModalOpen);
  }

  onSubmitCreate(): void {
    if (!this.isValid(this.createForm)) return;

    this.facade.createAddon(this.buildCreateDto(this.createForm));
  }

  onSubmitEdit(): void {
    if (!this.editForm.id || !this.isValid(this.editForm)) return;

    this.facade.updateAddon(this.editForm.id, this.buildUpdateDto(this.editForm));
  }

  confirmDelete(): void {
    if (this.addonToDelete) this.facade.deleteAddon(this.addonToDelete.id);
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
  }

  implementationTypeLabel(type: AddonImplementationType): string {
    return type === 'module'
      ? $localize`:@@featureAddons-module:Module`
      : $localize`:@@featureAddons-cloudInitScript:Cloud-init script`;
  }

  formatPrice(addon: AddonResponse): string {
    if (!addon.basePrice || !addon.priceIntervalType || !addon.priceIntervalValue) {
      return $localize`:@@featureAddons-free:Free`;
    }

    return `€${addon.basePrice} / ${addon.priceIntervalValue} ${addon.priceIntervalType}`;
  }

  configFieldCount(addon: AddonResponse): number {
    const schema = addon.configSchema as { environmentVariables?: unknown[] } | undefined;

    return Array.isArray(schema?.environmentVariables) ? schema.environmentVariables.length : 0;
  }

  compatibleProvidersLabel(addon: AddonResponse): string {
    if (!addon.compatibleProviders?.length) {
      return $localize`:@@featureAddons-allProviders:All providers`;
    }

    return addon.compatibleProviders.join(', ');
  }

  onImplementationTypeChange(form: AddonForm): void {
    if (form.implementationType === 'module') {
      form.scriptTemplate = '';
      form.deprovisionScriptTemplate = '';
      form.environmentVariableRows = [];
    } else {
      form.moduleKey = '';
      form.moduleEnvFields = [];
      form.moduleDefaultValues = {};
    }
  }

  addEnvVariable(form: AddonForm): void {
    form.environmentVariableRows = [
      ...form.environmentVariableRows,
      {
        key: '',
        label: '',
        description: '',
        showInOrderForm: false,
        defaultValue: '',
        useRandomDefault: false,
        randomDefaultLength: MIN_RANDOM_DEFAULT_LENGTH,
        randomDefaultSpecialChars: false,
      },
    ];
  }

  removeEnvVariable(form: AddonForm, index: number): void {
    const list = [...form.environmentVariableRows];

    list.splice(index, 1);
    form.environmentVariableRows = list;
  }

  moveEnvVariable(form: AddonForm, index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;
    const list = [...form.environmentVariableRows];

    if (targetIndex < 0 || targetIndex >= list.length) return;

    [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
    form.environmentVariableRows = list;
  }

  onEnvRandomDefaultChange(row: EnvVariableFormRow, checked: boolean): void {
    row.useRandomDefault = checked;

    if (checked) {
      row.defaultValue = '';
    }
  }

  getModuleDefaultValue(form: AddonForm, key: string): string {
    return form.moduleDefaultValues[key] ?? '';
  }

  setModuleDefaultValue(form: AddonForm, key: string, value: string): void {
    form.moduleDefaultValues = {
      ...form.moduleDefaultValues,
      [key]: value,
    };
  }

  showModuleDefaultsSection(form: AddonForm): boolean {
    return form.implementationType === 'module' && form.moduleEnvFields.length > 0;
  }

  onCompatibleProvidersChange(form: AddonForm, selected: string[] | string | null): void {
    const values = Array.isArray(selected) ? selected : selected ? [selected] : [];

    form.compatibleProviders = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  }

  providerOptionLabel(provider: ProviderDetail): string {
    return resolveNamedLabel(provider.displayName);
  }

  private isValid(form: AddonForm): boolean {
    const implementationValue =
      form.implementationType === 'module' ? form.moduleKey.trim() : form.scriptTemplate.trim();

    return Boolean(form.key.trim() && form.name.trim() && implementationValue);
  }

  private buildCreateDto(form: AddonForm): CreateAddonDto {
    const price = form.basePrice.trim();
    const dto: CreateAddonDto = {
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      implementationType: form.implementationType,
      moduleKey: form.implementationType === 'module' ? form.moduleKey.trim() : undefined,
      scriptTemplate: form.implementationType === 'cloud_init_script' ? form.scriptTemplate.trim() : undefined,
      deprovisionScriptTemplate:
        form.implementationType === 'cloud_init_script' ? form.deprovisionScriptTemplate.trim() : undefined,
      compatibleProviders: [...form.compatibleProviders],
      basePrice: price || undefined,
      priceIntervalType: price ? form.priceIntervalType : undefined,
      priceIntervalValue: price ? Math.max(1, Number(form.priceIntervalValue) || 1) : undefined,
      isActive: form.isActive,
    };

    this.applyConfigPayload(dto, form);

    return dto;
  }

  private buildUpdateDto(form: AddonForm): UpdateAddonDto {
    const createDto = this.buildCreateDto(form);

    return {
      name: createDto.name,
      description: createDto.description,
      implementationType: createDto.implementationType,
      moduleKey: createDto.moduleKey ?? null,
      scriptTemplate: createDto.scriptTemplate ?? null,
      deprovisionScriptTemplate: createDto.deprovisionScriptTemplate ?? null,
      configSchema: createDto.configSchema,
      defaultValues: createDto.defaultValues,
      compatibleProviders: createDto.compatibleProviders,
      basePrice: createDto.basePrice ?? null,
      priceIntervalType: createDto.priceIntervalType ?? null,
      priceIntervalValue: createDto.priceIntervalValue ?? null,
      isActive: createDto.isActive,
    };
  }

  private applyConfigPayload(dto: CreateAddonDto, form: AddonForm): void {
    if (form.implementationType === 'cloud_init_script') {
      const { environmentVariables, defaultValues } = this.buildEnvPayload(form.environmentVariableRows);
      const configSchema: AddonConfigSchemaInput = { environmentVariables };

      dto.configSchema = configSchema;
      dto.defaultValues = defaultValues;

      return;
    }

    if (!this.showModuleDefaultsSection(form)) {
      return;
    }

    const defaultValues: Record<string, string> = {};

    for (const field of form.moduleEnvFields) {
      if (field.useRandomDefault) {
        continue;
      }

      const value = (form.moduleDefaultValues[field.key] ?? '').trim();

      if (value) {
        defaultValues[field.key] = value;
      }
    }

    dto.defaultValues = defaultValues;
  }

  private buildEnvPayload(rows: EnvVariableFormRow[]): {
    environmentVariables: AddonConfigSchemaInput['environmentVariables'];
    defaultValues: Record<string, string>;
  } {
    const environmentVariables: AddonConfigSchemaInput['environmentVariables'] = [];
    const defaultValues: Record<string, string> = {};

    for (const row of rows) {
      const key = row.key?.trim() ?? '';
      const label = row.label?.trim() ?? '';

      if (!key || !label) {
        continue;
      }

      environmentVariables.push({
        key,
        label,
        description: row.description?.trim() || undefined,
        showInOrderForm: row.showInOrderForm === true,
        ...(row.useRandomDefault
          ? {
              useRandomDefault: true,
              randomDefaultLength: Math.max(
                MIN_RANDOM_DEFAULT_LENGTH,
                Number(row.randomDefaultLength) || MIN_RANDOM_DEFAULT_LENGTH,
              ),
              randomDefaultSpecialChars: row.randomDefaultSpecialChars === true,
            }
          : {}),
      });

      if (!row.useRandomDefault) {
        const defaultValue = row.defaultValue?.trim();

        if (defaultValue) {
          defaultValues[key] = defaultValue;
        }
      }
    }

    return { environmentVariables, defaultValues };
  }

  private parseEnvFields(schema: AddonResponse['configSchema']): AddonConfigEnvVariableDefinition[] {
    if (!schema || typeof schema !== 'object') {
      return [];
    }

    const raw = (schema as AddonConfigSchema).environmentVariables;

    return Array.isArray(raw) ? raw : [];
  }

  private defaultForm(): AddonForm {
    return {
      key: '',
      name: '',
      description: '',
      implementationType: 'module',
      moduleKey: '',
      scriptTemplate: '',
      deprovisionScriptTemplate: '',
      compatibleProviders: [],
      basePrice: '',
      priceIntervalType: 'month',
      priceIntervalValue: 1,
      isActive: true,
      environmentVariableRows: [],
      moduleEnvFields: [],
      moduleDefaultValues: {},
    };
  }

  private openModalWithMonacoLayout(open: WritableSignal<boolean>): void {
    showBillingModal(open);
    this.scheduleMonacoLayout();
  }

  private scheduleMonacoLayout(): void {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        const pendingMeters = [...this.createAttachedMeters];
        this.createForm = this.defaultForm();
        this.createAttachedMeters = [];
        this.resetAddonMeterAttachForm('create');
        this.addonMeterAttachError = null;
        this.flushPendingCreateAddonMeters(pendingMeters);
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.editForm = { ...this.defaultForm(), id: '' };
        this.editAttachedMeters = [];
        this.resetAddonMeterAttachForm('edit');
        this.addonMeterAttachError = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.addonToDelete = null;
      },
    });
  }
}
