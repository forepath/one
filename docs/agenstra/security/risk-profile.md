# Risk profile

This register scores cybersecurity risks for **monorepo applications** (`apps/*`) and **cross-cutting** concerns. It supports **BSI / ISMS-style** traceability and **CRA-oriented** technical documentation ([Compliance and standards](./compliance-and-standards.md)). Threats are defined in **[Threat model](./threat-model.md)**. Treatment is **Mitigate** (controls listed), **Accept** (see **[Accepted risks](./accepted-risks.md)**), or **Monitor** (operator/deployer).

**Review cadence:** service rows use last reviewed **2026-05-20** and next review **2027-05-06** unless a row or linked **AR-** entry states otherwise; trigger an early review when scores, architecture, or an accepted-risk entry changes materially.

---

## Scoring methodology

Each risk uses two dimensions. Levels are **LOW**, **MEDIUM**, **HIGH**, or **CRITICAL** (ordinal, not CVSS).

### Probability (P)

Likelihood the threat materializes in **intended or reasonably foreseeable** deployment without additional compensating controls.

| Level    | Numeric | Meaning                                                  |
| -------- | ------- | -------------------------------------------------------- |
| LOW      | 1       | Unlikely in typical hardened production                  |
| MEDIUM   | 2       | Possible with common misconfiguration or targeted attack |
| HIGH     | 3       | Likely without documented compensating controls          |
| CRITICAL | 4       | Expected in default or widely deployed weak posture      |

### Impact (I)

Effect on **confidentiality, integrity, or availability** of the product or customer data (worst reasonable case).

| Level    | Numeric | Meaning                                                                       |
| -------- | ------- | ----------------------------------------------------------------------------- |
| LOW      | 1       | Limited annoyance or single-user scope                                        |
| MEDIUM   | 2       | Data exposure or service degradation for one tenant/workspace                 |
| HIGH     | 3       | Multi-tenant or control-plane compromise                                      |
| CRITICAL | 4       | Full infrastructure takeover, widespread data breach, or safety-relevant harm |

### Accumulated score and overall severity

**Accumulated score** = **P<sub>numeric</sub> × I<sub>numeric</sub>** (range **1–16**).

| Accumulated score | Overall severity |
| ----------------- | ---------------- |
| 1–2               | **LOW**          |
| 3–6               | **MEDIUM**       |
| 8–9               | **HIGH**         |
| 10–16             | **CRITICAL**     |

Scores **7** map to **HIGH** (upper MEDIUM band). Document both **P**, **I**, and **accumulated** values for audit traceability.

**Example:** P = HIGH (3), I = CRITICAL (4) → accumulated **12** → overall **CRITICAL**.

---

## Service risk summary

| Service                             | Highest open severity | Primary drivers                                                                       | Last reviewed  | Next review date |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | -------------- | ---------------- |
| `backend-agent-controller`          | **CRITICAL**          | SSRF when allowlists weak (R-AC-01; mitigated if `CLIENT_ENDPOINT_ALLOWED_HOSTS` set) | **2026-05-20** | **2027-05-06**   |
| `backend-agent-manager`             | **HIGH**              | Docker socket abuse (R-AM-01)                                                         | **2026-05-20** | **2027-05-06**   |
| `frontend-agent-console`            | **MEDIUM**            | XSS under weak CSP (R-FE-01, **AR-003**)                                              | **2026-05-20** | **2027-05-06**   |
| `backend-billing-manager`           | **HIGH**              | Provisioning root SSH (R-BM-01, **AR-001**)                                           | **2026-05-20** | **2027-05-06**   |
| `native-agent-console`              | **MEDIUM**            | Unsigned updates / pop-ups (R-NA-01, **AR-002**, **AR-005**)                          | **2026-05-20** | **2027-05-06**   |
| `frontend-billing-console`          | **LOW**               | Billing data exposure (R-BC-01)                                                       | **2026-05-20** | **2027-05-06**   |
| `mcp-proxy`                         | **MEDIUM**            | Over-privileged MCP bridge (R-MCP-01)                                                 | **2026-05-20** | **2027-05-06**   |
| `frontend-portal` / `frontend-docs` | **LOW**               | Static content tampering (R-PO-01)                                                    | **2026-05-20** | **2027-05-06**   |
| `platform-authentication`           | **MEDIUM**            | Dev IdP defaults (R-PA-01)                                                            | **2026-05-20** | **2027-05-06**   |
| `mcp-devkit`                        | **LOW**               | Dev-only misuse (R-MCP-02)                                                            | **2026-05-20** | **2027-05-06**   |

