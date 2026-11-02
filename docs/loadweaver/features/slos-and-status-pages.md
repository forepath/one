# SLOs and status pages

Services exposed through the [ingress](./ingress.md) can declare service level objectives. Loadweaver measures them at the ingress, tracks the error budget and how fast it burns, alerts on fast burn and feeds the monthly uptime into public status pages and [reports](./periodic-reports.md).

## Declaring an SLO

An SLO is part of the service's `x-loadweaver` in the compose file. The service must be exposed over HTTP; a plan with an SLO on a service without `exposure.http` is rejected.

```yaml
services:
  api:
    image: ghcr.io/acme/api@sha256:…
    x-loadweaver:
      replicas: 3
      exposure:
        http:
          - { host: api.example.com, port: 8080 }
      slo:
        availability: 99.9 # % of requests without a server error
        latency:
          percentile: p95 # p95 (default) or p99
          thresholdMs: 300
          target: 99 # % of minutes under the threshold; default 99
        window: 30d # 7d, 28d or 30d (default)
```

| Field                 | Values                                         |
| --------------------- | ---------------------------------------------- |
| `availability`        | 50–99.999 (percent)                            |
| `latency.percentile`  | `p95` (default) or `p99`                       |
| `latency.thresholdMs` | 1–600,000                                      |
| `latency.target`      | 50–99.999, default 99                          |
| `window`              | `7d`, `28d`, `30d` (default); a rolling window |

At least one of `availability` and `latency` is required. The SLO covers every hostname the service exposes.

## How it is measured

Both objectives come from the ingress [metrics](./metrics.md) of the service's hostnames (summed over all ingress nodes):

- **Availability**: good events are requests without a `5xx` answer. Every 10-second sample of `ingress.requests_per_s` and `ingress.errors_per_s` is a rate over its interval, so the number of requests is the sum of all samples' rates × 10 seconds — independent of how much of a roll-up bucket had traffic. The window and the monthly uptime are read from the hourly roll-ups, the last hour (burn rate) from the raw samples.
- **Latency**: good events are minutes whose `ingress.latency_p95_ms` (or `p99`) stayed at or under the threshold on the worst ingress node; only minutes with traffic count. Read from the 1-minute roll-ups.

From the good and total events of the window and of the last hour:

| Value           | Meaning                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `sli`           | good / total over the window, in percent; `null` without traffic                                |
| `budget`        | 100 − target, in percent of events                                                              |
| `consumed`      | share of the budget used in the window: (100 − SLI) / budget; 1 = used up                       |
| `burnRate1h`    | error rate of the last hour relative to the budget; 1 = burning exactly at the sustainable rate |
| `monthlyUptime` | availability since the start of the calendar month (UTC), in percent                            |

The state of an objective is `exhausted` when the budget is used up, `burning` when the last hour burns at 14.4 or more (2 % of a 30-day budget in one hour), `ok` otherwise, and `no-data` without traffic. A service's state is its worst objective's (`exhausted` > `burning` > `ok` > `no-data`).

SLOs are computed for the whole cluster at most once a minute and filtered per caller.

- Because the hourly roll-ups appear once an hour is complete, the window's SLI trails now by up to about an hour and a half; the burn rate reads the raw samples and doesn't.
- A wildcard host (`*.example.com`) covers every hostname under it.

### Alert

