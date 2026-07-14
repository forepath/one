# Security documentation

This section collects **security, compliance-oriented transparency, and hardening** information for Decabill: mapping to **EU Cyber Resilience Act (CRA)** and **BSI IT-Grundschutz** documentation themes, a formal **accepted-risk register**, **vulnerability reporting**, **SBOM** artifacts, and pointers to **environment variables** for production.

For disclosure, supported versions, SBOM paths, and response-time commitments, see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**. **There is no official bug bounty program**; discretionary rewards may apply only to valid, manually verified reports. A concise risk summary table is in **[Accepted risks](./accepted-risks.md)**.

## Overview

Decabill spans browsers, a NestJS billing API, Express SSR frontends (billing console and docs), Redis-backed background jobs, and optional cloud provisioning for bundled product stacks. Security is enforced through authentication modes, tenant guards, sanitized logging, content security policy choices, **hardened container images** (non-root users, no default secrets in images), Stripe webhook verification, and **documented** residual risks where product or deployment constraints apply.

## Documentation structure

### [Compliance and standards](./compliance-and-standards.md)

How public documentation relates to **CRA** (Regulation (EU) 2024/2847) and **BSI IT-Grundschutz** / typical **ISMS** practice: expected artifacts, transparency goals, and a high-level product mapping. **Informative only**; conformity and certification require your own legal and audit advisors.

### [Accepted risks (register)](./accepted-risks.md)

Register **DR-001** through **DR-005**: provisioning SSH posture, billing multi-tenant API key scope, frontend CSP, backend authentication method resolution, and Trivy unfixed-CVE gating. Includes acceptance dates, review cadence, mitigations, and withdrawal paths.

### [Container image security](./container-images.md)

Runtime users (`agenstra` / `node`) for `decabill-billing-api`, `decabill-billing-console-server`, and `decabill-docs-server`.

### [Operational hardening](./operational-hardening.md)

Implemented controls: container image hardening, correlation IDs and access logs, tenant guard, runtime `/config` proxy behavior, CSP and `CSP_ENFORCE`, WebSocket CORS, and authentication resolution behavior.

### [Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)

Responsible disclosure (**no bug bounty**), CycloneDX **SBOM** location on Decabill R2 (`decabill-*.cdx.json`), and downloads at **downloads.decabill.com**.

### [CI security scanning (Trivy)](./ci-security-scanning.md)

Automated **Trivy** scans on pull requests; CRITICAL fail gate (fixable issues only; see **[DR-005](./accepted-risks.md#dr-005--ci--local-trivy-unfixed-vulnerabilities-not-gated)**).

## Configuration reference

For variable-by-variable deployment settings, including **`CONFIG_*`**, **`CSP_ENFORCE`**, **`TENANTS`**, **`TENANTS_ALLOW_DEFAULT`**, **`STATIC_API_KEY_TENANT_ID`**, and Stripe variables, see **[Environment configuration](../deployment/environment-configuration.md)** and **[Production checklist](../deployment/production-checklist.md)**.

## Related documentation

- **[Deployment](../deployment/README.md)** - Docker and production guides
- **[Architecture](../architecture/README.md)** - Trust boundaries and components
- **[Features](../features/README.md)** - Product capabilities including multi-tenancy and payments

---

_This folder is maintained for public transparency. Regulatory applicability of the CRA and national schemes depends on how the software is supplied and used; see [Compliance and standards](./compliance-and-standards.md)._