---

## `backend-agent-controller`

| Field                     | Recorded value         |
| ------------------------- | ---------------------- |
| **Highest open severity** | **CRITICAL** (R-AC-01) |
| **Last reviewed**         | **2026-05-20**         |
| **Next review date**      | **2027-05-06**         |

| Risk ID | Threat ref | Description                                                                         | P          | I            | Accumulated | Overall      | Treatment                                                                                                       |
| ------- | ---------- | ----------------------------------------------------------------------------------- | ---------- | ------------ | ----------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| R-AC-01 | T-AC-03    | SSRF or DNS rebinding via misconfigured `client.endpoint` reaches internal services | HIGH (3)   | CRITICAL (4) | 12          | **CRITICAL** | Mitigate: `CLIENT_ENDPOINT_*` allowlists, TLS, DNS checks — [Operational hardening](./operational-hardening.md) |
| R-AC-02 | T-AC-04    | Credential confusion on HTTP proxy leaks user token to remote manager               | LOW (1)    | HIGH (3)     | 3           | **MEDIUM**   | Mitigate: header stripping (implemented)                                                                        |
| R-AC-03 | T-AC-01    | Compromise of `STATIC_API_KEY` grants full API access                               | MEDIUM (2) | CRITICAL (4) | 8           | **HIGH**     | Mitigate + **AR-004**; prefer Keycloak                                                                          |
| R-AC-04 | T-AC-06    | Abuse of admin import/automation APIs                                               | LOW (1)    | HIGH (3)     | 3           | **MEDIUM**   | Mitigate: RBAC, admin routes                                                                                    |
| R-AC-05 | T-X-01     | Unpatched dependency in controller image                                            | MEDIUM (2) | HIGH (3)     | 6           | **MEDIUM**   | Mitigate: Trivy, SBOM; **AR-006** for unfixed CVEs                                                              |

**R-AC-01:** **CRITICAL** overall severity assumes **missing or over-broad** production **`CLIENT_ENDPOINT_ALLOWED_HOSTS`** (controller exits on startup if unset in production). Narrow allowlists, TLS verification, and DNS checks per [Operational hardening](./operational-hardening.md) are the expected mitigation.

---

## `backend-agent-manager`

| Field                     | Recorded value     |
| ------------------------- | ------------------ |
| **Highest open severity** | **HIGH** (R-AM-01) |
| **Last reviewed**         | **2026-05-20**     |
| **Next review date**      | **2027-05-06**     |

| Risk ID | Threat ref | Description                                     | P          | I            | Accumulated | Overall    | Treatment                                                 |
| ------- | ---------- | ----------------------------------------------- | ---------- | ------------ | ----------- | ---------- | --------------------------------------------------------- |
| R-AM-01 | T-AM-03    | Compromised API + Docker socket → host takeover | MEDIUM (2) | CRITICAL (4) | 8           | **HIGH**   | Mitigate: non-root, restricted sudo, network segmentation |
| R-AM-02 | T-AM-04    | Container escape from agent workspace           | LOW (1)    | CRITICAL (4) | 4           | **MEDIUM** | Mitigate: non-root `agenstra`, deployer seccomp/AppArmor  |
| R-AM-03 | T-AM-06    | Leakage of Git credentials from worker home     | MEDIUM (2) | HIGH (3)     | 6           | **MEDIUM** | Mitigate: mount permissions, secret rotation              |
| R-AM-04 | T-AM-07    | VNC/SSH brute force on exposed sidecars         | MEDIUM (2) | MEDIUM (2)   | 4           | **MEDIUM** | Mitigate: network ACLs, strong passwords                  |
| R-AM-05 | T-AM-01    | Stolen agent password → workspace access        | MEDIUM (2) | HIGH (3)     | 6           | **MEDIUM** | Mitigate: TLS, credential storage on controller           |

