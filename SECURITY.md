# Security Policy

## Supported Versions

We provide security updates for the following versions of this framework:

| Version             | Supported |
| ------------------- | --------- |
| 2.x.x               | Yes       |
| 1.x.x               | No        |
| 0.x.x               | No        |
| Earlier major lines | No        |

Security updates are intended for supported **2.x.x** releases. Full disclosure and CRA-oriented context: **[Supported versions and security updates](./docs/agenstra/security/vulnerability-reporting-and-artifacts.md#supported-versions-and-security-updates)**.

## Reporting a Vulnerability

We take security seriously and appreciate your help in keeping this framework and its users safe.

### How to Report Security Issues

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities to our security team:

- **Email**: soc@forepath.io
- **Subject**: `[SECURITY] Framework Vulnerability Report`
- **Response Time**: We aim to respond within 48 hours

### What to Include in Your Report

When reporting a security vulnerability, please include:

1. **Description** - Clear description of the vulnerability
2. **Impact** - Potential impact and severity assessment
3. **Steps to Reproduce** - Detailed steps to reproduce the issue
4. **Affected Versions** - Which versions of this framework are affected
5. **Suggested Fix** - If you have ideas for how to fix the issue
6. **Contact Information** - How we can reach you for follow-up

### Vulnerability Assessment Process

1. **Initial Response** - We'll acknowledge receipt within 48 hours
2. **Assessment** - Our security team will assess the vulnerability
3. **Investigation** - We'll investigate and validate the issue
4. **Fix Development** - We'll develop and test a fix
5. **Coordination** - We'll coordinate disclosure with you
6. **Release** - We'll release the fix and security advisory

### Recognition

We believe in recognizing security researchers who help keep this framework secure:

- **Hall of Fame** - Security researchers will be recognized in our security acknowledgments
- **Responsible Disclosure** - We follow responsible disclosure practices
- **Collaboration** - We work with researchers to ensure proper fixes

## Security Best Practices

### For Developers

- **Keep Dependencies Updated** - Regularly update all dependencies
- **Follow Security Guidelines** - Adhere to the project’s code quality and security practices
- **Use Secure Coding Practices** - Follow secure coding principles
- **Regular Security Audits** - Perform regular security audits of your code

### For Organizations

- **Security Training** - Ensure your team is trained on security best practices
- **Regular Updates** - Keep this framework and all dependencies up to date
- **Security Monitoring** - Implement security monitoring and alerting
- **Incident Response** - Have an incident response plan in place

## Security Features

This framework includes several built-in security features:

### Built-in Security

- **Dependency Scanning** - Automated vulnerability scanning in CI/CD ([Trivy](https://trivy.dev/) on pull requests; see [CI security scanning](./docs/agenstra/security/ci-security-scanning.md))
- **Security Headers** - Default security headers for web applications
- **Input Validation** - Built-in input validation and sanitization
- **Authentication Patterns** - Secure authentication and authorization patterns

### Security Tools Integration

- **Trivy** - Repository, IaC/config, secret, and container image scanning in CI ([`trivy.yaml`](./trivy.yaml); CRITICAL fail gate; SARIF to GitHub Security when enabled)
- **npm audit** - Integrated dependency vulnerability scanning
- **ESLint Security Rules** - Security-focused linting rules
- **Pre-commit Hooks** - Format, lint, test, build, and **Trivy** filesystem/config scans ([`tools/ci/trivy-pre-commit.sh`](./tools/ci/trivy-pre-commit.sh); requires Trivy on `PATH`)
- **CI/CD Security Gates** - Automated security validation in pull request checks (Trivy); release workflow publishes SBOMs without re-scanning

## Documented security deviations (accepted risks)

The product intentionally departs from stricter baselines in a few places. Each item below is **accepted** with compensating measures and a **review cadence**. Expanded register entries (BSI / ISMS-style fields, operator summaries, and withdrawal paths) live in **[docs/agenstra/security/accepted-risks.md](./docs/agenstra/security/accepted-risks.md)**. Additional threat context and backlog items may appear in [`thread-analysis.md`](./thread-analysis.md) (internal analysis note).

| ID         | Area                                                                                                                                             | What we accept                                                                                                                                                                                                                                                                                                                                     | Mitigations (short)                                                                                                                                                                                                                                                                                                                                                 | Next review                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **AR-001** | **Provisioning SSH** (cloud-init templates)                                                                                                      | **`PermitRootLogin yes`** and **root** `authorized_keys` installed via provisioning scripts (`libs/domains/agenstra/backend/feature-billing-manager/.../agent-controller.utils.ts`, `agent-manager.utils.ts`)                                                                                                                                      | SSH **key-based** access; **password authentication disabled** in generated `sshd` config; deployers should restrict network access, rotate keys, and monitor instances                                                                                                                                                                                             | **2027-05-06**, or sooner if cloud-init/SSH templates change materially                |
| **AR-002** | **Desktop app** (`agenstra-native-agent-console`)                                                                                                | **No OS-trusted code signing** and **no in-app auto-update** in the Electron Forge pipeline (`apps/agenstra/native-agent-console/forge.config.js`)                                                                                                                                                                                                 | Release artifacts include **`SHA256SUMS`** and **`integrity-manifest.json`** produced by [`tools/release-integrity`](./tools/release-integrity/README.md); CI/release pipelines **generate and verify** these manifests. Users should verify checksums after download. The web browser remains the primary client; the native build is a secondary channel.         | **2027-05-06**, or sooner if desktop becomes the primary distribution path             |
| **AR-003** | **Web frontends** (`frontend-*`)                                                                                                                 | **Content Security Policy** allows **`'unsafe-inline'`** and **`'unsafe-eval'`** so **Monaco Editor** and related tooling work; policy is sent as **`Content-Security-Policy-Report-Only`** by default (violations are reported, not blocked)                                                                                                      | Set **`CSP_ENFORCE=true`** only in environments where compatibility is validated. Implementation: `libs/domains/shared/frontend/util-express-server/src/lib/security-headers.ts`. Hardening path: stricter CSP with a validated Monaco/worker/nonce strategy.                                                                                                       | **2027-05-06**, or sooner if CSP middleware changes materially                         |
| **AR-004** | **Backend authentication mode resolution** (`getAuthenticationMethod` in `libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts`) | We do **not** require **`AUTHENTICATION_METHOD`** to always be set. When it is unset: if **`STATIC_API_KEY`** is set → **api-key** mode; otherwise → **keycloak** (OIDC / **Keycloak** integration with the deployer’s IdP). **Protected routes are not anonymous**—Keycloak- or users-mode guards still enforce authentication per configuration. | **Default `keycloak`** favors the most integrated, enterprise-typical option (customer IdP). For **api-key** or **users** deployments, set **`AUTHENTICATION_METHOD`** explicitly and treat **`STATIC_API_KEY`** as a high-value secret (rotation, least exposure).                                                                                                 | **2027-05-06**, or sooner if hybrid auth resolution changes materially                 |
| **AR-005** | **Desktop window open policy** (`agenstra-native-agent-console`)                                                                                 | **`setWindowOpenHandler`** in `apps/agenstra/native-agent-console/src/main.ts` uses **`action: 'allow'`** so `window.open` / `target=_blank` can open new Electron windows with inherited `webPreferences`.                                                                                                                                        | Compared with a full browser, phishing and popup abuse risk is **lower**: there is **no address bar (omnibox)** and **users cannot install browser extensions/plugins**. **Sandbox** and **contextIsolation** remain enabled. Revisit if the shell gains untrusted browsing or URL-entry UX.                                                                        | **2027-05-06**, or sooner if main-process window policy changes materially             |
| **AR-006** | **Trivy vulnerability gate** ([`trivy.yaml`](./trivy.yaml))                                                                                      | **Unfixed CVEs do not fail** CI or local Trivy hooks (`vulnerability.ignore-unfixed: true`). Only **CRITICAL** findings **with a published Fixed Version** fail the gate.                                                                                                                                                                          | SARIF and workflow artifacts still surface unfixed issues for review; SBOMs and Dependency Track on release add visibility. Use [`.trivyignore`](./.trivyignore) for fixable CVEs that cannot be applied yet—not to waive unfixed findings. See **[AR-006](./docs/agenstra/security/accepted-risks.md#ar-006--ci--local-trivy-unfixed-vulnerabilities-not-gated)**. | **2027-05-06**, or sooner if `trivy.yaml` severity or ignore policy changes materially |

**Hardening paths (if an acceptance is withdrawn):**

- **AR-001**: Prefer a non-root admin user, **`PermitRootLogin no`**, least-privilege `sudo`, and cloud-init-native `ssh_authorized_keys` where possible; reduce secrets in user-data.
- **AR-002**: Add OS-trusted signing and/or Electron auto-update when native distribution requirements justify the operational cost.
- **AR-003**: Tighten CSP after automated and manual verification so core UI (including Monaco) still functions.
- **AR-004**: Require **`AUTHENTICATION_METHOD`** in all environments if auditors or policy demand fully explicit configuration, or add startup validation that fails when **`STATIC_API_KEY`** is set without an explicit mode.
- **AR-005**: Tighten **`setWindowOpenHandler`** (e.g. URL allowlist or **`action: 'deny'`**) if the product starts loading untrusted origins or adds browser-like navigation.
- **AR-006**: Fail on unfixed CRITICAL (and optionally HIGH) findings if auditors require zero tolerance regardless of vendor fix availability.

## Security Resources

## Software Bill of Materials (SBOM)

We publish CycloneDX SBOM files for each release (Nx service SBOMs and Trivy container image SBOMs).

- **Path**: `releases/<version>/sboms/`
- **Example**: `releases/2.0.0/sboms/`
- **How to find your version**: Check the release version in [Downloads](https://downloads.agenstra.com/), then replace `<version>` in the path above.

Details: **[Software Bill of Materials (SBOM)](./docs/agenstra/security/vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom)**.

### Documentation

- [Project overview and docs](./docs/agenstra/README.md) - Architecture, deployment, and setup
- [Security documentation](./docs/agenstra/security/README.md) - CRA- and BSI-oriented transparency, accepted-risk register, hardening, SBOM, disclosure, and CI scanning (Trivy)

### External Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) - Common security risks
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework) - Cybersecurity best practices
- [GitHub Security Advisories](https://github.com/advisories) - Security vulnerability database

## Incident Response

### If You Discover a Security Issue

1. **Do NOT** create a public issue or discussion
2. **Do NOT** share details on social media or public forums
3. **Do** email soc@forepath.io immediately
4. **Do** provide as much detail as possible
5. **Do** allow us time to investigate and fix the issue

### Our Response Commitment

- **48-hour acknowledgment** of security reports
- **Regular updates** on investigation progress
- **Coordinated disclosure** with security researchers
- **Timely fixes** for confirmed vulnerabilities
- **Public acknowledgment** of security researchers

## Contact Information

### Security Team

- **Security Issues**: soc@forepath.io
- **General Questions**: hi@forepath.io
- **Emergency Contact**: Available 24/7 for critical security issues

### Response Times

- **Critical Issues**: 24 hours
- **High Priority**: 48 hours
- **Medium Priority**: 1 week
- **Low Priority**: 2 weeks

## Thank You

Thank you for helping keep this framework and its users secure. Your responsible disclosure helps us maintain the highest security standards and protects the entire community.

---

**Remember**: Security is everyone's responsibility. Together, we can build and maintain secure software that protects users and their data.

_Last updated: May 2026_
