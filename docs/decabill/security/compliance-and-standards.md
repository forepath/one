# Compliance and standards (EU CRA and BSI IT-Grundschutz)

This page explains what **EU Cyber Resilience Act (CRA)** and **BSI IT-Grundschutz** frameworks typically expect in terms of **documented** cybersecurity evidence, and how **Decabill** public documentation is intended to support **transparency** and **operator due diligence**. It is **informative**, not legal advice. Conformity, CE marking, organizational certification, and audit scope must be confirmed with qualified advisors for your role (manufacturer, importer, deployer, or integrator) and jurisdiction.

## EU Cyber Resilience Act (CRA)

**Legal act:** [Regulation (EU) 2024/2847](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R2847) (CRA). Official summary and FAQs: [Cyber Resilience Act](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act) (European Commission).

### Scope and open source (high level)

The CRA applies to **products with digital elements** when they are **made available on the Union market** in the course of a **commercial activity**. Whether Decabill or a particular derivative counts as in scope for you depends on **your** distribution model, not on this documentation alone.

### Documentation and transparency obligations (themes)

| Theme                                   | What the regulation generally expects                                                                               | Role of Decabill documentation                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk assessment**                     | Identify and assess cybersecurity risks in light of intended and reasonably foreseeable use.                        | **[Operational hardening](./operational-hardening.md)** and **[Architecture](../architecture/README.md)** describe trust boundaries and controls. **[Accepted risks](./accepted-risks.md)** records deliberate residual risk and compensating measures.                                                   |
| **Technical documentation**             | Document the risk assessment and means chosen to meet **essential cybersecurity requirements** (Annex I).           | This security section, deployment and environment docs, and the risk register form the **public** technical narrative. Build pipelines and internal records may hold additional evidence.                                                                                                                 |
| **Secure by design and default**        | Implement Annex I requirements (hardening, confidentiality and integrity of data, limited attack surface).          | **[Operational hardening](./operational-hardening.md)**, **[Container image security](./container-images.md)**, **[Production checklist](../deployment/production-checklist.md)**, and **[Environment configuration](../deployment/environment-configuration.md)** describe production-oriented controls. |
| **Vulnerability handling**              | Establish processes to identify and remediate vulnerabilities **without undue delay**; supply **security updates**. | **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** describes coordinated disclosure, supported versions, and response commitments.                                                                                                                                   |
| **Information for the user (Annex II)** | Provide instructions so users can **install, operate, and maintain** the product securely.                          | **[Getting Started](../getting-started.md)**, **[Deployment](../deployment/README.md)**, **[Environment configuration](../deployment/environment-configuration.md)**, and **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** support operator understanding.         |
| **Conformity assessment**               | Complete applicable **conformity assessment** before placing on the market when in scope.                           | Not asserted here. Deployers integrate Decabill into their own systems; **your** conformity strategy may combine this product with infrastructure and services.                                                                                                                                           |

### Application timeline (CRA)

The CRA **entered into force** on 10 December 2024. **Full application** of many operational provisions is **11 December 2027**. Refer to the Official Journal text and Commission guidance for dates that matter to your role.

## BSI IT-Grundschutz

**Context:** [IT-Grundschutz](https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/it-grundschutz_node.html) (German Federal Office for Information Security, BSI) provides a structured method for **information security management** in organizations. **Decabill documentation does not replace** an organizational **security concept** or **IT-Grundschutz audit** for your enterprise.

### Documentation expectations (themes)

| Theme                                   | Typical expectation                                                               | How Decabill documentation supports it                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security concept and scope**          | Describe the target of protection, boundaries, and roles.                         | **[System overview](../architecture/system-overview.md)** and **[Architecture](../architecture/README.md)**.                                                                  |
| **Protection needs and risk treatment** | Classify protection needs; treat risks with rationale and owners.                 | **[Accepted risks](./accepted-risks.md)** gives **explicit acceptance**, **owners**, **dates**, **review cadence**, and **compensating controls**.                            |
| **Requirement fulfillment**             | Record fulfillment and justify deviations.                                        | Accepted-risk entries document **deviations** with **mitigations** and **review** dates. **[Operational hardening](./operational-hardening.md)** states implemented controls. |
| **Operational measures**                | Logging, configuration management, incident handling, and supplier relationships. | **[Operational hardening](./operational-hardening.md)**, **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**, deployment guides.          |

Formal IT-Grundschutz certification requires **organizational** processes; this English **open** documentation is aimed at **global** transparency and **supplier** due diligence.

## Trust boundaries (summary)

1. **Browser** to **Express frontend** (billing console or docs) to **billing manager API** (`/api`).
2. **Browser** to **billing WebSocket** (`/billing` namespace) for dashboard status (interactive auth only; API key clients do not receive dashboard streams).
3. **Billing manager** to **Stripe** for payments and webhooks.
4. **Billing manager** to **cloud provider APIs** (Hetzner, DigitalOcean) and **SSH** for provisioning (see **DR-001** in **[Accepted risks](./accepted-risks.md)**).
5. **Worker processes** to **Redis**, **Postgres**, **SMTP**, and external APIs during background jobs.

Detail: **[Container image security](./container-images.md)**, **[Operational hardening](./operational-hardening.md)**.

## Related documentation

- **[Accepted risks](./accepted-risks.md)**
- **[Operational hardening](./operational-hardening.md)**
- **[Container image security](./container-images.md)**
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**
- **[Environment configuration](../deployment/environment-configuration.md)**

---

_For regulatory interpretation and conformity decisions, consult qualified legal and compliance advisors._
