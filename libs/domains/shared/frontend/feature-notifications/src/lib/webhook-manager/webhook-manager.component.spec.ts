import '@angular/localize/init';

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AdminWebhooksFacade,
  NOTIFICATION_ADMIN_ENVIRONMENT,
  WebhookAuthType,
  WebhookEndpointsService,
  WebhookHttpMethod,
  type WebhookEndpointResponseDto,
} from '@forepath/shared/frontend/data-access-notifications';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { WebhookManagerComponent } from './webhook-manager.component';

function endpoint(id: string, name: string, overrides: Partial<WebhookEndpointResponseDto> = {}) {
  return {
    id,
    scopeKey: 'app',
    name,
    url: `https://hooks.example.com/${name}`,
    httpMethod: WebhookHttpMethod.POST,
    subscribedEvents: ['ticket.created'],
    enabled: true,
    authType: WebhookAuthType.NONE,
    hasAuthValue: false,
    consecutiveFailures: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  } as WebhookEndpointResponseDto;
}

describe('WebhookManagerComponent', () => {
  let fixture: ComponentFixture<WebhookManagerComponent>;
  let facade: Record<string, unknown>;
  let service: { delete: jest.Mock; update: jest.Mock; test: jest.Mock; listDeliveries: jest.Mock };

  beforeEach(async () => {
    facade = {
      endpoints$: new BehaviorSubject([
        endpoint('w-1', 'ops'),
        endpoint('w-2', 'billing', { consecutiveFailures: 3 }),
        endpoint('w-3', 'paused', { enabled: false }),
      ]),
      loading$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      saving$: new BehaviorSubject(false),
      deleting$: new BehaviorSubject(false),
      testing$: new BehaviorSubject(false),
      eventTypes$: new BehaviorSubject([]),
      eventTypesLoading$: new BehaviorSubject(false),
      lastCreatedSigningSecret$: new BehaviorSubject(null),
      lastTestDelivery$: new BehaviorSubject(null),
      load: jest.fn(),
      loadEventTypes: jest.fn(),
    };
    service = {
      delete: jest.fn((id: string) =>
        id === 'w-2' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(undefined),
      ),
      update: jest.fn(() => of({})),
      test: jest.fn(() => of({ success: true })),
      listDeliveries: jest.fn(() => of({ items: [], total: 0 })),
    };

    await TestBed.configureTestingModule({
      imports: [WebhookManagerComponent],
      providers: [
        { provide: AdminWebhooksFacade, useValue: facade },
        { provide: WebhookEndpointsService, useValue: service },
        {
          provide: NOTIFICATION_ADMIN_ENVIRONMENT,
          useValue: { apiUrl: 'https://api.example.com', webhooksBasePath: 'admin/webhooks', applicationId: 'app' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WebhookManagerComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('renders the webhooks as a table with readable states', () => {
    const component = fixture.componentInstance;
    const state = component.columns[0].state;

    expect(el().querySelector('[data-testid="webhook-manager-table"]')?.textContent).toContain('billing');
    expect(state?.(endpoint('x', 'x', { consecutiveFailures: 3 }))?.tone).toBe('warning');
    expect(state?.(endpoint('x', 'x', { enabled: false }))?.label).toBe('Disabled');
  });

  it('deletes the selected webhooks one by one and reports per-webhook results (incl. denied)', async () => {
    const component = fixture.componentInstance;

    component.selectedEndpointIds.set(['w-1', 'w-2']);
    component.onConfirmBulkDelete();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.delete).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedEndpointIds()).toEqual(['w-2']);
  });

  it('loads deliveries page by page through the single-endpoint API', () => {
    const component = fixture.componentInstance;

    component.onViewDeliveries(endpoint('w-1', 'ops'));
    fixture.detectChanges();

    expect(service.listDeliveries).toHaveBeenLastCalledWith('w-1', { limit: 25, offset: 0 });

    component.deliveriesPage.set(2);
    fixture.detectChanges();

    expect(service.listDeliveries).toHaveBeenLastCalledWith('w-1', { limit: 25, offset: 25 });
  });
});
