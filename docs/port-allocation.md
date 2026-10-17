# Application Port Allocation

Application listeners use separate numeric bands: backend HTTP services use `3xxx`, frontend HTTP servers use `4xxx`, and networked MCP transports are reserved for `5xxx`. Port assignments are unique across this workspace so apps can run together without local binding conflicts. Frontends are grouped in blocks of 100 per product (Agenstra `41xx`, Decabill `42xx`, ForePath `43xx`, shared `44xx`, Loadweaver `46xx`); `4500` is skipped because the landing environments still use it as the placeholder portal URL (`host.docker.internal:4500`).

## Application Listeners

| Application                   | Port | Listener                       |
| ----------------------------- | ---: | ------------------------------ |
| Agenstra agent manager API    | 3000 | HTTP, Socket.IO, VNC websocket |
| Agenstra agent controller API | 3100 | HTTP, Socket.IO, VNC websocket |
| Decabill billing manager API  | 3200 | HTTP, Socket.IO                |
| Forepath communication API    | 3300 | HTTP                           |
| Loadweaver control plane API  | 3400 | HTTP, Socket.IO                |
| Agenstra agent console        | 4100 | Frontend                       |
| Agenstra landing page         | 4101 | Frontend                       |
| Agenstra documentation        | 4102 | Frontend                       |
| Agenstra billing console      | 4103 | Frontend                       |
| Decabill landing page         | 4200 | Frontend                       |
| Decabill documentation        | 4201 | Frontend                       |
| Decabill billing console      | 4202 | Frontend                       |
| Forepath landing page         | 4300 | Frontend                       |
| Forepath billing console      | 4301 | Frontend                       |
| Shared documentation          | 4400 | Frontend                       |
| Shared UI Storybook           | 4401 | Frontend tooling               |
| Loadweaver landing page       | 4600 | Frontend                       |
| Loadweaver billing console    | 4601 | Frontend                       |
| Loadweaver console            | 4602 | Frontend                       |

The `ai`, `code`, `graph`, and shared MCP proxy servers use stdio transport and do not bind network ports. Reserve `5xxx` for MCP servers that introduce a network transport. The native agent console selects an available local port at runtime.

## Supporting Services

These are infrastructure or worker ports, not app HTTP listeners; their assignments remain outside the application bands.

| Service                          | Host/container port                                        |
| -------------------------------- | ---------------------------------------------------------- |
| Agent worker OpenCode server     | 4096                                                       |
| Agent worker VNC                 | 5901 (container-internal)                                  |
| Agent worker VNC websocket proxy | 6080                                                       |
| PostgreSQL                       | 5432 (container-internal)                                  |
| Redis                            | 6379; Decabill Compose publishes host `6380`               |
| OpenSearch                       | 9200; Decabill Compose publishes host `9201`               |
| Keycloak                         | host `8380` to container `8080`                            |
| MailHog                          | controller host `1025`/`8025`; Decabill host `1026`/`8026` |
| Loadweaver node agent stream     | 7443 (gRPC, mutual TLS; outbound from every node)          |
| Loadweaver service mesh          | 15001 (outbound, pod gateway), 15443 (inbound, overlay)    |
| Loadweaver egress filtering      | 15080 (HTTP), 15444 (TLS), pod gateways and VPN gateway    |
| Loadweaver remote access         | 51800/udp (WireGuard, default), 53 on the VPN gateway      |
| Loadweaver node services         | see `docs/loadweaver/deployment/host-requirements.md`      |
