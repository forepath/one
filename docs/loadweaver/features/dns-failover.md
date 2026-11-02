# DNS Failover

Where an address can't float (no shared L2, no BGP, no provider failover IP), DNS failover moves traffic between endpoints by changing the answers. It also works on top of floating IPs, e.g. between sites at different providers.

```yaml
apiVersion: loadweaver.com/v1
kind: DnsFailover
metadata: { name: shop }
spec:
  host: shop.example.com
  mode: failover # failover | multi-value | weighted | geo | latency
  endpoints:
    - { name: fra, address: 203.0.113.10, site: fra1 }
    - { name: ams, address: 198.51.100.10, site: ams1 }
  check: { protocol: https, path: /health } # http | https | tcp
  intervalSeconds: 10
  failAfter: 3 # failed rounds before failing over
  recoverAfter: 3
  failback: auto # or manual
  stableSeconds: 600
  ttl: 30
```

## How decisions are made

- Nodes probe every endpoint, from sites other than the endpoint's own where possible.
- A switch needs at least two fresh votes, a majority, and control-plane quorum, so an isolated site can't flip records on its own.
- Every switch is audited and pushed to every provider of the zone and to hosted bind9. It counts as done once all authoritative servers answer the new record; lagging servers are reported.
- Fail-back is automatic after the primary has been healthy for `stableSeconds`. With `failback: manual`, it waits for `POST /api/dns/failover/<name>/failback`.

Single-site clusters can add an **external probe location**: join a small VPS in its own site, e.g. the witness. When fewer than two probers are outside an endpoint's site, nodes inside it add their votes.

The plan shows the expected recovery time (detection + update + TTL). Some resolvers cache longer than the TTL: DNS failover is slower and fuzzier than floating IPs. For TCP endpoints, existing connections break on a switch.

## Modes

| Mode          | Answers                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failover`    | the first healthy endpoint                                                                                                                            |
| `multi-value` | every healthy endpoint                                                                                                                                |
| `weighted`    | clients split by `weight` per endpoint (by client address, so a client keeps its endpoint)                                                            |
| `geo`         | by the client's country (`countries: [DE, AT]`) or continent (`continents: [EU]`); endpoints without either answer everyone else                      |
| `latency`     | each continent gets the endpoint measured fastest from the probing site nearest to it (sites need a `location`); everyone else the fastest on average |

`weighted`, `geo` and `latency` steer per client through views of hosted bind9; other providers answer every client with the default (all healthy endpoints). Geo and latency need a GeoIP database: DB-IP Lite comes with the release bundle, or set `LOADWEAVER_GEOIP_DB` to your own. Nodes download it from the control plane's public install route, so only point it at a database you may redistribute (DB-IP Lite is CC BY 4.0; MaxMind's licences don't allow serving GeoIP2 / GeoLite2 publicly). Unhealthy endpoints are out of every answer.
