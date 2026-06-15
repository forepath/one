# Accepted risks (register)

This register records **explicit risk acceptance** for product and deployment constraints that deviate from stricter security baselines. It supports **BSI / ISMS-style** traceability and **CRA-oriented** technical documentation (risk treatment and transparency). A compact summary table may also be published at the repository root in `SECURITY.md` for hosts that surface that file. For vulnerability reporting, SBOM paths, and desktop checksum verification, see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**.

**Review cadence:** entries use acceptance **2026-05-06** and next review **2027-05-06** unless a row states otherwise; trigger an early review if the relevant templates, packaging, CSP integration, authentication resolution, or Electron shell policy change materially.

---

## AR-001 — Provisioning SSH (cloud-init templates)

| Field                                             | Recorded value                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                            | AR-001                                                                                                                                                                                                        |
| **Area**                                          | Provisioning SSH in cloud-init templates                                                                                                                                                                      |
| **Configuration**                                 | **`PermitRootLogin yes`** and **root** `authorized_keys` installed via provisioning scripts (`libs/domains/agenstra/backend/feature-billing-manager/.../agent-controller.utils.ts`, `agent-manager.utils.ts`) |
| **Residual risk**                                 | Compromise of the provisioning SSH private key or leakage of user-data/metadata can yield **root** on affected instances.                                                                                     |
| **Mitigations in scope of this repo (templates)** | SSH **key-based** access; **password authentication disabled** in generated `sshd` configuration.                                                                                                             |
| **Compensating controls (deployer / org)**        | Restrict network access (security groups, allowlisted IPs, bastion), rotate keys, monitor instances, minimize secrets in user-data.                                                                           |
| **Risk owner**                                    | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                          |
| **Acceptor**                                      | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                         |
| **Acceptance date**                               | **2026-05-06**                                                                                                                                                                                                |
| **Next review date**                              | **2027-05-06**                                                                                                                                                                                                |
| **Rationale (business / technical)**              | First-boot automation prioritizes operational simplicity for provisioned hosts. Non-root SSH and **`PermitRootLogin no`** remain the documented hardening path when constraints allow.                        |

#### Operator summary (AR-001)

Some deployment flows generate cloud-init that configures **SSH for `root`** and installs **`authorized_keys` under `/root/.ssh/`**. This is a **known, documented** property. Mitigations in templates are **key-only** SSH and **disabled password authentication**. Deployers should add network controls, bastions, key rotation, and—where possible—non-root administration with **`PermitRootLogin no`**.

---

## AR-002 — Desktop app: no OS-trusted code signing / no in-app auto-update

| Field                                  | Recorded value                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                 | AR-002                                                                                                                                                                                                                                   |
| **Area**                               | **`native-agent-console`** (Electron Forge pipeline, `apps/agenstra/native-agent-console/forge.config.js`)                                                                                                                               |
| **Configuration**                      | **No** OS-trusted **code signing** and **no** **in-app auto-update** channel in the documented release pipeline.                                                                                                                         |
| **Residual risk**                      | Users rely on **manual checksum verification** and a trusted download channel rather than OS trust stores or automatic security updates from the application.                                                                            |
| **Mitigations in scope of this repo**  | Release artifacts include **`SHA256SUMS`** and **`integrity-manifest.json`** produced by the **`release-integrity`** Nx project (`tools/release-integrity` in the repository); CI/release pipelines generate and verify these manifests. |
| **Compensating controls (user / org)** | Verify checksums after download; prefer the **web browser** as the primary client; treat **`STATIC_API_KEY`** and other secrets per **[Environment configuration](../deployment/environment-configuration.md)**.                         |
| **Risk owner**                         | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                     |
| **Acceptor**                           | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                    |
| **Acceptance date**                    | **2026-05-06**                                                                                                                                                                                                                           |
| **Next review date**                   | **2027-05-06**                                                                                                                                                                                                                           |
| **Rationale (business / technical)**   | The product is **primarily** used via the **web browser**; the native build is a **secondary** distribution channel.                                                                                                                     |

#### Operator summary (AR-002)