---

## `frontend-agent-console` (shared patterns for `frontend-*`)

| Field                     | Recorded value                   |
| ------------------------- | -------------------------------- |
| **Highest open severity** | **MEDIUM** (R-FE-01; **AR-003**) |
| **Last reviewed**         | **2026-05-20**                   |
| **Next review date**      | **2027-05-06**                   |

| Risk ID | Threat ref | Description                                  | P          | I        | Accumulated | Overall    | Treatment                                                   |
| ------- | ---------- | -------------------------------------------- | ---------- | -------- | ----------- | ---------- | ----------------------------------------------------------- |
| R-FE-01 | T-FE-04    | XSS with report-only CSP exfiltrates session | MEDIUM (2) | HIGH (3) | 6           | **MEDIUM** | Accept **AR-003**; mitigate: `CSP_ENFORCE`, patching, HTTPS |
| R-FE-02 | T-FE-02    | Malicious remote `CONFIG` redirects users    | LOW (1)    | HIGH (3) | 3           | **MEDIUM** | Mitigate: `CONFIG_ALLOWED_HOSTS`, HTTPS                     |
| R-FE-03 | T-FE-01    | Token theft from browser                     | MEDIUM (2) | HIGH (3) | 6           | **MEDIUM** | Mitigate: OIDC, secure cookies, short sessions              |

---

## `backend-billing-manager` / `frontend-billing-console`

| Field                     | Recorded value                 |
| ------------------------- | ------------------------------ |
| **Highest open severity** | **HIGH** (R-BM-01; **AR-001**) |
| **Last reviewed**         | **2026-05-20**                 |
| **Next review date**      | **2027-05-06**                 |

| Risk ID | Threat ref | Description                                       | P          | I            | Accumulated | Overall    | Treatment                                              |
| ------- | ---------- | ------------------------------------------------- | ---------- | ------------ | ----------- | ---------- | ------------------------------------------------------ |
| R-BM-01 | T-BM-02    | Provisioning key leak → **root** on new cloud VMs | MEDIUM (2) | CRITICAL (4) | 8           | **HIGH**   | Accept **AR-001**; mitigate: key rotation, SG/firewall |
| R-BM-02 | T-BM-01    | Cloud API token theft                             | LOW (1)    | CRITICAL (4) | 4           | **MEDIUM** | Mitigate: vault, least-privilege cloud IAM             |
| R-BC-01 | T-BC-01    | Unauthorized access to billing console            | LOW (1)    | MEDIUM (2)   | 2           | **LOW**    | Mitigate: authN/Z, private network                     |

---

## `native-agent-console`

| Field                     | Recorded value                               |
| ------------------------- | -------------------------------------------- |
| **Highest open severity** | **MEDIUM** (R-NA-01; **AR-002**, **AR-005**) |
| **Last reviewed**         | **2026-05-20**                               |
| **Next review date**      | **2027-05-06**                               |

| Risk ID | Threat ref | Description                                     | P          | I          | Accumulated | Overall    | Treatment                                     |
| ------- | ---------- | ----------------------------------------------- | ---------- | ---------- | ----------- | ---------- | --------------------------------------------- |
| R-NA-01 | T-NA-01    | Trojan installer without signature verification | MEDIUM (2) | HIGH (3)   | 6           | **MEDIUM** | Accept **AR-002**; mitigate: SHA256 manifests |
| R-NA-02 | T-NA-02    | Phishing via allowed `window.open`              | LOW (1)    | MEDIUM (2) | 2           | **LOW**    | Accept **AR-005**                             |

---

## `frontend-portal` / `frontend-docs`

| Field                     | Recorded value    |
| ------------------------- | ----------------- |
| **Highest open severity** | **LOW** (R-PO-01) |
| **Last reviewed**         | **2026-05-20**    |
| **Next review date**      | **2027-05-06**    |

| Risk ID | Threat ref | Description                                          | P       | I          | Accumulated | Overall | Treatment                                   |
| ------- | ---------- | ---------------------------------------------------- | ------- | ---------- | ----------- | ------- | ------------------------------------------- |
| R-PO-01 | T-PO-01    | Compromised CI or CDN serves malicious static assets | LOW (1) | MEDIUM (2) | 2           | **LOW** | Mitigate: signed releases, hosting controls |

