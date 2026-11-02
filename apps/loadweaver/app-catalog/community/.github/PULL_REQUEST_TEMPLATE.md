## App submission

- **App / version**: <!-- my-app 1.0.0 -->
- **Upstream project**: <!-- link to the source repository -->
- **New publisher registration?** <!-- yes / no -->

## Checklist

- [ ] `loadweaver app validate <dir>` passes
- [ ] `loadweaver app lint <dir>` has no errors (every exception has a reason in the manifest)
- [ ] All images are pinned by digest and come from the upstream project's official registry
- [ ] `package.sig` (and `package.oci.sig`) are made with a key registered for the publisher; `loadweaver app verify . --require-signatures` passes
- [ ] The licence is free / open source (SPDX id matches upstream)
- [ ] The README describes what the app exposes, stores and connects to
- [ ] No private keys, passwords or tokens anywhere in the PR

## Notes for the reviewer

<!-- exceptions, unusual ports, outbound connections, anything the reviewer should know -->
