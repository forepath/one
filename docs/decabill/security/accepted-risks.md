# Accepted risks (register)

This register records **explicit risk acceptance** for Decabill product and deployment constraints that deviate from stricter security baselines. It supports **BSI / ISMS-style** traceability and **CRA-oriented** technical documentation (risk treatment and transparency). For vulnerability reporting, SBOM paths, and disclosure process, see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**.

**Review cadence:** entries use acceptance **2026-05-06** and next review **2027-05-06** unless a row states otherwise; trigger an early review if cloud-init templates, billing multi-tenancy, CSP integration, authentication resolution, or Trivy gating policy change materially.

---

## DR-001 - Provisioning SSH (cloud-init templates)

| Field                                             | Recorded value                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                            | DR-001                                                                                                                                                                                                                             |
| **Area**                                          | Provisioning SSH in cloud-init templates                                                                                                                                                                                           |
| **Configuration**                                 | **`PermitRootLogin yes`** and **root** `authorized_keys` installed via provisioning scripts (`libs/domains/decabill/backend/feature-billing-manager/src/lib/utils/cloud-init/agent-controller.utils.ts`, `agent-manager.utils.ts`) |
| **Residual risk**                                 | Compromise of the provisioning SSH private key or leakage of user-data/metadata can yield **root** on affected instances.                                                                                                          |
| **Mitigations in scope of this repo (templates)** | SSH **key-based** access; **password authentication disabled** in generated `sshd` configuration.                                                                                                                                  |
| **Compensating controls (deployer / org)**        | Restrict network access (security groups, allowlisted IPs, bastion), rotate keys, monitor instances, minimize secrets in user-data.                                                                                                |
| **Risk owner**                                    | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                               |
| **Acceptor**                                      | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                              |
| **Acceptance date**                               | **2026-05-06**                                                                                                                                                                                                                     |
| **Next review date**                              | **2027-05-06**                                                                                                                                                                                                                     |
| **Rationale (business / technical)**              | First-boot automation prioritizes operational simplicity for provisioned hosts bundled with service plans. Non-root SSH and **`PermitRootLogin no`** remain the documented hardening path when constraints allow.                  |

#### Operator summary (DR-001)

Some Decabill provisioning flows generate cloud-init that configures **SSH for `root`** and installs **`authorized_keys` under `/root/.ssh/`**. This is a **known, documented** property. Mitigations in templates are **key-only** SSH and **disabled password authentication**. Deployers should add network controls, bastions, key rotation, and where possible non-root administration with **`PermitRootLogin no`**.

---

## DR-002 - Billing multi-tenant API key scope (`STATIC_API_KEY_TENANT_ID` unset)

| Field                                 | Recorded value                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | DR-002                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Area**                              | **Billing manager** multi-tenancy with **`AUTHENTICATION_METHOD=api-key`** (or inferred api-key when **`STATIC_API_KEY`** is set). Implementation: `TenantUserGuard` in `libs/domains/decabill/backend/feature-billing-manager/src/lib/guards/tenant-user.guard.ts`; admin bypass via `ensureAdmin()` in `billing-access.utils.ts`.                                                                           |
| **Configuration**                     | A **single** deployment-wide **`STATIC_API_KEY`**. **`STATIC_API_KEY_TENANT_ID`** is **optional**. When unset, a valid API key is accepted for **any** tenant id allowed by **`TENANTS`** / **`X-Tenant`** (each request selects the tenant via header). API key auth is treated as **admin** for billing admin routes.                                                                                       |
| **Residual risk**                     | Anyone who possesses **`STATIC_API_KEY`** can read and mutate **all** configured tenants' billing data by changing **`X-Tenant`**, not only one tenant. This is **cross-tenant admin access** from a single shared secret.                                                                                                                                                                                    |
| **Mitigations in scope of this repo** | **`STATIC_API_KEY_TENANT_ID`** optionally binds API key auth to one tenant (must match **`X-Tenant`**). User/session auth (**keycloak** / **users**) enforces per-user **`tenant_id`**. WebSocket dashboard status does **not** stream data to API key clients.                                                                                                                                               |
| **Compensating controls (deployer)**  | Treat **`STATIC_API_KEY`** as a **high-value** secret (rotation, least exposure, no client-side use). Prefer **keycloak** or **users** for the billing console in multi-tenant production. Set **`STATIC_API_KEY_TENANT_ID`** when automation must use API key against **one** tenant only. Use separate billing deployments or keys per tenant if policy forbids shared cross-tenant automation credentials. |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                                                                                                                                                          |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                                                                                                                                                         |
| **Acceptance date**                   | **2026-06-19**                                                                                                                                                                                                                                                                                                                                                                                                |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                                                                                                                                                                |
| **Rationale (business / technical)**  | Billing deployments use **one** static API key for automation and operator scripts. Requiring a separate key per tenant would multiply secret management without a current product requirement. **Explicit acceptance:** shared key plus optional tenant header is **intentional**; operators who need single-tenant binding use **`STATIC_API_KEY_TENANT_ID`**.                                              |

