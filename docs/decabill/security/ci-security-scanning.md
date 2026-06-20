# CI security scanning (Trivy)

The monorepo uses [Trivy](https://trivy.dev/) in GitHub Actions for automated vulnerability, secret, and misconfiguration detection on **all products including Decabill**. Defaults are defined in `trivy.yaml` at the repository root.

## What is scanned

| Scan                 | When               | Scope                                                                                                                                                      |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**       | Every pull request | Dependencies (lockfiles), secrets, IaC/misconfig in the repo                                                                                               |
| **Config**           | Every pull request | Dockerfiles, Compose, GitHub Actions, and related IaC                                                                                                      |
| **Container images** | Pull request CI    | `ghcr.io/forepath/*` images including **decabill-billing-api**, **decabill-billing-console-server**, and **decabill-docs-server** when built on the runner |

Scanners enabled for filesystem scans: **vuln**, **secret**, **misconfig**.

## Workflows

| Workflow                                    | Jobs                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.github/workflows/pull-request-checks.yml` | `trivy-filesystem`, `trivy-config`, plus image scans after each container build job |

The `.github/workflows/release.yml` workflow does **not** run Trivy vulnerability scans; pull-request scans are the CI gate before merge. Releases publish **Nx service SBOMs** and **Trivy CycloneDX container image SBOMs** to Dependency Track and the Decabill R2 bucket.

## Severity policy

| Setting           | Value                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fail pipeline** | CRITICAL                                                                                                                                                                                                |
| **Report only**   | HIGH, MEDIUM, LOW (visible in SARIF when uploaded)                                                                                                                                                      |
| **Unfixed CVEs**  | Ignored (`vulnerability.ignore-unfixed: true`) - findings without a Fixed Version do not fail the gate; see **[DR-005](./accepted-risks.md#dr-005--ci--local-trivy-unfixed-vulnerabilities-not-gated)** |

## Viewing results

1. **GitHub Security → Code scanning alerts** - when code scanning is enabled for the repository.
2. **Workflow run artifacts** - SARIF files uploaded when code scanning upload is unavailable (`trivy-sarif-*` artifacts).

SARIF categories include `trivy-fs`, `trivy-config`, and `trivy-images-*` on pull requests.

## Triage and exceptions

1. **Prefer fixing** - upgrade dependencies, base images, or configuration.
2. **Documented ignore** - open a PR that adds the CVE to `.trivyignore`, reference an **[accepted-risk](./accepted-risks.md)** entry (or document a false positive), and note a **review/expiry date** in the PR description.
3. **Do not** weaken `trivy.yaml` for one-off exceptions.

See **[Accepted risks](./accepted-risks.md)** for deliberate product-level deviations, including **[DR-005](./accepted-risks.md#dr-005--ci--local-trivy-unfixed-vulnerabilities-not-gated)**.

## Local reproduction

**Pre-commit (filesystem + config, same CRITICAL gate as CI):**

```bash
./tools/ci/trivy-pre-commit.sh
```

This runs automatically via `.husky/pre-commit` on every commit. Install [Trivy](https://trivy.dev/latest/docs/installation/) before your first commit on a machine.

**Manual full scans:**

```bash
trivy fs . --config trivy.yaml --quiet
trivy config . --config trivy.yaml --quiet
trivy image ghcr.io/forepath/decabill-billing-api:latest --config trivy.yaml --quiet
```

After building Decabill images locally:

```bash
./tools/ci/trivy-scan-local-images.sh
./tools/ci/trivy-generate-image-sboms.sh
```

| Scan type               | Pre-commit | Pull request CI |
| ----------------------- | ---------- | --------------- |
| Filesystem (`trivy fs`) | Yes        | Yes             |
| Config (`trivy config`) | Yes        | Yes             |
| Container images        | No         | Yes (per build) |

## Relationship to SBOM and Dependency Track

- **Service CycloneDX SBOMs** are generated by Nx (`sbom` target) for Decabill projects (`decabill-*.cdx.json`).
- **Container image CycloneDX SBOMs** are generated by Trivy (`container-decabill-*.cdx.json`).
- **Pull requests** upload SBOM files as the `sbom-artifacts` artifact.
- **Releases** publish to Dependency Track and copy files under `dist/sboms/` to the **Decabill R2 bucket** - see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom)**.
- **Trivy** vulnerability scans (PR) provide the **CI gate**; SBOM generation uses Trivy CycloneDX output separately from SARIF scans.

## Related documentation

- **[Security overview](./README.md)**
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**
- **[Container image security](./container-images.md)** - Decabill image names and hardening
