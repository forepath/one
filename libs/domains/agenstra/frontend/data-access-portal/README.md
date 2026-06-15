# agenstra-frontend-data-access-portal

NgRx data access for the public marketing portal. Uses the billing API base URL from `@forepath/shared/frontend/util-configuration` (`environment.billing.restApiUrl`).

## Service plans feature

The `servicePlans` store feature loads public service plan offerings:

- `GET /public/service-plan-offerings` — paginated list (effects batch requests using `SERVICE_PLANS_BATCH_SIZE`).
- `GET /public/service-plan-offerings/cheapest` — lowest priced active offering.

Register in the portal route (see `feature-portal` `portal.routes.ts`):

- `provideState('servicePlans', servicePlansReducer)`
- `provideEffects({ loadServicePlans$, loadServicePlansBatch$, loadCheapestServicePlanOffering$ })`
- `ServicePlansFacade`

If another application shell ever registers both billing-console and portal reducers, use a distinct feature key for one of them to avoid collisions.

## Running unit tests

```bash
nx test agenstra-frontend-data-access-portal
```

## Running lint

```bash
nx lint agenstra-frontend-data-access-portal
```