#### Operator summary (DR-002)

With **`STATIC_API_KEY`** and **without** **`STATIC_API_KEY_TENANT_ID`**, the key is **not** limited to one tenant: it grants **admin-level access to every tenant** allowed by **`TENANTS`**, selected per request via **`X-Tenant`**. Set **`STATIC_API_KEY_TENANT_ID`** to restrict API key use to one tenant. Interactive users (Keycloak/JWT) remain scoped to their own tenant. See **[Environment configuration multi-tenancy](../deployment/environment-configuration.md#multi-tenancy)**.

---

## DR-003 - Web frontends: CSP `unsafe-inline` / `unsafe-eval` (Monaco)

| Field                                 | Recorded value                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                                | DR-003                                                                                                                                                                                                                                                                                                                                     |
| **Area**                              | **decabill-frontend-billing-console** and **decabill-frontend-docs** Express servers                                                                                                                                                                                                                                                       |
| **Configuration**                     | **Content Security Policy** allows **`'unsafe-inline'`** and **`'unsafe-eval'`** so **Monaco Editor** and related tooling work; policy is sent as **`Content-Security-Policy-Report-Only`** by default (violations reported, not blocked). Implementation: `libs/domains/shared/frontend/util-express-server/src/lib/security-headers.ts`. |
| **Residual risk**                     | XSS impact can be greater than under a strict CSP; **report-only** does not block violations.                                                                                                                                                                                                                                              |
| **Mitigations in scope of this repo** | Set **`CSP_ENFORCE=true`** only in environments where compatibility is validated; billing console compose defaults to **`CSP_ENFORCE=true`** when operators have verified connectivity to the API.                                                                                                                                         |
| **Compensating controls (deployer)**  | Enforce HTTPS, restrict **CORS** on the billing API, keep dependencies patched, monitor CSP reports if configured.                                                                                                                                                                                                                         |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                                                                                       |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                                                                                      |
| **Acceptance date**                   | **2026-05-06**                                                                                                                                                                                                                                                                                                                             |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                                                                                             |
| **Rationale (business / technical)**  | Monaco and admin tooling are **core** to billing operations; tightening without a validated strategy risks **breaking** the console. Enforcement is **opt-in** or post-verification.                                                                                                                                                       |

#### Operator summary (DR-003)

By default, CSP may be **report-only** depending on `CSP_ENFORCE`. Use **`CSP_ENFORCE=true`** only after verification. See **[Operational hardening content security policy](./operational-hardening.md#content-security-policy-frontend-express)** and **[Environment configuration](../deployment/environment-configuration.md)**.

---

## DR-004 - Backend authentication method resolution

| Field                                 | Recorded value                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | DR-004                                                                                                                                                                                                                                                                    |
| **Area**                              | **`getAuthenticationMethod`** in `libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts` (shared by billing manager)                                                                                                                                       |
| **Configuration**                     | **`AUTHENTICATION_METHOD`** is **not** required to be set. When unset: if **`STATIC_API_KEY`** is set → **api-key** mode; otherwise → **keycloak**. **Protected routes are not anonymous**; Keycloak or users-mode guards still enforce authentication per configuration. |
| **Residual risk**                     | Deployments may **implicitly** run in **keycloak** mode without a single obvious env flag, which can surprise operators who expect an explicit mode switch. **`STATIC_API_KEY`** remains a **high-value secret** in **api-key** mode.                                     |
| **Mitigations in scope of this repo** | Documented resolution order; **api-key** mode requires **`STATIC_API_KEY`** and validates the header; **keycloak** / **users** paths delegate to their guards.                                                                                                            |
| **Compensating controls (deployer)**  | For **api-key** or **users** deployments, set **`AUTHENTICATION_METHOD`** explicitly; treat **`STATIC_API_KEY`** with rotation and least exposure; prefer **keycloak** with the customer IdP for integrated enterprise setups.                                            |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                      |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                     |
| **Acceptance date**                   | **2026-05-06**                                                                                                                                                                                                                                                            |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                            |
| **Rationale (business / technical)**  | Defaulting to **keycloak** when no API key is configured favors the **enterprise-typical** integrated IdP path while preserving backward compatibility for **`STATIC_API_KEY`**.                                                                                          |

#### Operator summary (DR-004)

Set **`AUTHENTICATION_METHOD`** explicitly if your policy requires **fully explicit** configuration. Never expose **`STATIC_API_KEY`**. See **[Operational hardening authentication mode](./operational-hardening.md#authentication-mode-backends)**.

---

## DR-005 - CI / local Trivy: unfixed vulnerabilities not gated

| Field                                 | Recorded value                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | DR-005                                                                                                                                                                                                                                                  |
| **Area**                              | **Trivy** vulnerability scanning (`trivy.yaml` at repository root, pull-request CI, pre-commit, local image scans)                                                                                                                                      |
| **Configuration**                     | **`vulnerability.ignore-unfixed: true`**: findings **without a Fixed Version** are **excluded from the fail gate**. Only **CRITICAL** severities with an available fix fail CI and local hooks (see [CI security scanning](./ci-security-scanning.md)). |
| **Residual risk**                     | Known **CRITICAL** issues may remain in dependencies, base images, or OS packages until upstream publishes a fix; they are visible in SARIF/report output but do not block merge.                                                                       |
| **Mitigations in scope of this repo** | Trivy still scans for **vuln**, **secret**, and **misconfig**; **HIGH** and below are report-only; per-CVE exceptions use `.trivyignore` with traceability. Decabill SBOMs are published on release (`decabill-*.cdx.json`).                            |
| **Compensating controls (deployer)**  | Monitor GitHub Security / SARIF artifacts; patch when fixes ship; track accepted CVEs in `.trivyignore` only when a fix exists but cannot be applied yet.                                                                                               |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                    |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                   |
| **Acceptance date**                   | **2026-05-16**                                                                                                                                                                                                                                          |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                          |
| **Rationale (business / technical)**  | Blocking on unfixed CVEs creates **false failures** with no remediation path and delays delivery without reducing exploitable risk. Gating on **fixable CRITICAL** issues keeps CI actionable while acknowledging vendor lag.                           |

#### Operator summary (DR-005)

**Unfixed vulnerabilities are acceptable for pipeline gating.** Address **CRITICAL** findings that have a published fix; track anything else via SARIF and release SBOMs. Do not add unfixed CVEs to `.trivyignore` solely to silence the gate. See **[CI security scanning](./ci-security-scanning.md)**.

---

## Hardening paths (if an acceptance is withdrawn)

- **DR-001:** Prefer a non-root admin user, **`PermitRootLogin no`**, least-privilege `sudo`, and cloud-init-native `ssh_authorized_keys` where possible; reduce secrets in user-data.
- **DR-002:** Require **`STATIC_API_KEY_TENANT_ID`** whenever **`STATIC_API_KEY`** is set and **`TENANTS`** lists more than one id; or reject API key auth when multiple tenants are configured; or issue per-tenant API keys (product change).
- **DR-003:** Tighten CSP after automated and manual verification so billing console UI (including Monaco) still functions.
- **DR-004:** Require **`AUTHENTICATION_METHOD`** in all environments if auditors demand explicit configuration.
- **DR-005:** Set **`vulnerability.ignore-unfixed: false`** if policy requires failing on all CRITICAL findings regardless of fix availability.

---

## Related documentation

- **[Compliance and standards](./compliance-and-standards.md)**
- **[Operational hardening](./operational-hardening.md)**
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**
- **[CI security scanning (Trivy)](./ci-security-scanning.md)**

---

_Update this register when acceptance is renewed or withdrawn._
