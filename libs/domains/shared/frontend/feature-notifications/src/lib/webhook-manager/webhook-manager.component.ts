import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminWebhooksFacade,
  NOTIFICATION_ADMIN_CLIENT_PROVIDER,
  NOTIFICATION_ADMIN_ENVIRONMENT,
  WebhookAuthType,
  WebhookEndpointsService,
  WebhookHttpMethod,
  type CreateWebhookEndpointDto,
  type WebhookDeliveryResponseDto,
  type NotificationAdminClientOption,
  type UpdateWebhookEndpointDto,
  type WebhookEndpointResponseDto,
} from '@forepath/shared/frontend/data-access-notifications';
import {
  FpcDatePipe,
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcLabelComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  FPC_DEFAULT_PAGE_SIZE,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { catchError, combineLatestWith, firstValueFrom, map, of, switchMap } from 'rxjs';

import { SHARED_DL_DELETE, sharedBulkSummary, sharedCopyIdItem } from '../data-list';

import {
  hideNotificationModal,
  showNotificationModal,
  watchNotificationMutationModalClose,
} from '../notification-modal';

type WebhookFormState = {
  name: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  subscribedEvents: string[];
  enabled: boolean;
  authType: WebhookAuthType;
  authHeaderName: string;
  authValue: string;
  clientId: string;
};

const emptyForm = (): WebhookFormState => ({
  name: '',
  url: '',
  httpMethod: WebhookHttpMethod.POST,
  subscribedEvents: [],
  enabled: true,
  authType: WebhookAuthType.NONE,
  authHeaderName: '',
  authValue: '',
  clientId: '',
});

@Component({
  selector: 'shared-webhook-manager',
  imports: [
    CommonModule,
    FpcDatePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcLabelComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
  ],
  templateUrl: './webhook-manager.component.html',
  styleUrls: ['./webhook-manager.component.scss'],
  standalone: true,
})
export class WebhookManagerComponent implements OnInit {
  private readonly facade = inject(AdminWebhooksFacade);
  private readonly endpointsService = inject(WebhookEndpointsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly environment = inject(NOTIFICATION_ADMIN_ENVIRONMENT);
  private readonly clientProvider = inject(NOTIFICATION_ADMIN_CLIENT_PROVIDER, { optional: true });

  readonly createWebhookModalOpen = signal(false);
  readonly editWebhookModalOpen = signal(false);
  readonly deleteWebhookModalOpen = signal(false);
  readonly deliveriesModalOpen = signal(false);

  readonly WebhookHttpMethod = WebhookHttpMethod;
  readonly WebhookAuthType = WebhookAuthType;
  readonly clientFilterEnabled = this.environment.clientFilterEnabled;

  /** Modal footer Cancel (3.38 R14: [Cancel `dark`, Primary]); the shared identity unit exists in every console. */

  readonly cancelLabel = $localize`:@@identityLogoutConfirm-cancel:Cancel`;

  readonly pageTitle = $localize`:@@featureNotifications-title:Webhooks`;
  readonly addWebhookTitle = $localize`:@@featureNotifications-addWebhookTitle:Add webhook`;
  readonly searchPlaceholder = $localize`:@@featureNotifications-searchPlaceholder:Search webhooks`;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);

  readonly endpoints$ = this.facade.endpoints$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([endpoints, searchQuery]) => {
      if (!searchQuery.trim()) {
        return endpoints;
      }

      const normalized = searchQuery.trim().toLowerCase();

      return endpoints.filter((endpoint) =>
        `${endpoint.name} ${endpoint.url} ${endpoint.subscribedEvents.join(' ')}`.toLowerCase().includes(normalized),
      );
    }),
  );

  readonly endpointsLoading$ = this.facade.loading$;
  readonly endpointsError$ = this.facade.error$;
  readonly saving$ = this.facade.saving$;
  readonly deleting$ = this.facade.deleting$;
  readonly testing$ = this.facade.testing$;
  readonly eventTypes$ = this.facade.eventTypes$;
  readonly eventTypesLoading$ = this.facade.eventTypesLoading$;
  readonly lastCreatedSigningSecret$ = this.facade.lastCreatedSigningSecret$;
  readonly lastTestDelivery$ = this.facade.lastTestDelivery$;
  readonly endpoints = toSignal(this.endpoints$, { initialValue: [] as WebhookEndpointResponseDto[] });
  readonly endpointsError = toSignal(this.endpointsError$, { initialValue: null as string | null });
  readonly lastCreatedSigningSecret = toSignal(this.lastCreatedSigningSecret$, { initialValue: null as string | null });
  readonly lastTestDelivery = toSignal(this.lastTestDelivery$, { initialValue: null });
  readonly eventTypes = toSignal(this.eventTypes$, { initialValue: [] });
  readonly clients = toSignal(
    this.clientProvider ? this.clientProvider.getClients() : of([] as NotificationAdminClientOption[]),
    {
      initialValue: [] as NotificationAdminClientOption[],
    },
  );

  // Endpoints table (3.38: State column, ⋮ row actions, bulk Test / Enable / Disable / Delete via single calls)
  readonly testLabel = $localize`:@@featureNotifications-testWebhookTitle:Send test delivery`;
  readonly enableLabel = $localize`:@@featureNotifications-enable:Enable`;
  readonly disableLabel = $localize`:@@featureNotifications-disable:Disable`;
  readonly deleteLabel = SHARED_DL_DELETE;
  readonly deliveriesTitle = $localize`:@@featureNotifications-deliveriesTitle:Recent deliveries`;
  private readonly viewDeliveriesLabel = $localize`:@@featureNotifications-viewDeliveriesTitle:View deliveries`;
  private readonly editLabel = $localize`:@@featureNotifications-editWebhookTitle:Edit webhook`;
  private readonly testFailedLabel = $localize`:@@featureNotifications-testFailed:Test delivery failed.`;

  readonly selectedEndpointIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkDeleteOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);

  readonly selectedEndpoints = computed(() => {
    const ids = new Set(this.selectedEndpointIds());

    return this.endpoints().filter((endpoint) => ids.has(endpoint.id));
  });
  readonly selectedEnabledEndpoints = computed(() => this.selectedEndpoints().filter((endpoint) => endpoint.enabled));

  readonly columns: FpcTableColumn<WebhookEndpointResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureNotifications-colState:State`,
      type: 'state',
      state: (endpoint) =>
        !endpoint.enabled
          ? { label: this.statusLabel(endpoint), tone: 'neutral', icon: 'pause-circle' }
          : endpoint.consecutiveFailures > 0
            ? {
                label: $localize`:@@featureNotifications-stateFailing:Failing (${endpoint.consecutiveFailures}:count: failures)`,
                tone: 'warning',
                icon: 'exclamation-triangle',
              }
            : { label: this.statusLabel(endpoint), tone: 'success', icon: 'check-circle' },
    },
    {
      id: 'name',
      label: $localize`:@@featureNotifications-nameLabel:Name`,
      value: (endpoint) => endpoint.name,
      required: true,
      priority: 1,
    },
    {
      id: 'url',
      label: $localize`:@@featureNotifications-urlLabel:URL`,
      value: (endpoint) => endpoint.url,
      priority: 1,
    },
    {
      id: 'method',
      label: $localize`:@@featureNotifications-colMethod:Method`,
      value: (endpoint) => endpoint.httpMethod,
      priority: 3,
      width: '6rem',
    },
    ...(this.clientFilterEnabled
      ? [
          {
            id: 'workspace',
            label: $localize`:@@featureNotifications-colClient:Client`,
            value: (endpoint: WebhookEndpointResponseDto) => this.clientLabel(endpoint.clientId),
            priority: 2,
          } satisfies FpcTableColumn<WebhookEndpointResponseDto>,
        ]
      : []),
    {
      id: 'events',
      label: $localize`:@@featureNotifications-colEvents:Events`,
      value: (endpoint) => endpoint.subscribedEvents.length,
      align: 'end',
      priority: 2,
    },
    {
      id: 'updated',
      label: $localize`:@@featureNotifications-colUpdated:Updated`,
      value: (endpoint) => endpoint.updatedAt,
      priority: 3,
    },
  ];

  readonly endpointRowMenu = (endpoint: WebhookEndpointResponseDto): FpcMenuItem[] => [
    { id: 'deliveries', label: this.viewDeliveriesLabel, icon: 'list-ul' },
    { id: 'test', label: this.testLabel, icon: 'lightning', disabled: !endpoint.enabled },
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    endpoint.enabled
      ? { id: 'disable', label: this.disableLabel, icon: 'pause-circle' }
      : { id: 'enable', label: this.enableLabel, icon: 'play-circle' },
    sharedCopyIdItem(),
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
  ];

  // Deliveries modal: nested table, server paging with total (limit / offset over the single-endpoint API)
  private readonly deliveriesEndpointId = signal<string | null>(null);
  readonly deliveriesPage = signal(1);
  readonly deliveriesPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly deliveries = signal<WebhookDeliveryResponseDto[]>([]);
  readonly deliveriesTotal = signal(0);
  readonly deliveriesLoading = signal(false);
  readonly deliveriesError = signal<string | null>(null);
  readonly expandedDeliveryId = signal<string | null>(null);

  readonly deliveryColumns: FpcTableColumn<WebhookDeliveryResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureNotifications-deliveryStatus:Status`,
      type: 'state',
      state: (delivery) => {
        const status = delivery.httpStatus ? ` (HTTP ${delivery.httpStatus})` : '';

        return delivery.success
          ? {
              label: $localize`:@@featureNotifications-deliverySuccess:Success` + status,
              tone: 'success',
              icon: 'check-circle',
            }
          : {
              label: $localize`:@@featureNotifications-deliveryFailed:Failed` + status,
              tone: 'danger',
              icon: 'x-circle',
            };
      },
    },
    {
      id: 'name',
      label: $localize`:@@featureNotifications-deliveryTime:Time`,
      required: true,
      priority: 1,
    },
    {
      id: 'event',
      label: $localize`:@@featureNotifications-deliveryEvent:Event`,
      priority: 1,
    },
    {
      id: 'http',
      label: $localize`:@@featureNotifications-colHttpStatus:HTTP status`,
      value: (delivery) => delivery.httpStatus ?? null,
      align: 'end',
      priority: 2,
      sortable: false,
    },
    {
      id: 'attempt',
      label: $localize`:@@featureNotifications-deliveryAttempt:Attempt`,
      value: (delivery) => delivery.attempt,
      align: 'end',
      priority: 3,
      sortable: false,
    },
  ];

  private readonly deliveriesRequest = computed(() => ({
    id: this.deliveriesEndpointId(),
    page: this.deliveriesPage(),
    pageSize: this.deliveriesPageSize(),
  }));
  private readonly deliveriesRequest$ = toObservable(this.deliveriesRequest);

  createForm = emptyForm();
  editForm = emptyForm();
  endpointToEdit: WebhookEndpointResponseDto | null = null;
  endpointToDelete: WebhookEndpointResponseDto | null = null;
  deliveriesEndpoint: WebhookEndpointResponseDto | null = null;

  ngOnInit(): void {
    this.facade.load();
    this.facade.loadEventTypes();

    // One deliveries page per request (endpoint, page, page size); a newer request cancels the older one.
    this.deliveriesRequest$
      .pipe(
        switchMap(({ id, page, pageSize }) => {
          if (!id) {
            return of(null);
          }

          this.deliveriesLoading.set(true);
          this.deliveriesError.set(null);

          return this.endpointsService.listDeliveries(id, { limit: pageSize, offset: (page - 1) * pageSize }).pipe(
            catchError((error: unknown) => {
              this.deliveriesError.set(
                (error as { error?: { message?: string }; message?: string })?.error?.message ??
                  (error as { message?: string })?.message ??
                  $localize`:@@featureNotifications-deliveryError:Error`,
              );

              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.deliveriesLoading.set(false);

        if (response) {
          this.deliveries.set(response.items);
          this.deliveriesTotal.set(response.total);
        }
      });

    watchNotificationMutationModalClose({
      loading$: this.saving$,
      error$: this.endpointsError$,
      open: this.editWebhookModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.endpointToEdit = null;
      },
    });
  }

  onAddWebhook(): void {
    this.createForm = emptyForm();
    this.facade.clearCreatedSigningSecret();
    showNotificationModal(this.createWebhookModalOpen);
  }

  onSubmitCreateWebhook(): void {
    const dto = this.buildCreateDto(this.createForm);

    if (!dto) {
      return;
    }

    this.facade.create(dto);
  }

  onCreateDone(): void {
    this.facade.clearCreatedSigningSecret();
    hideNotificationModal(this.createWebhookModalOpen);
    this.createForm = emptyForm();
  }

  cancelEditWebhook(): void {
    hideNotificationModal(this.editWebhookModalOpen);
    this.endpointToEdit = null;
  }

  onEditWebhook(endpoint: WebhookEndpointResponseDto): void {
    this.endpointToEdit = endpoint;
    this.editForm = {
      name: endpoint.name,
      url: endpoint.url,
      httpMethod: endpoint.httpMethod,
      subscribedEvents: [...endpoint.subscribedEvents],
      enabled: endpoint.enabled,
      authType: endpoint.authType,
      authHeaderName: endpoint.authHeaderName ?? '',
      authValue: '',
      clientId: endpoint.clientId ?? '',
    };
    showNotificationModal(this.editWebhookModalOpen);
  }

  onSubmitEditWebhook(): void {
    if (!this.endpointToEdit) {
      return;
    }

    const dto = this.buildUpdateDto(this.editForm, this.endpointToEdit);

    if (!dto) {
      return;
    }

    this.facade.update(this.endpointToEdit.id, dto);
  }

  onDeleteWebhook(endpoint: WebhookEndpointResponseDto): void {
    this.endpointToDelete = endpoint;
    showNotificationModal(this.deleteWebhookModalOpen);
  }

  confirmDeleteWebhook(): void {
    if (!this.endpointToDelete) {
      return;
    }

    this.facade.delete(this.endpointToDelete.id);
    hideNotificationModal(this.deleteWebhookModalOpen);
    this.endpointToDelete = null;
  }

  cancelDeleteWebhook(): void {
    hideNotificationModal(this.deleteWebhookModalOpen);
    this.endpointToDelete = null;
  }

  onTestWebhook(endpoint: WebhookEndpointResponseDto): void {
    this.facade.clearTestResult();
    this.facade.test(endpoint.id);
  }

  dismissTestResult(): void {
    this.facade.clearTestResult();
  }

  onViewDeliveries(endpoint: WebhookEndpointResponseDto): void {
    this.deliveriesEndpoint = endpoint;
    this.deliveries.set([]);
    this.deliveriesTotal.set(0);
    this.expandedDeliveryId.set(null);
    this.deliveriesPage.set(1);
    this.deliveriesEndpointId.set(endpoint.id);
    showNotificationModal(this.deliveriesModalOpen);
  }

  onCloseDeliveries(): void {
    hideNotificationModal(this.deliveriesModalOpen);
    this.deliveriesEndpoint = null;
    this.deliveriesEndpointId.set(null);
    this.deliveries.set([]);
  }

  toggleDelivery(id: string): void {
    this.expandedDeliveryId.update((current) => (current === id ? null : id));
  }

  eventTypeDescription(delivery: WebhookDeliveryResponseDto): string {
    return this.eventTypes().find((eventType) => eventType.type === delivery.eventType)?.description ?? '';
  }

  onEndpointAction(endpoint: WebhookEndpointResponseDto, action: string): void {
    switch (action) {
      case 'deliveries':
        this.onViewDeliveries(endpoint);
        break;
      case 'test':
        this.onTestWebhook(endpoint);
        break;
      case 'edit':
        this.onEditWebhook(endpoint);
        break;
      case 'enable':
      case 'disable':
        void this.runBulk([endpoint], (item) =>
          firstValueFrom(this.endpointsService.update(item.id, { enabled: action === 'enable' })),
        );
        break;
      case 'copy-id':
        fpcCopyText(endpoint.id);
        break;
      case 'delete':
        this.onDeleteWebhook(endpoint);
        break;
    }
  }

  /** Bulk Send test: one test delivery per enabled webhook; an unsuccessful delivery counts as failed. */
  onBulkTest(): void {
    void this.runBulk(this.selectedEnabledEndpoints(), async (endpoint) => {
      const delivery = await firstValueFrom(this.endpointsService.test(endpoint.id));

      if (!delivery.success) {
        throw new Error(
          delivery.errorMessage || (delivery.httpStatus ? `HTTP ${delivery.httpStatus}` : this.testFailedLabel),
        );
      }
    });
  }

  onBulkSetEnabled(enabled: boolean): void {
    void this.runBulk(
      this.selectedEndpoints().filter((endpoint) => endpoint.enabled !== enabled),
      (endpoint) => firstValueFrom(this.endpointsService.update(endpoint.id, { enabled })),
    );
  }

  onConfirmBulkDelete(): void {
    this.bulkDeleteOpen.set(false);
    void this.runBulk(this.selectedEndpoints(), (endpoint) =>
      firstValueFrom(this.endpointsService.delete(endpoint.id)),
    );
  }

  /** Client fan-out over the single-webhook endpoints (3.38 D8), per-webhook result; failed / denied stay selected. */
  private async runBulk(
    endpoints: readonly WebhookEndpointResponseDto[],
    run: (endpoint: WebhookEndpointResponseDto) => Promise<unknown>,
  ): Promise<void> {
    if (endpoints.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(endpoints, run);

      this.bulkResult.set(sharedBulkSummary(result, (endpoint) => endpoint.name));
      this.selectedEndpointIds.set(result.failed.concat(result.denied).map((endpoint) => endpoint.id));
      this.facade.load();
    } finally {
      this.bulkBusy.set(false);
    }
  }

  toggleSubscribedEvent(form: WebhookFormState, eventType: string, checked: boolean): void {
    if (checked) {
      form.subscribedEvents = [...new Set([...form.subscribedEvents, eventType])];
      return;
    }

    form.subscribedEvents = form.subscribedEvents.filter((item) => item !== eventType);
  }

  isEventSelected(form: WebhookFormState, eventType: string): boolean {
    return form.subscribedEvents.includes(eventType);
  }

  authValueRequired(authType: WebhookAuthType): boolean {
    return [WebhookAuthType.AUTHORIZATION, WebhookAuthType.CUSTOM_HEADER, WebhookAuthType.QUERY_PARAM].includes(
      authType,
    );
  }

  authHeaderRequired(authType: WebhookAuthType): boolean {
    return authType === WebhookAuthType.CUSTOM_HEADER;
  }

  clientLabel(clientId: string | null | undefined): string {
    if (!clientId) {
      return $localize`:@@featureNotifications-allClients:All clients`;
    }

    const label = this.clients()
      .find((client) => client.id === clientId)
      ?.label?.trim();

    return label || $localize`:@@featureNotifications-clientUnavailable:N/A`;
  }

  formatDeliveryPayload(payload: Record<string, unknown> | null | undefined): string {
    return this.formatDeliveryBody(payload);
  }

  formatDeliveryResponse(responseBody: string | null | undefined): string {
    return this.formatDeliveryBody(responseBody);
  }

  private formatDeliveryBody(value: Record<string, unknown> | string | null | undefined): string {
    if (value == null) {
      return '-';
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return '-';
      }

      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }

    if (Object.keys(value).length === 0) {
      return '-';
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  statusLabel(endpoint: WebhookEndpointResponseDto): string {
    if (!endpoint.enabled) {
      if (endpoint.disabledReason) {
        return `${$localize`:@@featureNotifications-disabled:Disabled`}: ${endpoint.disabledReason}`;
      }

      return $localize`:@@featureNotifications-disabled:Disabled`;
    }

    return $localize`:@@featureNotifications-enabled:Enabled`;
  }

  isCreateFormValid(): boolean {
    return this.isFormValid(this.createForm, false);
  }

  isEditFormValid(): boolean {
    return this.isFormValid(this.editForm, this.endpointToEdit?.hasAuthValue ?? false);
  }

  private isFormValid(form: WebhookFormState, hasExistingAuthValue: boolean): boolean {
    if (!form.name.trim() || !form.url.trim() || form.subscribedEvents.length === 0) {
      return false;
    }

    if (this.authHeaderRequired(form.authType) && !form.authHeaderName.trim()) {
      return false;
    }

    if (this.authValueRequired(form.authType) && !hasExistingAuthValue && !form.authValue.trim()) {
      return false;
    }

    return true;
  }

  private buildCreateDto(form: WebhookFormState): CreateWebhookEndpointDto | null {
    if (!this.isFormValid(form, false)) {
      return null;
    }

    const dto: CreateWebhookEndpointDto = {
      name: form.name.trim(),
      url: form.url.trim(),
      httpMethod: form.httpMethod,
      subscribedEvents: [...form.subscribedEvents],
      enabled: form.enabled,
      authType: form.authType,
    };

    if (this.authHeaderRequired(form.authType)) {
      dto.authHeaderName = form.authHeaderName.trim();
    }

    if (this.authValueRequired(form.authType)) {
      dto.authValue = form.authValue.trim();
    }

    if (this.clientFilterEnabled && form.clientId.trim()) {
      dto.clientId = form.clientId.trim();
    }

    return dto;
  }

  private buildUpdateDto(
    form: WebhookFormState,
    endpoint: WebhookEndpointResponseDto,
  ): UpdateWebhookEndpointDto | null {
    if (!this.isFormValid(form, endpoint.hasAuthValue)) {
      return null;
    }

    const dto: UpdateWebhookEndpointDto = {
      name: form.name.trim(),
      url: form.url.trim(),
      httpMethod: form.httpMethod,
      subscribedEvents: [...form.subscribedEvents],
      enabled: form.enabled,
      authType: form.authType,
    };

    if (this.authHeaderRequired(form.authType)) {
      dto.authHeaderName = form.authHeaderName.trim();
    }

    if (this.authValueRequired(form.authType) && form.authValue.trim()) {
      dto.authValue = form.authValue.trim();
    }

    if (this.clientFilterEnabled) {
      dto.clientId = form.clientId.trim() ? form.clientId.trim() : null;
    }

    return dto;
  }
}
