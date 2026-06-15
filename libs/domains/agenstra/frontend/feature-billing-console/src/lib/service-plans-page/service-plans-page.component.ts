import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ServicePlansFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  type BillingIntervalType,
  type CreateServicePlanDto,
  type ProviderDetail,
  type ServerType,
  type ServicePlanOrderingHighlight,
  type ServicePlanResponse,
  type ServiceTypeResponse,
  type UpdateServicePlanDto,
} from '@forepath/agenstra/frontend/data-access-billing-console';
import { combineLatest, map, take } from 'rxjs';
import { filter, pairwise } from 'rxjs';

/** Schema property: type, description, and optional enum for pre-defined values. */
interface ConfigSchemaProperty {
  type?: string;
  description?: string;
  enum?: (string | number)[];
}
/** Schema properties object: key -> property definition. */
type ConfigSchemaProperties = Record<string, ConfigSchemaProperty>;

@Component({
  selector: 'framework-billing-service-plans-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './service-plans-page.component.html',
  styleUrls: ['./service-plans-page.component.scss'],
})
export class ServicePlansPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteConfirmModal', { static: false }) private deleteConfirmModal!: ElementRef<HTMLDivElement>;

  private readonly plansFacade = inject(ServicePlansFacade);
  private readonly typesFacade = inject(ServiceTypesFacade);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly servicePlans$ = this.plansFacade.getServicePlans$();
  readonly serviceTypes$ = this.typesFacade.getServiceTypes$();
  /** Combined service types + provider details for template (single async). */
  readonly typesAndProviders$ = combineLatest([
    this.typesFacade.getServiceTypes$(),
    this.typesFacade.getProviderDetails$(),
  ]).pipe(map(([serviceTypes, providerDetails]) => ({ serviceTypes, providerDetails })));
  readonly loading$ = this.plansFacade.getServicePlansLoading$();
  readonly loadingAny$ = this.plansFacade.getServicePlansLoadingAny$();
  readonly error$ = this.plansFacade.getServicePlansError$();
  readonly creating$ = this.plansFacade.getServicePlansCreating$();
  readonly updating$ = this.plansFacade.getServicePlansUpdating$();
  readonly deleting$ = this.plansFacade.getServicePlansDeleting$();

  readonly billingIntervalTypes: BillingIntervalType[] = ['hour', 'day', 'month'];

  createForm: CreateServicePlanDto = this.getDefaultCreateForm();
  editForm: UpdateServicePlanDto & { id: string } = this.getDefaultEditForm();
  planToDelete: ServicePlanResponse | null = null;
  /** Plan currently being edited; used to resolve provider schema for edit form. */
  editingPlan: ServicePlanResponse | null = null;
  /** Server types for the current provider when config has basePriceFromField (e.g. serverType). */
  currentServerTypes: ServerType[] = [];
  serverTypesLoading = false;

  serviceTypeNameById(types: ServiceTypeResponse[] | null, id: string): string {
    if (!types) return id;

    const t = types.find((x) => x.id === id);

    return t?.name ?? id;
  }

  billingIntervalLabel(plan: ServicePlanResponse): string {
    return `${plan.billingIntervalValue} ${plan.billingIntervalType}(s)`;
  }

  /** Calculates total price from plan (base + margin). Same formula as backend PricingService. */
  getPlanTotalPrice(plan: ServicePlanResponse): number | null {
    return this.getEstimatedPrice(
      plan.basePrice ?? undefined,
      plan.marginPercent ?? undefined,
      plan.marginFixed ?? undefined,
    );
  }

  /** Formats plan price for display in list (e.g. "€4.51" or "—"). */
  formatPlanPrice(plan: ServicePlanResponse): string {
    return this.formatEstimatedPrice(this.getPlanTotalPrice(plan));
  }

  /** Resolve provider config schema (properties) for a service type, or null. */
  getProviderSchema(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string,
  ): ConfigSchemaProperties | null {
    if (!serviceTypeId?.trim() || !serviceTypes?.length || !providerDetails?.length) return null;

    const serviceType = serviceTypes.find((st) => st.id === serviceTypeId);

    if (!serviceType?.provider) return null;

    const detail = providerDetails.find((p) => p.id === serviceType.provider);
    const schema = detail?.configSchema as { properties?: ConfigSchemaProperties } | undefined;

    return schema?.properties ?? null;
  }

  /** Resolve full provider config schema for a service type (for basePriceFromField etc.). */
  /**
   * True when the merged provider schema has region or location as string with a non-empty string enum (checkout UX).
   */
  supportsCustomerLocationSelection(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string,
  ): boolean {
    const full = this.getProviderSchemaFull(serviceTypes, providerDetails, serviceTypeId);
    const props = full?.['properties'] as ConfigSchemaProperties | undefined;

    if (!props) return false;

    const ok = (key: 'region' | 'location'): boolean => {
      const p = props[key];

      if (!p || typeof p !== 'object') return false;

      if (String(p.type) !== 'string') return false;

      const e = p.enum;

      return Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'string');
    };

    return ok('region') || ok('location');
  }

  getProviderSchemaFull(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string,
  ): Record<string, unknown> | null {
    if (!serviceTypeId?.trim() || !serviceTypes?.length || !providerDetails?.length) return null;

    const serviceType = serviceTypes.find((st) => st.id === serviceTypeId);

    if (!serviceType?.provider) return null;

    const detail = providerDetails.find((p) => p.id === serviceType.provider);

    return (detail?.configSchema as Record<string, unknown>) ?? null;
  }

  /** Field name that drives base price when selected (e.g. serverType). When set, UI fetches options from server-types API. */
  getBasePriceFromField(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string,
  ): string | null {
    const schema = this.getProviderSchemaFull(serviceTypes, providerDetails, serviceTypeId);
    const field = schema?.['basePriceFromField'];

    return typeof field === 'string' && field ? field : null;
  }

  /** Provider id for the given service type. */
  getProviderId(serviceTypes: ServiceTypeResponse[] | null, serviceTypeId: string): string | null {
    if (!serviceTypeId?.trim() || !serviceTypes?.length) return null;

    const st = serviceTypes.find((s) => s.id === serviceTypeId);

    return st?.provider ?? null;
  }

  getProviderConfigKeys(schema: ConfigSchemaProperties | null): string[] {
    return schema ? Object.keys(schema) : [];
  }

  getProviderConfigPropertyType(schema: ConfigSchemaProperties | null, key: string): 'string' | 'number' {
    const prop = schema?.[key];
    const t = prop && typeof prop === 'object' && 'type' in prop ? String(prop.type) : 'string';

    return t === 'number' ? 'number' : 'string';
  }

  getProviderConfigPropertyDescription(schema: ConfigSchemaProperties | null, key: string): string {
    const prop = schema?.[key];

    return prop && typeof prop === 'object' && 'description' in prop ? String(prop.description) : '';
  }

  /**
   * Returns predefined enum values for a property if present; otherwise null.
   * When non-null and non-empty, the UI should render a select instead of a text/number input.
   */
  getProviderConfigEnum(schema: ConfigSchemaProperties | null, key: string): (string | number)[] | null {
    const prop = schema?.[key];

    if (!prop || typeof prop !== 'object' || !Array.isArray(prop.enum)) return null;

    const arr = prop.enum.filter((v) => v !== undefined && v !== null);

    return arr.length > 0 ? arr : null;
  }

  /** When create form service type changes, init providerConfigDefaults from schema and load server types if needed. */
  onCreateServiceTypeIdChange(serviceTypes: ServiceTypeResponse[], providerDetails: ProviderDetail[]): void {
    const schema = this.getProviderSchema(serviceTypes, providerDetails, this.createForm.serviceTypeId);

    this.createForm.providerConfigDefaults = this.createForm.providerConfigDefaults ?? {};

    if (schema) {
      const basePriceField = this.getBasePriceFromField(serviceTypes, providerDetails, this.createForm.serviceTypeId);

      for (const key of Object.keys(schema)) {
        if (this.createForm.providerConfigDefaults[key] === undefined) {
          if (key === basePriceField) {
            continue;
          }

          const enumValues = this.getProviderConfigEnum(schema, key);

          if (enumValues && enumValues.length > 0) {
            this.createForm.providerConfigDefaults[key] = enumValues[0];
          } else {
            this.createForm.providerConfigDefaults[key] =
              this.getProviderConfigPropertyType(schema, key) === 'number' ? 0 : '';
          }
        }
      }

      if (basePriceField) {
        const providerId = this.getProviderId(serviceTypes, this.createForm.serviceTypeId);

        if (providerId) this.loadServerTypes(providerId);
      } else {
        this.currentServerTypes = [];
      }
    } else {
      this.currentServerTypes = [];
    }

    if (!this.supportsCustomerLocationSelection(serviceTypes, providerDetails, this.createForm.serviceTypeId)) {
      this.createForm.allowCustomerLocationSelection = false;
    }
  }

  private loadServerTypes(providerId: string): void {
    this.serverTypesLoading = true;
    this.currentServerTypes = [];
    this.serviceTypesService.getProviderServerTypes(providerId).subscribe({
      next: (list) => {
        this.currentServerTypes = list;
        this.serverTypesLoading = false;
      },
      error: () => {
        this.serverTypesLoading = false;
        this.currentServerTypes = [];
      },
    });
  }

  /** When user selects a server type in create form, set base price from selection. */
  onServerTypeSelectCreate(serverTypeId: string): void {
    const st = this.currentServerTypes.find((s) => s.id === serverTypeId);

    if (st?.priceMonthly != null) {
      this.createForm.basePrice = String(st.priceMonthly);
    }
  }

  /** When user selects a server type in edit form, set base price from selection. */
  onServerTypeSelectEdit(serverTypeId: string): void {
    const st = this.currentServerTypes.find((s) => s.id === serverTypeId);

    if (st?.priceMonthly != null) {
      this.editForm.basePrice = String(st.priceMonthly);
    }
  }

  addOrderingHighlight(form: 'create' | 'edit'): void {
    const row: ServicePlanOrderingHighlight = { icon: '', text: '' };

    if (form === 'create') {
      this.createForm.orderingHighlights = [...(this.createForm.orderingHighlights ?? []), row];
    } else {
      this.editForm.orderingHighlights = [...(this.editForm.orderingHighlights ?? []), row];
    }
  }

  removeOrderingHighlight(form: 'create' | 'edit', index: number): void {
    if (form === 'create') {
      const list = [...(this.createForm.orderingHighlights ?? [])];

      list.splice(index, 1);
      this.createForm.orderingHighlights = list;
    } else {
      const list = [...(this.editForm.orderingHighlights ?? [])];

      list.splice(index, 1);
      this.editForm.orderingHighlights = list;
    }
  }

  moveOrderingHighlight(form: 'create' | 'edit', index: number, direction: -1 | 1): void {
    const formRef = form === 'create' ? this.createForm : this.editForm;
    const list = [...(formRef.orderingHighlights ?? [])];
    const next = index + direction;

    if (next < 0 || next >= list.length) return;

    [list[index], list[next]] = [list[next], list[index]];
    formRef.orderingHighlights = list;
  }

  private sanitizeOrderingHighlights(
    highlights: ServicePlanOrderingHighlight[] | undefined,
  ): ServicePlanOrderingHighlight[] {
    if (!highlights?.length) return [];

    return highlights
      .map((h) => ({ icon: h.icon?.trim() ?? '', text: h.text?.trim() ?? '' }))
      .filter((h) => h.icon.length > 0 && h.text.length > 0);
  }

  orderingHighlightCount(plan: ServicePlanResponse): number {
    return plan.orderingHighlights?.length ?? 0;
  }

  formatServerTypeOption(st: ServerType): string {
    const name = st.name ?? st.id ?? '';
    const cores = st.cores ?? 0;
    const memory = st.memory ?? 0;
    const disk = st.disk ?? 0;
    const parts = [name, `- ${cores} vCPU, ${memory}GB RAM, ${disk}GB Disk`];

    if (st.priceMonthly != null) {
      parts.push(`- €${this.formatPrice(st.priceMonthly)}/month`);
    }

    const label = parts.join(' ').trim();

    return label || String(st.id ?? '');
  }

  private formatPrice(value: number | string): string {
    const n = typeof value === 'number' ? value : Number(value);

    if (Number.isNaN(n)) return String(value);

    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  /** Parses form value to number; returns 0 for empty/invalid. */
  private parseFormNumber(value: string | number | undefined): number {
    if (value === undefined || value === null) return 0;

    const n = typeof value === 'number' ? value : Number(String(value).trim());

    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Estimated total price from base + margin (same formula as backend PricingService).
   * Returns null when base price is missing or invalid.
   */
  getEstimatedPrice(
    basePrice: string | number | undefined,
    marginPercent: string | number | undefined,
    marginFixed: string | number | undefined,
  ): number | null {
    const base = this.parseFormNumber(basePrice);

    if (base <= 0) return null;

    const marginPct = this.parseFormNumber(marginPercent);
    const marginFix = this.parseFormNumber(marginFixed);

    return base + base * (marginPct / 100) + marginFix;
  }

  /** Formats estimated price for display (e.g. "€4.51" or "—"). */
  formatEstimatedPrice(total: number | null): string {
    if (total === null) return '—';

    return `€${this.formatPrice(total)}`;
  }

  private getDefaultCreateForm(): CreateServicePlanDto {
    return {
      serviceTypeId: '',
      name: '',
      description: '',
      billingIntervalType: 'month',
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      cancelAtPeriodEnd: false,
      minCommitmentDays: 0,
      noticeDays: 0,
      basePrice: undefined,
      marginPercent: undefined,
      marginFixed: undefined,
      providerConfigDefaults: {},
      orderingHighlights: [],
      allowCustomerLocationSelection: false,
      isActive: true,
    };
  }

  private getDefaultEditForm(): UpdateServicePlanDto & { id: string } {
    return {
      id: '',
      name: '',
      description: '',
      billingIntervalType: 'month',
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      cancelAtPeriodEnd: false,
      minCommitmentDays: 0,
      noticeDays: 0,
      basePrice: undefined,
      marginPercent: undefined,
      marginFixed: undefined,
      providerConfigDefaults: {},
      orderingHighlights: [],
      allowCustomerLocationSelection: false,
      isActive: true,
    };
  }

  ngOnInit(): void {
    this.plansFacade.loadServicePlans();
    this.typesFacade.loadServiceTypes();
    this.typesFacade.loadProviderDetails();
    this.plansFacade
      .getServicePlansCreating$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.createModal);
        this.resetCreateForm();
      });
    this.plansFacade
      .getServicePlansUpdating$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.editModal);
        this.resetEditForm();
      });
    this.plansFacade
      .getServicePlansDeleting$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.deleteConfirmModal);
        this.planToDelete = null;
      });
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.currentServerTypes = [];
    this.serverTypesLoading = false;
    this.showModal(this.createModal);
  }

  openEditModal(plan: ServicePlanResponse): void {
    this.editingPlan = plan;
    this.currentServerTypes = [];
    this.serverTypesLoading = false;
    this.editForm = {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? '',
      billingIntervalType: plan.billingIntervalType,
      billingIntervalValue: plan.billingIntervalValue,
      billingDayOfMonth: plan.billingDayOfMonth ?? undefined,
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
      minCommitmentDays: plan.minCommitmentDays,
      noticeDays: plan.noticeDays,
      basePrice: plan.basePrice ?? undefined,
      marginPercent: plan.marginPercent ?? undefined,
      marginFixed: plan.marginFixed ?? undefined,
      providerConfigDefaults:
        plan.providerConfigDefaults && Object.keys(plan.providerConfigDefaults).length > 0
          ? { ...plan.providerConfigDefaults }
          : {},
      orderingHighlights: plan.orderingHighlights?.length
        ? plan.orderingHighlights.map((h) => ({ icon: h.icon, text: h.text }))
        : [],
      allowCustomerLocationSelection: plan.allowCustomerLocationSelection === true,
      isActive: plan.isActive,
    };
    this.typesAndProviders$.pipe(take(1)).subscribe((data) => {
      const basePriceField = this.getBasePriceFromField(data.serviceTypes, data.providerDetails, plan.serviceTypeId);
      const providerId = this.getProviderId(data.serviceTypes, plan.serviceTypeId);

      if (basePriceField && providerId) this.loadServerTypes(providerId);
    });
    this.showModal(this.editModal);
  }

  openDeleteConfirm(plan: ServicePlanResponse): void {
    this.planToDelete = plan;
    this.showModal(this.deleteConfirmModal);
  }

  onSubmitCreate(): void {
    if (!this.createForm.serviceTypeId?.trim() || !this.createForm.name?.trim()) return;

    const providerConfigDefaults = this.coerceProviderConfigDefaults(this.createForm.providerConfigDefaults);
    const orderingHighlights = this.sanitizeOrderingHighlights(this.createForm.orderingHighlights);

    this.plansFacade.createServicePlan({
      serviceTypeId: this.createForm.serviceTypeId.trim(),
      name: this.createForm.name.trim(),
      description: this.createForm.description?.trim() || undefined,
      billingIntervalType: this.createForm.billingIntervalType,
      billingIntervalValue: Number(this.createForm.billingIntervalValue) || 1,
      billingDayOfMonth:
        this.createForm.billingDayOfMonth != null ? Number(this.createForm.billingDayOfMonth) : undefined,
      cancelAtPeriodEnd: this.createForm.cancelAtPeriodEnd ?? false,
      minCommitmentDays: Number(this.createForm.minCommitmentDays) || 0,
      noticeDays: Number(this.createForm.noticeDays) || 0,
      basePrice: this.createForm.basePrice?.trim() || undefined,
      marginPercent: this.createForm.marginPercent?.trim() || undefined,
      marginFixed: this.createForm.marginFixed?.trim() || undefined,
      providerConfigDefaults: Object.keys(providerConfigDefaults).length > 0 ? providerConfigDefaults : undefined,
      orderingHighlights: orderingHighlights.length > 0 ? orderingHighlights : undefined,
      allowCustomerLocationSelection: this.createForm.allowCustomerLocationSelection === true,
      isActive: this.createForm.isActive ?? true,
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id) return;

    const providerConfigDefaults = this.coerceProviderConfigDefaults(this.editForm.providerConfigDefaults);
    const orderingHighlights = this.sanitizeOrderingHighlights(this.editForm.orderingHighlights);

    this.plansFacade.updateServicePlan(this.editForm.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      billingIntervalType: this.editForm.billingIntervalType,
      billingIntervalValue: Number(this.editForm.billingIntervalValue) ?? 1,
      billingDayOfMonth: this.editForm.billingDayOfMonth != null ? Number(this.editForm.billingDayOfMonth) : undefined,
      cancelAtPeriodEnd: this.editForm.cancelAtPeriodEnd,
      minCommitmentDays: Number(this.editForm.minCommitmentDays) ?? 0,
      noticeDays: Number(this.editForm.noticeDays) ?? 0,
      basePrice: this.editForm.basePrice?.trim() || undefined,
      marginPercent: this.editForm.marginPercent?.trim() || undefined,
      marginFixed: this.editForm.marginFixed?.trim() || undefined,
      providerConfigDefaults: Object.keys(providerConfigDefaults).length > 0 ? providerConfigDefaults : undefined,
      orderingHighlights,
      allowCustomerLocationSelection: this.editForm.allowCustomerLocationSelection,
      isActive: this.editForm.isActive,
    });
  }

  confirmDelete(): void {
    if (this.planToDelete) {
      this.plansFacade.deleteServicePlan(this.planToDelete.id);
    }
  }

  /** Coerce providerConfigDefaults values to number where schema says number. */
  private coerceProviderConfigDefaults(defaults: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!defaults || typeof defaults !== 'object') return {};

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(defaults)) {
      if (value === undefined || value === null || value === '') continue;

      const num = Number(value);

      result[key] = Number.isNaN(num) ? value : num;
    }

    return result;
  }

  private resetCreateForm(): void {
    this.createForm = this.getDefaultCreateForm();
  }

  private resetEditForm(): void {
    this.editForm = this.getDefaultEditForm();
    this.editingPlan = null;
  }

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => { show: () => void } } };
        }
      ).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) modal.show();
    }
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getInstance: (el: HTMLElement) => { hide: () => void } | null } };
        }
      ).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) modal.hide();
    }
  }
}
