# Search and wallboard

One search box finds anything in the cluster — a project, a policy, the service behind `app.example.com`, a node, a plan, an alert — and doubles as a command palette. A wallboard shows the overview on a screen in the office, with a token that can do nothing else.

## Search

### What is indexed

Every minute one control-plane replica (Postgres advisory lock) rebuilds the search documents and writes them to the log store's OpenSearch index `<prefix>-search`; documents that are gone are removed.

| Document | Searchable text                                        | Belongs to                                        |
| -------- | ------------------------------------------------------ | ------------------------------------------------- |
| Resource | kind, name, project, `spec.description`, `spec.title`  | its project; cluster resources: cluster roles     |
| Service  | service, deployment, project and its exposed hostnames | its project                                       |
| Node     | name and site                                          | cluster roles                                     |
| Plan     | id, status, projects (the newest 500 plans)            | its project if it touches one, else cluster roles |
| Alert    | title (open alerts, the newest 500)                    | its project; cluster alerts: cluster roles        |

- Only names and descriptions are indexed — never spec contents, secret values or compose files. `Cluster` isn't indexed.
- At most 10,000 documents.
- Without a log store, the same documents are built per request and matched in memory (every word must appear).

### Querying

`GET /api/search?q=app.example.com&limit=20` (limit 1–50, default 20; `q` up to 200 characters) answers results and actions:

```json
{
  "results": [
    {
      "id": "Service:shop/web/frontend",
      "kind": "Service",
      "title": "Service shop/web/frontend",
      "project": "shop",
      "link": "/health/service/shop/web/frontend",
      "favourite": false
    }
  ],
  "actions": []
}
```

- Prefix matching over title, name and text (title weighs most).
- Results are scoped like everything else: project documents for those who may read the project, cluster-level documents for cluster roles.
- Order: **favourites** first, then **recently visited** (newest visit first), then relevance.

### Favourites and recently visited

Items are document ids (`Kind:key`, e.g. `Node:n3`, `Deployment:shop/web`, `Plan:<uuid>`). Both are per user (the static API key counts as one user).

| Request                               | Meaning                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/search/favorites`           | the caller's favourites                                            |
| `PUT /api/search/favorites/{item}`    | add (URL-encode the `/` in ids)                                    |
| `DELETE /api/search/favorites/{item}` | remove                                                             |
| `POST /api/search/recent`             | `{"item": "…"}`: the console records a visit; the last 20 are kept |

### Command palette

The same query also matches actions, only those the caller may do:

| Query                                       | Action                                                                          | Who                              |
| ------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| `drain n2`, `cordon node n1`, `uncordon n1` | API call `POST /nodes/{node}/{drain,cordon,uncordon}` (up to 5 nodes by prefix) | cluster admins, infra operators  |
| `create plan`, `new plan` (or a prefix)     | open the plan editor                                                            | developers and up, cluster roles |
| `logs api`, `logs of api`                   | open the logs of matching services (up to 5)                                    | readers of the service's project |
| `health shop`, `health of shop`             | open a project's health tree (up to 5)                                          | readers of the project           |

API actions are confirmed in the console before they run, and run with the caller's own rights.

Personal access tokens need `cluster:read` for search, favourites and visits.

## Wallboard

The wallboard is the kiosk view of the [overview](./overview-and-health.md): for the scope and then for each project in rotation, the health headline, the needs-attention items that aren't user-specific (failed rollbacks, failed and at-risk entities, firing alerts that aren't silenced) and the summary bar.

### Tokens

A wallboard uses a dedicated **wallboard token**, not a user's login:

- **Cluster admins** create cluster-wide tokens (no `projects`): the kiosk shows the cluster and every project, as read-only as an auditor sees it.
- **Project admins** create tokens for projects they administer (`projects`, up to 20): the kiosk shows those projects, as a project viewer sees them.
- Tokens (`lw_wb_` + 43 characters) are shown **once**, stored as SHA-256, can expire (`expiresInDays`, 1–3,650; default never) and be revoked. The last use is recorded (at most once a minute).
- Creating and revoking tokens is audited. Each caller lists and revokes the tokens they could create.

```bash
curl https://<control-plane>/api/wallboards \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "Office TV", "projects": ["shop"], "expiresInDays": 365}'
```

### The kiosk

`GET /api/public/wallboard` with the header `Authorization: Wallboard <token>` — and nothing else: the token is no API credential, works for no other endpoint, and isn't accepted as a query parameter. The console keeps it in the URL fragment (`#…`), which browsers never send to the server, so it doesn't end up in access logs.

```json
{
  "name": "Office TV",
  "sections": [
    {
      "scope": "shop",
      "headline": { "state": "healthy", "message": "Healthy", "key": "project/shop" },
      "inbox": [],
      "summary": { "sites": 0, "nodes": { "total": 0, "up": 0 }, "deployments": 3, "capacity": null, "…": "…" }
    }
  ]
}
```

A section's inbox has at most 20 items. Projects of a token that no longer exist simply show nothing. An unknown, expired or revoked token answers `401`.

## API

| Request                                    | Meaning                                        | Scope            |
| ------------------------------------------ | ---------------------------------------------- | ---------------- |
| `GET /api/search`                          | results and actions                            | `cluster:read`   |
| `GET /api/search/favorites`                | favourites                                     | `cluster:read`   |
| `PUT\|DELETE /api/search/favorites/{item}` | add / remove a favourite                       | `cluster:read`   |
| `POST /api/search/recent`                  | record a visit                                 | `cluster:read`   |
| `POST /api/wallboards`                     | create a token (answers it once)               | `projects:admin` |
| `GET /api/wallboards`                      | tokens the caller manages (not revoked)        | `projects:admin` |
| `DELETE /api/wallboards/{id}`              | revoke                                         | `projects:admin` |
| `GET /api/public/wallboard`                | kiosk data, `Authorization: Wallboard <token>` | —                |

## Not there yet

- Search can't yet focus and highlight the found element on the topology map.
- Running operations don't show on the wallboard yet.
