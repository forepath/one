# CI security scanning (Trivy)

Agenstra uses [Trivy](https://trivy.dev/) in GitHub Actions for automated vulnerability, secret, and misconfiguration detection. Defaults are defined in [`trivy.yaml`](../../../trivy.yaml) at the repository root.

## What is scanned

| Scan                 | When               | Scope                                                                                |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| **Filesystem**       | Every pull request | Dependencies (lockfiles), secrets, IaC/misconfig in the repo                         |
| **Config**           | Every pull request | Dockerfiles, Compose, GitHub Actions, and related IaC                                |
| **Container images** | Pull request CI    | `ghcr.io/forepath/*` and `registry.forenet.internal/forepath/*` images on the runner |

Scanners enabled for filesystem scans: **vuln**, **secret**, **misconfig**.

## Workflows

| Workflow                                                                                          | Jobs                                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`.github/workflows/pull-request-checks.yml`](../../../.github/workflows/pull-request-checks.yml) | `trivy-filesystem`, `trivy-config`, plus image scans after each container build job |

The [release workflow](../../../.github/workflows/release.yml) does **not** run Trivy vulnerability scans; pull-request scans are the CI gate before merge. Releases publish **Nx service SBOMs** and **Trivy CycloneDX container image SBOMs** (when images are built) to Dependency Track and R2.

## Severity policy

| Setting           | Value                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fail pipeline** | CRITICAL                                                                                                                                                                                                |
| **Report only**   | HIGH, MEDIUM, LOW (visible in SARIF when uploaded)                                                                                                                                                      |
| **Unfixed CVEs**  | Ignored (`vulnerability.ignore-unfixed: true`) — findings without a Fixed Version do not fail the gate; see **[AR-006](./accepted-risks.md#ar-006--ci--local-trivy-unfixed-vulnerabilities-not-gated)** |

## Viewing results

1. **GitHub Security → Code scanning alerts** — when [code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning) is enabled for the repository.
2. **Workflow run artifacts** — SARIF files uploaded when code scanning upload is unavailable (`trivy-sarif-*` artifacts).

SARIF categories include `trivy-fs`, `trivy-config`, and `trivy-images-*` on pull requests.

## Triage and exceptions

1. **Prefer fixing** — upgrade dependencies, base images, or configuration.
2. **Documented ignore** — open a PR that adds the CVE to [`.trivyignore`](../../../.trivyignore), reference an **[accepted-risk](./accepted-risks.md)** entry (or document a false positive), and note a **review/expiry date** in the PR description.
3. **Do not** weaken [`trivy.yaml`](../../../trivy.yaml) for one-off exceptions.

See **[Accepted risks](./accepted-risks.md)** for deliberate product-level deviations (separate from CVE ignores), including **[AR-006](./accepted-risks.md#ar-006--ci--local-trivy-unfixed-vulnerabilities-not-gated)** (unfixed vulnerabilities are not pipeline blockers).

## Local reproduction

**Pre-commit (filesystem + config, same CRITICAL gate as CI):**

```bash
./tools/ci/trivy-pre-commit.sh
```

This runs automatically via [`.husky/pre-commit`](../../../.husky/pre-commit) on every commit. Install [Trivy](https://trivy.dev/latest/docs/installation/) before your first commit on a machine; commits fail if `trivy` is not on `PATH`. To skip all Husky hooks for one commit (use sparingly): `git commit --no-verify`.

**Manual full scans:**

```bash
trivy fs . --config trivy.yaml --quiet
trivy config . --config trivy.yaml --quiet
trivy image ghcr.io/forepath/agenstra-manager-api:latest --config trivy.yaml --quiet
```

After building images locally:

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

- **Service CycloneDX SBOMs** are generated by Nx (`sbom` target).
- **Container image CycloneDX SBOMs** are generated by Trivy after image builds (`tools/ci/trivy-generate-image-sboms.sh`).
- **Pull requests** upload service and container SBOM files as the `sbom-artifacts` artifact (separate CycloneDX files per project/image when built).
- **Releases** publish service SBOMs and each container image SBOM separately to Dependency Track (`forepath/gh-upload-sbom@v2`) and copy all files under `dist/sboms/` to R2 — see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom)**.
- **Trivy** vulnerability scans (PR) provide the **CI gate** and GitHub Security visibility; SBOM generation uses Trivy’s CycloneDX output separately from SARIF scans.

## Related documentation

- [`SECURITY.md`](../../../SECURITY.md)
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**
