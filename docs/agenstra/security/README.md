# Security documentation

This section collects **security, compliance-oriented transparency, and hardening** information for Agenstra: mapping to **EU Cyber Resilience Act (CRA)** and **BSI IT-Grundschutz** documentation themes, a formal **accepted-risk register**, **vulnerability reporting**, **SBOM** and **desktop integrity** artifacts, and pointers to **environment variables** for production.

For disclosure, supported versions, SBOM paths, and response-time commitments, see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**. A concise risk summary table is in **[Accepted risks](./accepted-risks.md)**. The same reporting policy is also published at the repository root as the file `SECURITY.md` (for example on GitHub’s Security tab).

## Overview

Agenstra spans browsers, multiple NestJS backends, Express frontends, optional Electron distribution, and customer-controlled remote endpoints. Security is enforced through authentication modes, SSRF guardrails, sanitized logging, content security policy choices, **hardened container images** (non-root users, no default secrets in images, least-privilege Docker socket access), and **documented** residual risks where product or deployment constraints apply.

## Documentation structure

### [Compliance and standards](./compliance-and-standards.md)

How public documentation relates to **CRA** (Regulation (EU) 2024/2847) and **BSI IT-Grundschutz** / typical **ISMS** practice: expected artifacts, transparency goals, and a high-level product mapping. **Informative only**; conformity and certification require your own legal and audit advisors.

### [Accepted risks (register)](./accepted-risks.md)

Register **AR-001** through **AR-007**: provisioning SSH posture, native desktop signing and update posture, frontend CSP, backend authentication method resolution, Electron window-open policy, Trivy unfixed-CVE gating, and billing multi-tenant API key scope. Includes acceptance dates, review cadence, mitigations, and withdrawal paths.

### [Container image security](./container-images.md)

Runtime users (`agenstra` / `node`), agent bind mounts under `/opt/agents`, entrypoint layout, and **restricted passwordless `sudo`** (no membership in the `sudo` group).

### [Operational hardening](./operational-hardening.md)

Implemented controls: **container image hardening**, correlation IDs and access logs, client endpoint allowlists and DNS checks, runtime `/config` proxy behavior, HTTP proxy header stripping, CSP and `CSP_ENFORCE`, WebSocket CORS, and authentication resolution behavior.

### [Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)

Responsible disclosure (contact and process), CycloneDX **SBOM** location, and **desktop release integrity** (`SHA256SUMS`, `integrity-manifest.json`).

### [CI security scanning (Trivy)](./ci-security-scanning.md)

Automated **Trivy** scans on pull requests (filesystem, IaC/config, container images); SARIF upload to GitHub Security; CRITICAL fail gate (fixable issues only — see **[AR-006](./accepted-risks.md#ar-006--ci--local-trivy-unfixed-vulnerabilities-not-gated)**). Pre-commit runs filesystem/config scans locally.

## Configuration reference

For variable-by-variable deployment settings, including **`CLIENT_ENDPOINT_*`**, **`CONFIG_*`**, **`CSP_ENFORCE`**, and authentication variables, see **[Environment configuration](../deployment/environment-configuration.md)** and **[Production checklist](../deployment/production-checklist.md)**.

## Related documentation

- **[Architecture](../architecture/README.md)** — Trust boundaries and component roles
- **[Authentication feature](../features/authentication.md)** — User-facing authentication flows
- **[Deployment](../deployment/README.md)** — Docker and production guides

---

_This folder is maintained for public transparency. Regulatory applicability of the CRA and national schemes depends on how the software is supplied and used; see [Compliance and standards](./compliance-and-standards.md)._
