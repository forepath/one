# Image Policies

An image policy decides which images may run: signed with one of your keys, free of vulnerabilities of given severities, or both. Images are checked by their pinned digest, when you plan and again on the node that pulls them.

```yaml
apiVersion: loadweaver.com/v1
kind: ImagePolicy
metadata: { name: production, project: shop } # without project: cluster-wide
spec:
  mode: enforce # or monitor: warnings only
  selector: { labels: { tier: backend } } # optional; none: every service in scope
  requireSignature:
    keys:
      - |
        -----BEGIN PUBLIC KEY-----
        MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…
        -----END PUBLIC KEY-----
  vulnerabilities:
    block: [CRITICAL, HIGH] # CRITICAL | HIGH | MEDIUM | LOW
    ignoreUnfixed: true # default: only findings with a fixed version count
```

A policy needs `requireSignature`, `vulnerabilities` or both. A project's policies cover its services; cluster-wide policies cover the services of every project their selector matches.

## Signatures

- Signatures are cosign signatures made with a key pair (`cosign sign --key`), stored next to the image as the `sha256-<digest>.sig` tag in the classic simple-signing format.
- A signature counts when its payload names exactly the image digest and verifies with one of the policy's keys (up to 16).
- Signatures are checked by the control plane at plan time, for public and private (`registry.lw`) images. A verified result is reused for an hour; failures are checked again on the next plan.
- Keyless signing (Fulcio / Rekor) and the newer sigstore bundle format are not supported yet.

## Vulnerability scans

- A node scans an image with Trivy 0.76.0 (itself pinned by digest) when it starts a workload from it. A result is reused for a day; after that, the next start scans the digest again.
- Images of running workloads are rescanned daily: the node checks every hour and scans each digest whose result is older than a day. New vulnerabilities reach the reports and the next plans without a restart.
- The image is saved to a file and scanned from there; Trivy never gets the Docker socket. Its vulnerability database is downloaded and cached on the node.
- A scan only runs with enough free disk space for the saved image plus a margin.
- Nodes report the result to the control plane, but only for images of workloads they run. `GET /api/images/scans` lists the latest scan per digest: counts per severity (total and fixable) and the most severe findings.

## Enforcement

| Where | `enforce`                                                                                                       | `monitor`                |
| ----- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Plan  | An unsigned image or one with blocked findings rejects the plan                                                 | Warnings in the plan     |
| Node  | After the pull, the node scans the image and refuses to start it if it has blocked findings or can't be scanned | Logged, the image starts |

- An image that hasn't been scanned yet is an info in the plan; the nodes check it after they pull it.
- When several policies cover a service, the node gets one rule per policy and judges each on its own. A `monitor` policy never blocks, even next to an `enforce` one.
- An update whose new image is blocked keeps the running version: the node checks the new image before it removes the old container. The reason is in the node's log.
- A workload that isn't started because of an image policy shows the reason in its status.
