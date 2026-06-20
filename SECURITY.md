# Security Policy

This policy applies to the **ForePath One** monorepo, which contains multiple products. Product-specific security documentation lives in each product docs tree. Use the links in **Security Resources** below for detailed registers, SBOM paths, and hardening notes.

## Supported Versions

We provide security updates for the following versions of this framework:

| Version             | Supported |
| ------------------- | --------- |
| 2.x.x               | Yes       |
| 1.x.x               | No        |
| 0.x.x               | No        |
| Earlier major lines | No        |

Security updates are intended for supported **2.x.x** releases. Full disclosure and CRA-oriented context:

- **Agenstra:** [Supported versions and security updates](./docs/agenstra/security/vulnerability-reporting-and-artifacts.md#supported-versions-and-security-updates)
- **Decabill:** [Supported versions and security updates](./docs/decabill/security/vulnerability-reporting-and-artifacts.md#supported-versions-and-security-updates)

## Reporting a Vulnerability

We take security seriously and appreciate your help in keeping this framework and its users safe.

### How to Report Security Issues

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities to our security team:

- **Email**: soc@forepath.io
- **Subject**: `[SECURITY] Framework Vulnerability Report` (you may add the product name, for example `Agenstra` or `Decabill`, in the body)
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
- **Follow Security Guidelines** - Adhere to the project's code quality and security practices
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

The products intentionally depart from stricter baselines in a few places. Each item below is **accepted** with compensating measures and a **review cadence**. Expanded register entries live in the product security docs linked below.

### Agenstra (register AR-001 through AR-005)

Full register: **[docs/agenstra/security/accepted-risks.md](./docs/agenstra/security/accepted-risks.md)**

| ID         | Area                       | Summary                                                                     |
| ---------- | -------------------------- | --------------------------------------------------------------------------- |
| **AR-001** | Desktop app                | No OS-trusted code signing; no in-app auto-update (checksum manifests)      |
| **AR-002** | Web frontends              | CSP allows `unsafe-inline` / `unsafe-eval` for Monaco (report-only default) |
| **AR-003** | Backend auth resolution    | `AUTHENTICATION_METHOD` optional; implicit keycloak when no API key set     |
| **AR-004** | Desktop window open policy | Electron `setWindowOpenHandler` allows new windows                          |
| **AR-005** | Trivy gate                 | Unfixed CVEs do not fail CI (`ignore-unfixed: true`)                        |

### Decabill (register DR-001 through DR-005)

Full register: **[docs/decabill/security/accepted-risks.md](./docs/decabill/security/accepted-risks.md)**

| ID         | Area                         | Summary                                                             |
| ---------- | ---------------------------- | ------------------------------------------------------------------- |
| **DR-001** | Provisioning SSH             | Cloud-init may enable root SSH with authorized_keys                 |
| **DR-002** | Billing multi-tenant API key | Shared `STATIC_API_KEY` can access all tenants when tenant id unset |
| **DR-003** | Web frontends                | CSP allows `unsafe-inline` / `unsafe-eval` (report-only default)    |
| **DR-004** | Backend auth resolution      | Same implicit auth mode resolution as shared identity stack         |
| **DR-005** | Trivy gate                   | Unfixed CVEs do not fail CI (monorepo-wide `trivy.yaml`)            |

## Security Resources

## Software Bill of Materials (SBOM)

We publish CycloneDX SBOM files for each release (Nx service SBOMs and Trivy container image SBOMs). Each product publishes to its own object-store bucket under the same key layout.

- **Path**: `releases/<version>/sboms/`
- **Example**: `releases/2.0.0/sboms/`

| Product  | Downloads                                                 | SBOM documentation                                                                                                 |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Agenstra | [downloads.agenstra.com](https://downloads.agenstra.com/) | [Agenstra SBOM](./docs/agenstra/security/vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom) |
| Decabill | [downloads.decabill.com](https://downloads.decabill.com/) | [Decabill SBOM](./docs/decabill/security/vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom) |

### Documentation

- [Agenstra documentation](./docs/agenstra/README.md) - Architecture, deployment, and setup
- [Agenstra security documentation](./docs/agenstra/security/README.md) - CRA/BSI transparency, accepted risks, hardening, SBOM, disclosure, CI scanning
- [Decabill documentation](./docs/decabill/README.md) - Billing product guides
- [Decabill security documentation](./docs/decabill/security/README.md) - Decabill accepted risks, SBOM, and hardening

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

_Last updated: June 2026_
