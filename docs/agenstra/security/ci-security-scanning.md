# CI security scanning (Trivy)

Agenstra uses [Trivy](https://trivy.dev/) in GitHub Actions for automated vulnerability, secret, and misconfiguration detection. Defaults are defined in `trivy.yaml` at the repository root.

## What is scanned

| Scan                 | When               | Scope                                                                                |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| **Filesystem**       | Every pull request | Dependencies (lockfiles), secrets, IaC/misconfig in the repo                         |
| **Config**           | Every pull request | Dockerfiles, Compose, GitHub Actions, and related IaC                                |
| **Container images** | Pull request CI    | `ghcr.io/forepath/*` and `registry.forenet.internal/forepath/*` images on the runner |

Scanners enabled for filesystem scans: **vuln**, **secret**, **misconfig**.

**Images with a nested root filesystem.** The microVM worker image (`agenstra-manager-worker-microvm`) carries the guest's complete root below `/guest`. Trivy only reads the package databases of an image's own root, so it would miss every Debian package of the guest and report files those packages own (for example Debian's `python3-certifi`) as stand-alone language packages. Images declare such a directory with the `io.forepath.scan.nested-rootfs` label (here `/guest`). `tools/ci/trivy-scan-local-images.sh` then scans the image without that directory and the extracted directory on its own with `trivy rootfs`, both under the same CRITICAL gate. `tools/ci/trivy-generate-image-sboms.sh` writes a separate SBOM for it (`container-agenstra-manager-worker-microvm-guest.cdx.json`, its own Dependency-Track project). The helpers live in `tools/ci/trivy-nested-rootfs.sh`. The worker image is built `FROM` the shared microVM launcher (`microvm-launcher`, `apps/shared/microvm-launcher`), which the worker job builds, smoke-tests and scans first (release: multi-arch push, then the runner's variant is pulled for its SBOM, `container-microvm-launcher.cdx.json`). The launcher itself has no nested root: its `guest-tools/` are copies of its own Debian `nodejs` / libc files (and static `tini`, `busybox`, `lw-pty`), so the image scan covers them; the images Loadweaver runs as generic microVMs are scanned on their own by the cluster.

## Workflows

| Workflow                                    | Jobs                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.github/workflows/pull-request-checks.yml` | `trivy-filesystem`, `trivy-config`, plus image scans after each container build job |

The `.github/workflows/release.yml` workflow does **not** run Trivy vulnerability scans; pull-request scans are the CI gate before merge. Releases publish **Nx service SBOMs** and **Trivy CycloneDX container image SBOMs** (when images are built) to Dependency Track and R2.

## Severity policy

| Setting           | Value                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fail pipeline** | CRITICAL                                                                                                                                                                                             |
| **Report only**   | HIGH, MEDIUM, LOW (visible in SARIF when uploaded)                                                                                                                                                   |
| **Unfixed CVEs**  | Ignored (`vulnerability.ignore-unfixed: true`). Findings without a Fixed Version do not fail the gate. See **[AR-005](./accepted-risks.md#ar-005-ci-local-trivy-unfixed-vulnerabilities-not-gated)** |

## Viewing results

1. **GitHub Security → Code scanning alerts** when [code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning) is enabled for the repository.
2. **Workflow run artifacts** SARIF files uploaded when code scanning upload is unavailable (`trivy-sarif-*` artifacts).

SARIF categories include `trivy-fs`, `trivy-config`, and `trivy-images-*` on pull requests.

## Triage and exceptions

1. **Prefer fixing** upgrade dependencies, base images, or configuration.
2. **Documented ignore** open a PR that adds the CVE to `.trivyignore`, reference an **[accepted-risk](./accepted-risks.md)** entry (or document a false positive), and note a **review/expiry date** in the PR description.
3. **Do not** weaken `trivy.yaml` for one-off exceptions.

See **[Accepted risks](./accepted-risks.md)** for deliberate product-level deviations (separate from CVE ignores), including **[AR-005](./accepted-risks.md#ar-005-ci-local-trivy-unfixed-vulnerabilities-not-gated)** (unfixed vulnerabilities are not pipeline blockers).

## Local reproduction

**Pre-commit (filesystem + config, same CRITICAL gate as CI):**

```bash
./tools/ci/trivy-pre-commit.sh
```

This runs automatically via `.husky/pre-commit` on every commit. Install [Trivy](https://trivy.dev/latest/docs/installation/) before your first commit on a machine; commits fail if `trivy` is not on `PATH`. To skip all Husky hooks for one commit (use sparingly): `git commit --no-verify`.

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
- **Releases** publish service SBOMs and each container image SBOM separately to Dependency Track (`forepath/gh-upload-sbom@v2`) and copy all files under `dist/sboms/` to R2, see **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md#software-bill-of-materials-sbom)**.
- **Trivy** vulnerability scans (PR) provide the **CI gate** and GitHub Security visibility; SBOM generation uses Trivy’s CycloneDX output separately from SARIF scans.

## Related documentation

- **[Security overview](./README.md)** Security documentation index
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** Disclosure process and SBOM paths
