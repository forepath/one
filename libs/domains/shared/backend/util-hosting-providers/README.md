# shared-backend-util-hosting-providers

Hosting provider integrations shared by Loadweaver, Agenstra and Decabill, behind provider-neutral interfaces:

- **DNS** (`DnsProvider`): zones, records (A, AAAA, CNAME, TXT, MX, SRV, CAA, NS) and capability flags. Built in: Cloudflare. More via `DYNAMIC_DNS_PROVIDERS`.
- **Failover IPs** (`FailoverIpProvider`): move a provider floating / failover IP to a server. Built in: Hetzner Cloud. More via `DYNAMIC_FAILOVER_IP_PROVIDERS`.

Providers are created per credential through their registry (`DnsProviderRegistry`, `FailoverIpProviderRegistry`); callers decide by capability flags, never by provider id.

## Running unit tests

Run `nx test shared-backend-util-hosting-providers`.
