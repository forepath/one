# Ingress

The ingress brings traffic from the internet to your services: HTTP and HTTPS by hostname, plus plain TCP and UDP port forwards. It runs as an Envoy on the nodes of the ingress pool's node group and fails over with the pool's addresses (see [Public addresses](./public-addresses.md)).

## Exposing a service

Hostnames are set per service in compose; published `ports` become L4 forwards:

```yaml
services:
  web:
    image: ghcr.io/acme/web@sha256:…
    ports: ['5432:5432'] # TCP forward on the ingress addresses
    x-loadweaver:
      replicas: 2
      exposure:
        http:
          - { host: shop.example.com, port: 8080 }
          - { host: shop.example.com, path: /api, port: 9000 }
```

- A hostname + path or a public port belongs to exactly one service; a second claim fails the plan.
- Ports 80 and 443 belong to the HTTP ingress and can't be L4 forwards.
- Traffic reaches the replicas over the encrypted overlay. A built-in policy opens exactly the exposed ports from the ingress nodes to the replicas.
- The cluster's addresses come from `spec.ingress` in the `Cluster` resource:

```yaml
spec:
  ingress:
    pool: public # IpPool
    addresses: 1
    acme: { email: ops@example.com }
```

## Certificates

Every exposed hostname gets a certificate from Let's Encrypt (or another ACME directory) through the built-in ACME client, using HTTP-01 through the ingress. Certificates renew 30 days before they expire; failures back off and show up in `GET /api/certificates`. Hosts with a certificate are HTTPS-only (HTTP redirects); TLS 1.2 is the minimum.

To use your own certificate, upload it. It takes precedence over ACME for the names it covers:

```bash
curl -X PUT https://<control-plane>/api/certificates/shop \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"certificatePem\": \"$(cat chain.pem)\", \"privateKeyPem\": \"$(cat key.pem)\"}"
```

Private keys are stored encrypted. They only ever reach the ingress nodes, at the moment the configuration is pushed, and are never returned by the API.

## Rate limits

Limits are per route and cluster-wide, shared by every ingress node:

```yaml
exposure:
  http:
    - host: api.example.com
      port: 8080
      rateLimit:
        perIp: 100/m # per client address
        perKey: { header: X-API-Key, rate: 10/s } # per API key
        total: 1000/s # the whole route
```

Rates are `<n>/s`, `/m`, `/h` or `/d`. Clients over the limit get `429`. The limit service runs on the control-plane members. If it is unreachable, requests pass rather than fail.

## Web application firewall

The ingress can inspect requests with Coraza and the OWASP Core Rule Set, per hostname:

```yaml
exposure:
  http:
    - { host: shop.example.com, port: 8080, waf: enforce } # off | monitor | enforce
```

- `monitor` logs what would be blocked.
- `enforce` blocks with `403`.

When a host's routes set different modes, the strictest applies. The WAF module ships in the release bundle and nodes verify its checksum before loading it. Without a verified module, `enforce` hosts answer `503` rather than serving unprotected traffic.

## Ports

| Port            | Where         | Purpose                         |
| --------------- | ------------- | ------------------------------- |
| 80, 443 / tcp   | ingress nodes | HTTP, HTTPS                     |
| published ports | ingress nodes | TCP / UDP forwards from compose |
