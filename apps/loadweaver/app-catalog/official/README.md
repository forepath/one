# ForePath official apps

Apps curated and signed by ForePath. Clusters ship this catalog preconfigured (disabled until an admin enables it) and
show its apps with the **Official** label.

| App                                                  | Version | Images                                                   |
| ---------------------------------------------------- | ------- | -------------------------------------------------------- |
| [`agenstra-controller`](./agenstra-controller/4.1.0) | 4.1.0   | controller API (api / worker / scheduler), agent console |
| [`agenstra-manager`](./agenstra-manager/4.1.0)       | 4.1.0   | agent manager on the Loadweaver runtime                  |
| [`decabill-billing`](./decabill-billing/4.1.0)       | 4.1.0   | billing API (api / worker / scheduler), billing console  |

Packages use the **same images** as the other deployment variants of the same release (Docker Compose, Decabill's
bundled stacks, Agenstra Cloud), pinned by the digests the release published to `ghcr.io`. The app store is an
additional way to deploy them; it replaces none of the others.

## A new release

For each app, copy the newest version folder to `<app>/<new version>/`, update `version`, the image tags and digests
(`docker buildx imagetools inspect ghcr.io/forepath/<image>:<version>` shows the index digest) and `release.yaml`, add
`migrations` if the update needs steps, then run `loadweaver app validate` and `loadweaver app lint`. The release
workflow's `publish-loadweaver-app-catalog` job signs the packages and the index with the official catalog key and
publishes them.

The official packages are not signed in the repository: the publish job signs them with the catalog key (the
`ForePath` publisher key), so `loadweaver app verify official` lists them as unsigned.