---

## `mcp-proxy` / `mcp-devkit`

| Field                     | Recorded value        |
| ------------------------- | --------------------- |
| **Highest open severity** | **MEDIUM** (R-MCP-01) |
| **Last reviewed**         | **2026-05-20**        |
| **Next review date**      | **2027-05-06**        |

| Risk ID  | Threat ref | Description                                      | P          | I        | Accumulated | Overall    | Treatment                                      |
| -------- | ---------- | ------------------------------------------------ | ---------- | -------- | ----------- | ---------- | ---------------------------------------------- |
| R-MCP-01 | T-MCP-01   | MCP client drives manager APIs with stolen creds | MEDIUM (2) | HIGH (3) | 6           | **MEDIUM** | Mitigate: bind localhost, same auth as manager |
| R-MCP-02 | T-MCP-02   | Devkit misconfiguration in CI                    | LOW (1)    | LOW (1)  | 1           | **LOW**    | Avoid production deployment                    |

---

## `platform-authentication`

| Field                     | Recorded value       |
| ------------------------- | -------------------- |
| **Highest open severity** | **MEDIUM** (R-PA-01) |
| **Last reviewed**         | **2026-05-20**       |
| **Next review date**      | **2027-05-06**       |

| Risk ID | Threat ref | Description                                              | P       | I        | Accumulated | Overall    | Treatment                                         |
| ------- | ---------- | -------------------------------------------------------- | ------- | -------- | ----------- | ---------- | ------------------------------------------------- |
| R-PA-01 | T-PA-01    | Default Keycloak credentials in dev compose used in prod | LOW (1) | HIGH (3) | 3           | **MEDIUM** | Mitigate: production IdP only; document dev scope |

---

## Cross-cutting risks

| Field                     | Recorded value                |
| ------------------------- | ----------------------------- |
| **Highest open severity** | **HIGH** (R-X-01; **AR-006**) |
| **Last reviewed**         | **2026-05-20**                |
| **Next review date**      | **2027-05-06**                |

| Risk ID | Threat ref | Description                                   | P        | I            | Accumulated | Overall    | Treatment                                                               |
| ------- | ---------- | --------------------------------------------- | -------- | ------------ | ----------- | ---------- | ----------------------------------------------------------------------- |
| R-X-01  | T-X-01     | Critical CVE in dependency without vendor fix | HIGH (3) | HIGH (3)     | 9           | **HIGH**   | Accept **AR-006**; monitor SARIF/SBOM                                   |
| R-X-02  | T-X-02     | Cleartext HTTP/WSS in production              | LOW (1)  | HIGH (3)     | 3           | **MEDIUM** | Mitigate: [Production checklist](../deployment/production-checklist.md) |
| R-X-03  | T-X-03     | PostgreSQL credential leak                    | LOW (1)  | CRITICAL (4) | 4           | **MEDIUM** | Mitigate: secrets management, network isolation                         |
| R-X-04  | T-X-04     | Malicious insider uses admin APIs             | LOW (1)  | CRITICAL (4) | 4           | **MEDIUM** | Mitigate: RBAC, audit logs, least privilege                             |

---

## Risk treatment and traceability

| Overall severity | Count (open, pre-acceptance) | Notes                                                                                 |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| **CRITICAL**     | 1                            | R-AC-01 — if allowlists absent or `*`; mitigated when production hosts are restricted |
| **HIGH**         | 4                            | R-AC-03, R-AM-01, R-BM-01, R-X-01                                                     |
| **MEDIUM**       | 17                           | Includes accepted-risk areas with compensating controls                               |
| **LOW**          | 4                            | R-BC-01, R-NA-02, R-MCP-02, R-PO-01                                                   |

Accepted risks **AR-001** through **AR-006** correspond to elevated scores that remain **documented** after compensating controls; they do not remove the need for deployer diligence.

## Related documentation

- **[Threat model](./threat-model.md)**
- **[Accepted risks](./accepted-risks.md)**
- **[Compliance and standards](./compliance-and-standards.md)**
