# Egress Filtering

Workloads that may reach the web can be limited to the hostnames you name. The node proxy reads the `Host` header of HTTP and the SNI of TLS and decides per connection. It never decrypts anything, so there are no certificates to install in your images.

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  egress:
    mode: enforce # off | monitor | enforce | offline
    blockPrivateNetworks: true
    blockIpLiterals: false
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: payments, project: shop }
spec:
  from: [{ group: api }]
  to: [{ host: api.stripe.com }, { host: '*.amazonaws.com' }]
  rules: [{ protocol: tcp, ports: [443] }]
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: no-pastebins, project: shop }
spec:
  action: deny
  from: [{ group: api }]
  to: [{ host: pastebin.com }]
  rules: [{ protocol: tcp, ports: [80, 443] }]
```

## Modes

| Mode      | Effect                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| `off`     | No filtering (default); L3 / L4 policies alone decide                          |
| `monitor` | Everything passes; what `enforce` would block is logged                        |
| `enforce` | Allow and deny lists apply                                                     |
| `offline` | Workloads reach nothing outside the cluster, whatever the L3 / L4 policies say |

## Hostnames

- `example.com` matches the name itself and all its subdomains; `*.example.com` only the subdomains. Matching ignores case.
- Hostnames can only be destinations, and can't be mixed with other destinations in one policy.
- A hostname policy grants reachability on TCP 80 and 443 by itself; you don't need an `internet` policy as well.
- Allowed hostnames are forwarded to the host itself, resolved the way the node resolves names, not to the address the workload connected to. So a workload can't send an allowed SNI or `Host` to another server. Other allowed traffic (CIDR policies, unrestricted sources) goes to the original destination.
- Hostnames only work for web traffic. A rule without 80 or 443 is skipped with a warning in the plan; use CIDRs for other ports.

## Allow and deny lists

Per workload and web port:

- **Deny wins.** Deny policies with hostnames are checked first. A deny policy in `monitor` mode only logs.
- **Monitor allows only record.** A hostname allow in `monitor` mode logs what it would allow. It opens nothing and doesn't turn an `internet` policy into an allow list.
- **An allow list restricts.** As soon as a workload has an allow policy with hostnames, or reaches the outside only through CIDR policies, everything else on 80 / 443 is blocked.
- **No allow list means unrestricted.** A workload with an `internet` policy and no hostname allows can go anywhere, minus the deny list.
- Web traffic of [remote clients](./remote-access.md) is filtered the same way on the active VPN gateway.
- Traffic that leaves through an [egress address](./public-addresses.md#egress-from-own-prefixes) isn't filtered here. Hostname rules don't apply to such sources; the plan warns about them.

## Extra blocks

- `blockPrivateNetworks` (default `true`): private, loopback, link-local, CGNAT and ULA ranges are blocked on 80 / 443. CIDRs a policy allows inside them lift the block for exactly those CIDRs, not for the whole range.
- `blockIpLiterals` (default `false`): HTTP requests to a bare IP address and TLS connections without SNI are blocked.

## What can't bypass the proxy

While the mode is `enforce` or `offline`, filtered workloads can't use:

- QUIC (UDP 443): clients fall back to TCP, where the SNI is visible;
- DNS over TLS (TCP 853): it would get around the cluster's DNS policy.

In `monitor` these stay open.

## Logs

The proxy writes one JSON line per HTTP request or TLS connection to its log, with source, host, destination, response flags and status. With `logAllowed: false` (default `true`) only denials are logged: enforced ones and those recorded by monitor rules.

## Ports

| Port        | Where                                               | Purpose                     |
| ----------- | --------------------------------------------------- | --------------------------- |
| 15080 / tcp | every node, pod gateway; VPN gateway client address | Egress filter, HTTP by Host |
| 15444 / tcp | every node, pod gateway; VPN gateway client address | Egress filter, TLS by SNI   |
