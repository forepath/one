# Container image security

This page documents **first-party Decabill Docker images**: runtime users, secrets handling, and build conventions. It complements **[Operational hardening](./operational-hardening.md)** and **[Docker deployment](../deployment/docker-deployment.md)**.

## Published images

| Image                               | Application                  | Registry reference                                        |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------- |
| **decabill-billing-api**            | Backend billing manager      | `ghcr.io/forepath/decabill-billing-api:latest`            |
| **decabill-billing-console-server** | Frontend billing console SSR | `ghcr.io/forepath/decabill-billing-console-server:latest` |
| **decabill-docs-server**            | Frontend docs SSR            | `ghcr.io/forepath/decabill-docs-server:latest`            |

Build targets:

```bash
nx docker:api decabill-backend-billing-manager
nx docker:server decabill-frontend-billing-console
nx docker:server decabill-frontend-docs
```

## Runtime users

| Image family               | User       | Default UID/GID | Notes                              |
| -------------------------- | ---------- | --------------- | ---------------------------------- |
| **decabill-billing-api**   | `agenstra` | **10001**       | `ARG APP_UID` / `APP_GID` at build |
| **billing-console-server** | `node`     | **1000**        | Alpine-based SSR image             |
| **docs-server**            | `node`     | **1000**        | Alpine-based SSR image             |

Processes do **not** run as root after container start.

## Billing API image (`decabill-billing-api`)

Source: `apps/decabill/backend-billing-manager/Dockerfile.api`

- Exposes **3200** (HTTP API) and **8082** (WebSocket)
- Health check: `GET /api/health`
- **No Docker socket mount** (billing does not orchestrate agent containers on the host)
- Secrets (database, Stripe, `ENCRYPTION_KEY`, `STATIC_API_KEY`, cloud API tokens) are supplied at **deploy time**, not as default `ENV` in the image

### Volumes (typical compose)

| Mount                | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `invoice_pdf_data`   | Invoice PDFs at `/data/invoices`          |
| `./provider-plugins` | Optional dynamic payment/provider plugins |

### Build arguments

| Argument  | Purpose                     | Default   |
| --------- | --------------------------- | --------- |
| `APP_UID` | Runtime user `agenstra` UID | **10001** |
| `APP_GID` | Runtime user `agenstra` GID | **10001** |

Unlike agent orchestration API images, the billing API image does **not** require `DOCKER_GID` because it does not access `/var/run/docker.sock`.

## Billing console server image (`decabill-billing-console-server`)

Source: `apps/decabill/frontend-billing-console/Dockerfile.server`

- Default `PORT=4500`
- Runs as **`node`** (UID **1000**)
- Runtime `CONFIG` URL and CSP variables documented in **[Environment configuration](../deployment/environment-configuration.md)**
- Compose often sets `CSP_CONNECT_SRC_EXTRA` to reach the billing API from the browser

## Docs server image (`decabill-docs-server`)

Source: `apps/shared/frontend-docs/Dockerfile.server` (same pattern as billing console)

- Default `PORT=4200`
- Runs as **`node`** (UID **1000**)
- Static documentation content; typically fewer `connect-src` requirements than the billing console

## Secrets and configuration

- Do not rely on image defaults for database passwords, Stripe keys, or API keys
- Set variables in Compose, Kubernetes secrets, or your orchestrator
- `ENCRYPTION_KEY` must be provided in production for encrypted subscription item fields

## Image scanning

Container images built in CI are scanned with Trivy on pull requests. Decabill images are included when built in the PR pipeline. See **[CI security scanning](./ci-security-scanning.md)** and **[DR-005](./accepted-risks.md#dr-005--ci--local-trivy-unfixed-vulnerabilities-not-gated)**.

Release publishes CycloneDX SBOMs for Decabill images as `container-decabill-*.cdx.json`. See **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**.

## Coordinated upgrades

Deploy **billing API, worker, and scheduler** containers from the **same release tag** when schema migrations or queue job contracts change. Mismatched tags between API and workers can cause job processing errors after deployments.

## Related documentation

- **[Operational hardening](./operational-hardening.md)** - Summary table and cross-links
- **[Docker deployment](../deployment/docker-deployment.md)** - Compose services
- **[Production checklist](../deployment/production-checklist.md)** - Pre-flight checks
- **[Background jobs](../deployment/background-jobs.md)** - Worker and scheduler images use the same billing API image with different `QUEUE_ROLE`

---

_For provisioning SSH accepted risk on provisioned instances, see [DR-001](./accepted-risks.md#dr-001--provisioning-ssh-cloud-init-templates)._