The built-in alert `builtin:slo-burn` (one per service, belonging to its project) fires **critical** when an SLO has been burning for 5 minutes and **warning** when its budget is used up ([Alerting](./alerting.md#built-in-alerts)). The overview counts SLOs that are ok, burning and exhausted.

### API

`GET /api/slos` (optionally `?project=shop`) lists the SLOs the caller may read (project readers), scope `metrics:read`:

```json
{
  "project": "shop",
  "deployment": "web",
  "service": "api",
  "hosts": ["api.example.com"],
  "window": "30d",
  "availability": { "target": 99.9, "sli": 99.97, "budget": 0.1, "consumed": 0.3, "burnRate1h": 0.2, "state": "ok" },
  "latency": { "target": 99, "sli": 99.6, "budget": 1, "consumed": 0.4, "burnRate1h": 0, "state": "ok", "percentile": "p95", "thresholdMs": 300 },
  "monthlyUptime": 99.98,
  "state": "ok"
}
```

## Status pages

A `StatusPage` is a project resource: the project's team plans it like any other resource, and the cluster hosts it on its own hostname.

```yaml
apiVersion: loadweaver.com/v1
kind: StatusPage
metadata: { name: public, project: shop }
spec:
  host: status.example.com # no wildcards
  title: Example Shop status
  description: Live state of the shop and its API # optional, up to 1,024 characters
  services: # 1–50, as deployment/service with a display name
    - { service: web/frontend, name: Shop }
    - { service: web/api, name: API }
  showUptime: true # monthly uptime of services with an availability SLO; default true
```

### How it is served

- The page's hostname becomes an ingress site like an exposed service: it gets DNS records, an ACME certificate, and the one-owner-per-hostname check (a hostname used by a service or another status page fails the plan). Changes to a `StatusPage` run the same workload preview as deployments, so a clash shows up in the plan.
- The site has one route: `/` is rewritten to `/api/public/status/` (Envoy `prefix_rewrite`; the ingress normalizes paths first) and sent to the control-plane API on the members (`lw/_platform/status`, the API's HTTP port, 3400 by default).
- While at least one status page exists, the built-in policy `status-pages` allows the ingress nodes to reach the control-plane members on the API port. Without status pages, the rule doesn't exist.
- The API finds the page by the request's `Host` header (port stripped, case-insensitive); an unknown host answers `404`.

| Path (on the page's hostname) | Answer                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`                           | HTML page, refreshes every 60 s; CSP `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'` |
| `/status.json`                | the same as JSON                                                                                             |

Both need no login, are cached for 30 seconds in the API and sent with `Cache-Control: public, max-age=30`.

### What the public sees

Only the listed services, under their display names, with a public state taken from the [health tree](./overview-and-health.md):

| Health               | Public        |
| -------------------- | ------------- |
| `healthy`, `at-risk` | `operational` |
| `degraded`           | `degraded`    |
| `failed`             | `outage`      |
| `unknown`, not found | `unknown`     |

The overall status is the worst service's. With `showUptime`, services with an availability SLO show their uptime this month. Incidents of the project are listed while open and for 14 days after they were resolved (at most 20).

Nothing else: no reasons, node, site, replica or host names, no authors of incident notes.

```json
{
  "title": "Example Shop status",
  "description": "Live state of the shop and its API",
  "status": "degraded",
  "services": [
    { "name": "Shop", "status": "operational", "uptime": 99.98 },
    { "name": "API", "status": "degraded", "uptime": 99.71 }
  ],
  "incidents": [
    {
      "title": "Slow checkout",
      "status": "monitoring",
      "updates": [
        { "at": "2026-10-18T08:20:00.000Z", "status": "investigating", "message": "Checkout is slow for some customers." },
        { "at": "2026-10-18T08:45:00.000Z", "status": "monitoring", "message": "A fix is deployed; we are watching." }
      ],
      "resolvedAt": null
    }
  ],
  "updatedAt": "2026-10-18T08:50:12.000Z"
}
```

### Incidents

Incident notes belong to a project and appear on all its status pages. Operators and admins of the project write them; everyone who may read the project reads them. Each update appends a status and a note (at most 100 updates per incident); resolving sets the resolution time, a later non-resolved status reopens it. Creating and updating incidents is audited.

```bash
curl https://<control-plane>/api/projects/shop/incidents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title": "Slow checkout", "status": "investigating", "message": "Checkout is slow for some customers."}'
```

| Request                                      | Meaning                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/projects/{project}/incidents`      | newest first, at most 200; scope `projects:read`                                  |
| `POST /api/projects/{project}/incidents`     | `title` (≤ 255), `status`, `message` (≤ 4,000); operators; scope `projects:admin` |
| `PUT /api/projects/{project}/incidents/{id}` | `status`, `message`: appends an update; operators; scope `projects:admin`         |

Statuses: `investigating`, `identified`, `monitoring`, `resolved`.

## Not there yet

- SLOs are measured at the ingress only; probes from outside (3.28) don't feed them yet.
- Status pages have no subscriptions (email / RSS), custom styling or history beyond the 14 days.
