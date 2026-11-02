# whoami

[traefik/whoami](https://github.com/traefik/whoami) answers every request with what it received: headers, client address and the replica's hostname. Use it to check DNS, TLS, ingress routing and load balancing.

## Parameters

| Parameter  | Default    | Meaning                         |
| ---------- | ---------- | ------------------------------- |
| `domain`   | (required) | Public hostname                 |
| `replicas` | `2`        | Replicas, spread over the nodes |

## After the install

Open `https://<domain>`: reload a few times and watch `Hostname` change between replicas.

This package is the example of the community catalog: compare it with your submission.
