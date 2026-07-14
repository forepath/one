import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminWebhooksFacade,
  NOTIFICATION_ADMIN_CLIENT_PROVIDER,
  NOTIFICATION_ADMIN_ENVIRONMENT,
  WebhookAuthType,
  WebhookHttpMethod,
  type CreateWebhookEndpointDto,
  type NotificationAdminClientOption,
  type UpdateWebhookEndpointDto,
  type WebhookEndpointResponseDto,
} from '@forepath/shared/frontend/data-access-notifications';
import { combineLatestWith, map, of } from 'rxjs';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './webhook-manager.component.html',
  styleUrls: ['./webhook-manager.component.scss'],
  standalone: true,
})
export class WebhookManagerComponent implements OnInit {
  private readonly facade = inject(AdminWebhooksFacade);
  private readonly destroyRef = inject(DestroyRef);
  readonly environment = inject(NOTIFICATION_ADMIN_ENVIRONMENT);
  private readonly clientProvider = inject(NOTIFICATION_ADMIN_CLIENT_PROVIDER, { optional: true });

  @ViewChild('createWebhookModal', { static: false })
  private createWebhookModal!: ElementRef<HTMLDivElement>;

  @ViewChild('editWebhookModal', { static: false })
  private editWebhookModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteWebhookModal', { static: false })
  private deleteWebhookModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deliveriesModal', { static: false })
  private deliveriesModal!: ElementRef<HTMLDivElement>;

  readonly WebhookHttpMethod = WebhookHttpMethod;
  readonly WebhookAuthType = WebhookAuthType;
  readonly clientFilterEnabled = this.environment.clientFilterEnabled;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);

  readonly endpoints$ = this.facade.endpoints$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([endpoints, searchQuery]) => {
      if (!searchQuery.trim()) {
        return endpoints;
      }

      const normalized = searchQuery.trim().toLowerCase();

      return endpoints.filter((endpoint) => JSON.stringify(endpoint).toLowerCase().includes(normalized));
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
  readonly deliveries$ = this.facade.deliveries$;
  readonly deliveriesTotal$ = this.facade.deliveriesTotal$;
  readonly deliveriesLoading$ = this.facade.deliveriesLoading$;
  readonly deliveriesError$ = this.facade.deliveriesError$;
  readonly deliveriesHasMore$ = this.facade.deliveriesHasMore$;

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

  createForm = emptyForm();
  editForm = emptyForm();
  endpointToEdit: WebhookEndpointResponseDto | null = null;
  endpointToDelete: WebhookEndpointResponseDto | null = null;
  deliveriesEndpoint: WebhookEndpointResponseDto | null = null;

  ngOnInit(): void {
    this.facade.load();
    this.facade.loadEventTypes();

    watchNotificationMutationModalClose({
      loading$: this.saving$,
      error$: this.endpointsError$,
      modal: () => this.editWebhookModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.endpointToEdit = null;
      },
    });
  }

  onAddWebhook(): void {
    this.createForm = emptyForm();
    this.facade.clearCreatedSigningSecret();
    showNotificationModal(this.createWebhookModal);
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
    hideNotificationModal(this.createWebhookModal);
    this.createForm = emptyForm();
  }

  cancelEditWebhook(): void {
    hideNotificationModal(this.editWebhookModal);
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
    showNotificationModal(this.editWebhookModal);
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
    showNotificationModal(this.deleteWebhookModal);
  }

  confirmDeleteWebhook(): void {
    if (!this.endpointToDelete) {
      return;
    }

    this.facade.delete(this.endpointToDelete.id);
    hideNotificationModal(this.deleteWebhookModal);
    this.endpointToDelete = null;
  }

  cancelDeleteWebhook(): void {
    hideNotificationModal(this.deleteWebhookModal);
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
    this.facade.loadDeliveries(endpoint.id);
    showNotificationModal(this.deliveriesModal);
  }

  onCloseDeliveries(): void {
    hideNotificationModal(this.deliveriesModal);
    this.deliveriesEndpoint = null;
    this.facade.clearDeliveries();
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

    return this.clients().find((client) => client.id === clientId)?.label ?? clientId;
  }

  formatDate(iso: string | undefined): string {
    if (!iso) {
      return '-';
    }

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  formatDeliveryPayload(payload: Record<string, unknown> | null | undefined): string {
    return this.formatDeliveryBody(payload);
  }

  formatDeliveryResponse(responseBody: string | null | undefined): string {
    return this.formatDeliveryBody(responseBody);
  }

  private formatDeliveryBody(value: Record<string, unknown> | string | null | undefined): string {
    if (value == null) {
      return '—';
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return '—';
      }

      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }

    if (Object.keys(value).length === 0) {
      return '—';
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

  enabledStatusTextClass(endpoint: WebhookEndpointResponseDto): string {
    return endpoint.enabled ? 'text-success' : 'text-secondary';
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
