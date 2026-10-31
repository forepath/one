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

## Per-workload settings

The cluster's `egress` settings are the default for every workload. Policies can tighten them for the workloads they select, with the same fields as Agenstra's egress policy (Agenstra environments on Loadweaver are configured this way, see [Agenstra on Loadweaver](../guides/agenstra-on-loadweaver.md)):

```yaml
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: ci-runners-egress, project: shop }
spec:
  from: [{ selector: { matchLabels: { role: ci } } }]
  egressMode: enforce # off | monitor | enforce | offline
  denyUrlPatterns: ['^http://[^/]+/admin', '\.exe$']
  blockPrivateNetworks: true
  blockIpLiterals: true
  logAllowed: false
```

- **The most restrictive wins.** For each workload the cluster setting and every policy selecting it combine: the strictest mode (`off` < `monitor` < `enforce` < `offline`), blocks on if any sets them, logging on if any sets it, URL patterns add up. A policy can't loosen the cluster's settings.
- A settings policy needs no `to` and `rules` (it can also carry them). It applies to the project's own workloads only (groups of the project or selectors) and needs `action: allow`.
- `offline` set for a workload takes everything outside the cluster away from that workload alone.
- With the cluster `off`, only workloads a policy selects are filtered.

### URL deny patterns

`denyUrlPatterns` block plain-HTTP requests whose URL matches, like Agenstra's guard: Squid-style regular expressions matched case-insensitively anywhere in `http://host/path?query`. TLS is never decrypted, so they don't apply to HTTPS.

The proxy uses RE2, so every pattern is translated when the plan is made. Everything is kept exactly (JavaScript escapes, `\d` / `\w` / `\s`, POSIX bracket classes such as `[[:digit:]]`, lazy quantifiers); what RE2 can't express the same way is a **plan error** naming the pattern: backreferences, lookarounds and named groups, empty classes `[]`, repetition above 1000 and patterns too big for the proxy. Up to 500 patterns of at most 512 characters per policy.

### Denying addresses

A deny policy can name CIDRs when its rules are TCP 80 / 443 only: the node proxy then denies web requests to those addresses (deny wins over allows). Other ports have no deny at L3; there, only allows exist.

```yaml
spec:
  action: deny
  from: [{ group: api }]
  to: [{ cidr: 203.0.113.0/24 }]
  rules: [{ protocol: tcp, ports: [80, 443] }]
```

Nodes need an agent that advertises the protocol feature `egress-policies` for per-workload settings. An older agent gets them folded into what it understands, never looser: a stricter per-workload mode makes the node level enforce (an `offline` workload additionally loses its allow lists), per-workload private-network / IP-literal blocks and logging switch the node-level setting on, and enforced address denies remove the allow-list CIDRs they overlap. So such a node filters too much, never too little. What can't be folded — URL patterns, and address denies of a workload without an allow list (an `internet` policy on 80 / 443 and no hostname allows) — would not be applied there, so plans **steer such workloads to updated nodes**: their new replicas (plans, failover, autoscaler scale-ups) are placed only on nodes whose agent advertises `egress-policies`. If none of those fits, the plan is refused (`no eligible node with enough capacity has an agent with the protocol feature egress-policies (needed for per-source egress settings older agents can't apply: denyUrlPatterns); update the node agents`). Replicas already running on an older node stay there (nothing moves on its own); the plan warns for each (`replica … stays on node n1, whose agent lacks the egress-policies protocol feature …; update the agent on n1`) and the control plane keeps logging the warning above until the agent is updated. A stateful workload can only run where its volume copies are, so it is refused when no updated node holds a copy.

## Hostnames

- `example.com` matches the name itself and all its subdomains; `*.example.com` only the subdomains. Matching ignores case.
- Hostnames can only be destinations, and can't be mixed with other destinations in one policy.
- A hostname policy grants reachability on TCP 80 and 443 by itself; you don't need an `internet` policy as well.
- TLS connections are decided on the client's first bytes (the ClientHello) before the proxy connects anywhere: a denied destination never sees a connection attempt, and an unreachable one is still logged with its denial.
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

- `blockPrivateNetworks` (default `true`): private and reserved ranges are blocked on 80 / 443, the same list as Agenstra's: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`, `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`. CIDRs a policy allows inside them lift the block for exactly those CIDRs, not for the whole range.
- `blockIpLiterals` (default `false`): HTTP requests to a bare IP address and TLS connections without SNI or with an IP address as SNI (some clients send one) are blocked, except to addresses a CIDR policy allows explicitly.

## What can't bypass the proxy

While the mode is `enforce` or `offline`, filtered workloads can't use:

- QUIC (UDP 443): clients fall back to TCP, where the SNI is visible;
- DNS over TLS (TCP 853): it would get around the cluster's DNS policy.

In `monitor` these stay open.

## Logs

The proxy writes one JSON line per HTTP request or TLS connection to its log, with source, host, destination, response flags and status, and how it was decided: the source's `mode`, the deny `rule` that matched (`r1_offline`, `r2_deny_host`, `r3_private_network`, `r4_ip_literal`, `r5_deny_url`, in Agenstra's precedence), the allow list's shadow result and the enforcement `details`. With `logAllowed: false` (default `true`) only denials are logged: enforced ones and those recorded by monitor rules.

The node attributes each line to the workload that made the request: it carries the workload's `project`, `deployment`, `service` and `replica` labels (so project members see their own decisions in [Logs](./logs.md)) and the fields `egressDecision` (`allowed`, `blocked`, `observed`), `egressRule` (`deny_host`, `private_network`, `ip_literal`, `deny_url`, `offline`, `not_allowlisted`) and `egressHost`. Query them with `GET /api/logs?sources=proxy&project=<p>&deployment=<d>`.

## Ports

| Port        | Where                                               | Purpose                     |
| ----------- | --------------------------------------------------- | --------------------------- |
| 15080 / tcp | every node, pod gateway; VPN gateway client address | Egress filter, HTTP by Host |
| 15444 / tcp | every node, pod gateway; VPN gateway client address | Egress filter, TLS by SNI   |
