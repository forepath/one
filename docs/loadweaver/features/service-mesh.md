# Service Mesh

Traffic between services can run through a proxy on every node. The proxies talk to each other with mutual TLS and workload identities, so a replica only accepts connections from the services a policy names, and HTTP rules can look at paths, methods and hosts. Nothing has to change in your images: there is no sidecar and no library.

```yaml
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: web-to-api, project: shop }
spec:
  from: [{ group: web }]
  to: [{ group: api }]
  rules:
    - protocol: tcp
      ports: [8080]
      http: { paths: [/orders], methods: [GET, POST] } # optional, checked by the proxy
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: no-admin, project: shop }
spec:
  action: deny # deny exists only at L7
  from: [{ group: web }]
  to: [{ group: api }]
  rules: [{ protocol: tcp, ports: [8080], http: { paths: [/admin] } }]
```

## What goes through the mesh

A flow is meshed when all of this holds:

- it is a TCP rule between workloads (groups or selectors), not a built-in policy;
- the rule lists its ports, and every range has at most 64 ports;
- the destination service has a service IP.

Everything else goes direct and is enforced at L3 / L4 only: UDP, rules without ports, wider ranges, and nodes, sites, CIDRs or built-in groups as peers. L7 denies have no effect on those flows.

A rule with `http` matches that the mesh can't carry is not applied at all, and the plan warns. It would otherwise allow all traffic at L4, so it fails closed.

## How a connection flows

1. The workload connects to the service IP. nftables on its node redirects the connection to the proxy's outbound listener on the pod gateway (port `15001`).
2. The proxy picks the destination by the original address and port and the client identity by the source address.
3. It opens mutual TLS to the proxy on a node with a replica, on that node's overlay address (port `15443`). The SNI names the service port: `<port>.<service>.<deployment>.<project>.mesh.lw`.
4. The receiving proxy checks the certificate, applies the RBAC rules and forwards to a local replica.

All proxies are one Envoy per node (`lw-mesh`), configured through files it watches. Renewed certificates are picked up without a restart or a listener drain.

## Workload identities

- Every service has an identity: `spiffe://<cluster>.loadweaver/workload/<project>/<deployment>/<service>`.
- The node generates the key and sends only a CSR. The private key never leaves the node.
- The control plane signs a certificate only for services with a replica on that node (or being moved to it); other requests are refused.
- Certificates are valid for 24 hours and are renewed at half their lifetime. Until a service's certificate arrives, its ports are left out of the proxy configuration.
- Only TLS 1.3 is used, in both directions. The client also checks that the server is the destination service, not just any workload of the cluster.

## Rules

Per service port, the receiving proxy evaluates:

- **denies first:** a matching deny rejects the request, whatever allows exist;
- **then allows:** the request needs a matching allow from its source identity.

Without `http` matches the check is per connection. With them, the proxy parses HTTP and checks every request; all given dimensions (`paths` as prefixes, `methods`, `hosts`) must match. Paths are normalised before the check (`//`, `/./`, `..` and encoded slashes), so they can't be used to slip past a rule.

Policies in `monitor` mode are shadow rules: a monitored deny only logs what it would have blocked, a monitored allow lets traffic through like an allow.

## Defense in depth

The nftables rules stay in place. On a meshed port, workloads can only reach their own node's proxy, proxies reach each other only on `15443`, and a proxy reaches only its local replicas on the service ports. A direct connection to a replica's address on a meshed port is dropped.

## Source addresses

The proxy takes the client identity from the source address, so workloads must not be able to send with another address:

- Containers run without `NET_RAW` unless the compose file adds it with `cap_add`.
- Nodes drop traffic from the pod bridge whose source isn't in the node's pod subnets. IPv6 link-local and the unspecified address stay allowed for neighbour discovery.
- Plans warn about `cap_add` with `NET_RAW`, `NET_ADMIN` or `ALL`.

## Ports

| Port        | Where                         | Purpose                             |
| ----------- | ----------------------------- | ----------------------------------- |
| 15001 / tcp | every node, pod gateway       | Mesh outbound (local workloads)     |
| 15443 / tcp | every node, overlay addresses | Mesh inbound (proxy-to-proxy, mTLS) |
