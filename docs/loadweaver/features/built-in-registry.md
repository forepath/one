# Built-in Registry

Every cluster has its own image registry on the control-plane members:

- a **pull-through cache** for public registries (Docker Hub, GHCR, Quay, registry.k8s.io, gcr.io, mcr.microsoft.com, public ECR by default), so every image is pulled from upstream once per cluster and nodes keep working while an upstream registry is down or rate-limited;
- a **private registry** for your own images: `registry.lw/<project>/<repository>`.

Images are stored in the cluster's **object store** (Garage), replicated across the members and their sites.

## Pushing images

```bash
docker login <control-plane-host>          # user name: anything, password: API key or personal access token
docker tag api:1.4 <control-plane-host>/acme/api:1.4
docker push <control-plane-host>/acme/api:1.4
```

Docker requires HTTPS for registries other than `localhost`, so push through the API's public HTTPS address.

In compose, reference it as `registry.lw/acme/api:1.4`. Repositories live under existing project names; a deployment can only use private images of its own project. Pull needs the PAT scope `registry:pull`, push `registry:push` and deploy rights.

## VM images

The registry also stores the disk images of [virtual machines](./virtual-machines.md#images) as OCI artifacts (`artifactType: application/vnd.loadweaver.vm-image.v1`, one qcow2 or zstd-compressed raw disk layer) in the same private repositories: `registry.lw/<project>/<repository>:<tag>`. Push them with `loadweaver vm-image push <file> registry.lw/<project>/<repository>:<tag>` or import them from a URL (`POST /api/projects/<project>/vm-images/import`); KubeVirt containerDisk images pushed with Docker work as well. Nodes pull them through the same router when a VM's boot disk is written, verify the digest and keep them in their VM image cache.

## How nodes pull

Each node runs a small pull router on `127.0.0.1:7479`. Images of mirrored registries and of the private registry are pulled through it; the router forwards to the members over the encrypted overlay and fails over between them. A node can pull private images only for workloads it runs itself, with a short-lived token from the control plane. If the cluster registry can't deliver a public image, the node pulls it from upstream directly.

Images from registries that aren't mirrored are pulled by every node directly; the plan warns about them. Mirrors are configured in the `Cluster` resource:

```yaml
spec:
  registry:
    mirrors:
      - { host: docker.io, remoteUrl: https://registry-1.docker.io }
      - { host: registry.example.com, remoteUrl: https://registry.example.com }
```

## Object store

Garage runs on the control-plane members with one copy per member, up to three, placed in different sites where possible. When the cluster grows from one member to three, Loadweaver builds a new object store with three copies, copies everything over (the private registry is read-only for a short moment at the end), switches over and removes the old one. A member can only leave once its object-store data has moved.
