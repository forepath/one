# Contributing an app

You need the Loadweaver CLI (`loadweaver`, also called `lw`) and a fork of this repository.

## 1. Register as a publisher (first PR only)

```sh
loadweaver app keygen -o ~/.config/loadweaver/my-publisher    # my-publisher.key (keep it private), my-publisher.pub
```

Add `publishers/<your-name>.yaml` (format in [publishers/README.md](./publishers/README.md)) with the **public** key. Keep the private key offline or in your CI's secret store; never commit it. You can also sign with cosign: `cosign import-key-pair --key my-publisher.key`, then `cosign sign-blob --key …`; the signatures are the same format.

## 2. Create the package

```sh
loadweaver app init my-app -o my-app/1.0.0 --version 1.0.0 --publisher "My Name"
```

Edit `compose.yaml`, `manifest.yaml` and `README.md` (see the [whoami](./whoami/1.12.0) example and the [publishing guide](../../../../docs/loadweaver/features/app-store-publishing.md)). Then:

```sh
loadweaver app validate my-app/1.0.0      # parse, pinned images, render + plan dry run
loadweaver app lint my-app/1.0.0          # policy lint: no errors allowed
```

## 3. Sign it

The package archive is deterministic, so you sign exactly what CI and clusters rebuild:

```sh
loadweaver app package my-app/1.0.0 -o /tmp/my-app-1.0.0.tar.gz
loadweaver app sign /tmp/my-app-1.0.0.tar.gz --key ~/.config/loadweaver/my-publisher.key \
  --oci oci://ghcr.io/forepath/loadweaver-community-apps
cp /tmp/my-app-1.0.0.tar.gz.sig     my-app/1.0.0/package.sig
cp /tmp/my-app-1.0.0.tar.gz.oci.sig my-app/1.0.0/package.oci.sig
loadweaver app verify . --require-signatures
```

Change a single byte of the package and the signatures no longer match: sign again after every change.

## 4. Open the pull request

Fill in the PR template. CI runs validate, lint, Trivy, the signature check and the test install. Fix what it reports.

## Review (maintainers)

A maintainer checks, in this order:

1. **Publisher**: new publishers get a short identity check (link to the upstream project, a commit or release signed by the same person, or a domain). `label: verified` only for publishers whose identity and control of the upstream project are confirmed.
2. **Upstream**: images come from the project's official registry / releases; the digest matches the tag at review time.
3. **Exceptions**: every lint exception has a convincing reason; otherwise ask for a change.
4. **Behaviour**: README matches what the compose does (ports, exposure, volumes, outbound connections).
5. **Licence**: SPDX id matches upstream; `LicenseRef-…` free tiers need two maintainers.
6. **CI** is green, including the Trivy gate (or a documented, time-boxed exception).

Approve and merge; the publish workflow signs and publishes the index.

## Takedowns (maintainers)

After a [report](https://github.com/forepath/one/issues/new?template=loadweaver-app-report.yml):

1. Confirm the problem (reproduce, check upstream advisories). Urgent cases (malware, credential theft) are taken down first and investigated after.
2. Add an entry to `takedowns.yaml` (`app`, `versions: all` or a list, `reason` that users will read, `at`), reference the report in the PR, merge.
3. The publish workflow signs the new index; refreshing clusters hide the versions and flag installed copies.
4. A takedown is lifted by removing the entry; a fixed version is a new version folder.