**OS-trusted code signing** and **in-app auto-update** are **not** provided. Verify artifacts using **`SHA256SUMS`** / **`integrity-manifest.json`**. Details: **[Desktop release integrity](./vulnerability-reporting-and-artifacts.md#desktop-release-integrity)**.

---

## AR-003 — Web frontends: CSP `unsafe-inline` / `unsafe-eval` (Monaco)

| Field                                 | Recorded value                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                                | AR-003                                                                                                                                                                                                                                                                                                                                     |
| **Area**                              | **`frontend-*`** Express servers                                                                                                                                                                                                                                                                                                           |
| **Configuration**                     | **Content Security Policy** allows **`'unsafe-inline'`** and **`'unsafe-eval'`** so **Monaco Editor** and related tooling work; policy is sent as **`Content-Security-Policy-Report-Only`** by default (violations reported, not blocked). Implementation: `libs/domains/shared/frontend/util-express-server/src/lib/security-headers.ts`. |
| **Residual risk**                     | XSS impact can be greater than under a strict CSP; **report-only** does not block violations.                                                                                                                                                                                                                                              |
| **Mitigations in scope of this repo** | Set **`CSP_ENFORCE=true`** only in environments where compatibility is validated; plan stricter CSP with a validated Monaco/worker/nonce strategy.                                                                                                                                                                                         |
| **Compensating controls (deployer)**  | Enforce HTTPS, restrict **CORS**, keep dependencies patched, monitor reports if CSP reporting is configured.                                                                                                                                                                                                                               |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                                                                                       |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                                                                                      |
| **Acceptance date**                   | **2026-05-06**                                                                                                                                                                                                                                                                                                                             |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                                                                                             |
| **Rationale (business / technical)**  | Monaco is **core** to the console; tightening without a validated strategy risks **breaking** the product. Enforcement is **opt-in** after verification.                                                                                                                                                                                   |

#### Operator summary (AR-003)

By default, CSP is **report-only**. Use **`CSP_ENFORCE=true`** only after verification. See **[Operational hardening — Content Security Policy](./operational-hardening.md#content-security-policy-frontend-express)** and **[Environment configuration](../deployment/environment-configuration.md)**.

---

## AR-004 — Backend authentication method resolution

| Field                                 | Recorded value                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | AR-004                                                                                                                                                                                                                                                                                                                          |
| **Area**                              | **`getAuthenticationMethod`** in `libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts`                                                                                                                                                                                                                         |
| **Configuration**                     | **`AUTHENTICATION_METHOD`** is **not** required to be set. When unset: if **`STATIC_API_KEY`** is set → **api-key** mode; otherwise → **keycloak** (OIDC / Keycloak integration with the deployer’s IdP). **Protected routes are not anonymous**—Keycloak- or users-mode guards still enforce authentication per configuration. |
| **Residual risk**                     | Deployments may **implicitly** run in **keycloak** mode without a single obvious env flag, which can surprise operators who expect an explicit mode switch. **`STATIC_API_KEY`** remains a **high-value secret** in **api-key** mode.                                                                                           |
| **Mitigations in scope of this repo** | Documented resolution order; **api-key** mode requires **`STATIC_API_KEY`** and validates the header; **keycloak** / **users** paths delegate to their guards.                                                                                                                                                                  |
| **Compensating controls (deployer)**  | For **api-key** or **users** deployments, set **`AUTHENTICATION_METHOD`** explicitly; treat **`STATIC_API_KEY`** with rotation and least exposure; prefer **keycloak** with the customer IdP for integrated enterprise setups.                                                                                                  |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                                                                            |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                                                                           |
| **Acceptance date**                   | **2026-05-06**                                                                                                                                                                                                                                                                                                                  |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                                                                                  |
| **Rationale (business / technical)**  | Defaulting to **keycloak** when no API key is configured favors the **enterprise-typical** integrated IdP path while preserving backward compatibility for **`STATIC_API_KEY`**.                                                                                                                                                |

#### Operator summary (AR-004)

Set **`AUTHENTICATION_METHOD`** explicitly if your policy requires **fully explicit** configuration. Never expose **`STATIC_API_KEY`**. See **[Authentication](../features/authentication.md)** and **[Operational hardening — Authentication mode](./operational-hardening.md#authentication-mode-backends)**.

---

## AR-005 — Desktop window open policy (`native-agent-console`)

| Field                                 | Recorded value                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | AR-005                                                                                                                                                                                             |
| **Area**                              | **`setWindowOpenHandler`** in `apps/agenstra/native-agent-console/src/main.ts`                                                                                                                     |
| **Configuration**                     | Handler uses **`action: 'allow'`** so `window.open` / `target=_blank` can open new Electron windows with inherited `webPreferences`.                                                               |
| **Residual risk**                     | Pop-up or multi-window flows could be abused in **phishing- or distraction-style** attacks compared with a stricter **deny** or allowlist policy.                                                  |
| **Mitigations in scope of this repo** | **Sandbox** and **contextIsolation** remain enabled; there is **no address bar (omnibox)** and **users cannot install browser extensions** in this shell, which limits some browser-class attacks. |
| **Compensating controls (deployer)**  | Prefer the **web client** for untrusted content; revisit policy if the shell gains **untrusted browsing** or **URL-entry** UX.                                                                     |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                               |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                              |
| **Acceptance date**                   | **2026-05-06**                                                                                                                                                                                     |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                     |
| **Rationale (business / technical)**  | Allowing new windows supports legitimate product flows (e.g. external documentation) while the **secondary** desktop channel keeps a reduced attack surface versus a full browser.                 |

#### Operator summary (AR-005)

New windows are **allowed** by design. Risk is **lower** than in a general-purpose browser because of the **non-browser** shell, but operators should treat the desktop app as **not** a general browsing environment for untrusted sites.

---

## AR-006 — CI / local Trivy: unfixed vulnerabilities not gated

| Field                                 | Recorded value                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                                | AR-006                                                                                                                                                                                                                                                                                               |
| **Area**                              | **Trivy** vulnerability scanning ([`trivy.yaml`](../../../trivy.yaml), pull-request CI, pre-commit, local image scans—not the release workflow)                                                                                                                                                      |
| **Configuration**                     | **`vulnerability.ignore-unfixed: true`** — findings **without a Fixed Version** (no vendor/upstream fix published yet) are **excluded from the fail gate**. Only **CRITICAL** severities with an available fix fail CI and local hooks (see [`ci-security-scanning.md`](./ci-security-scanning.md)). |
| **Residual risk**                     | Known **CRITICAL** issues may remain in dependencies, base images, or OS packages until upstream publishes a fix; they are visible in SARIF/report output but do not block merge or release.                                                                                                         |
| **Mitigations in scope of this repo** | Trivy still scans for **vuln**, **secret**, and **misconfig**; **HIGH** and below are report-only; per-CVE exceptions use [`.trivyignore`](../../../.trivyignore) with traceability. SBOM publication and Dependency Track on release provide ongoing visibility.                                    |
| **Compensating controls (deployer)**  | Monitor GitHub Security / SARIF artifacts; patch when fixes ship; track accepted CVEs in `.trivyignore` only when a fix exists but cannot be applied yet (not for permanently unfixed issues).                                                                                                       |
| **Risk owner**                        | Maintaining party for this repository and product security documentation (Forepath).                                                                                                                                                                                                                 |
| **Acceptor**                          | Repository maintainer (acceptance recorded in project documentation).                                                                                                                                                                                                                                |
| **Acceptance date**                   | **2026-05-16**                                                                                                                                                                                                                                                                                       |
| **Next review date**                  | **2027-05-06**                                                                                                                                                                                                                                                                                       |
| **Rationale (business / technical)**  | Blocking on unfixed CVEs creates **false failures** with no remediation path and delays delivery without reducing exploitable risk. Gating on **fixable CRITICAL** issues keeps CI actionable while acknowledging vendor lag.                                                                        |

#### Operator summary (AR-006)

**Unfixed vulnerabilities are acceptable for pipeline gating** — Trivy will not fail because a CVE has an empty **Fixed Version**. Address **CRITICAL** findings that have a published fix; track anything else via SARIF and release SBOMs. Do not add unfixed CVEs to `.trivyignore` solely to silence the gate (they are already ignored). See **[CI security scanning](./ci-security-scanning.md)**.

---

## Hardening paths (if an acceptance is withdrawn)

- **AR-001:** Prefer a non-root admin user, **`PermitRootLogin no`**, least-privilege `sudo`, and cloud-init-native `ssh_authorized_keys` where possible; reduce secrets in user-data.
- **AR-002:** Add OS-trusted signing and/or Electron auto-update when native distribution requirements justify the operational cost.
- **AR-003:** Tighten CSP after automated and manual verification so core UI (including Monaco) still functions.
- **AR-004:** Require **`AUTHENTICATION_METHOD`** in all environments if auditors demand explicit configuration, or add startup validation that fails when **`STATIC_API_KEY`** is set without an explicit mode.
- **AR-005:** Tighten **`setWindowOpenHandler`** (for example URL allowlist or **`action: 'deny'`**) if the product loads untrusted origins or adds browser-like navigation.
- **AR-006:** Set **`vulnerability.ignore-unfixed: false`** (and optionally add **HIGH** to `severity`) if policy requires failing on all CRITICAL findings regardless of fix availability; expect more `.trivyignore` churn until dependencies catch up.

---

## Related documentation

- **[Compliance and standards](./compliance-and-standards.md)**
- **[Operational hardening](./operational-hardening.md)**
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**
- **[CI security scanning (Trivy)](./ci-security-scanning.md)**

---

_Update this register when acceptance is renewed or withdrawn._
