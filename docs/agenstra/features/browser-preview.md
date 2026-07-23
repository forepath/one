# Browser Preview

Browser Preview streams and controls the Chromium browser that runs inside an agent’s optional virtual workspace sidecar—without exposing the full XFCE desktop over noVNC.

## Overview

When an environment is created with **Enable Browser Preview** (default on):

- The manager still deploys the virtual workspace (VNC) sidecar that hosts Chromium.
- Chromium remote-debugging listens on loopback `:9223` inside the sidecar; **socat** proxies it to container-network port `9222` (never published to the host).
- The manager joins the agent Docker network for the session and rewrites CDP WebSocket URLs to the sidecar IP.
- Each Preview open creates a **fresh Chromium tab** (`about:blank`), forces a **1910×865** viewport via CDP emulation (so a non-maximized desktop window does not skew the stream), and closes that tab when Preview stops.
- While the Preview URL is `about:blank`, the console shows an onboarding guide (toolbar usage + how to reach an app in the workspace container over the shared Docker network; `localhost` is the Preview sidecar, not the workspace).
- Screencast JPEGs are capped (about 1280×720) for Socket.IO throughput; pointer mapping still uses the logical device size from frame metadata.
- Authenticated console users open Preview from the globe toolbar control.
- Video frames and input travel over the **existing** agent-manager Socket.IO path (proxied by the agent controller)—no additional host ports.

**Create Virtual Workspace (VNC)** remains a separate Danger Zone option that publishes noVNC on a host port. Enabling VNC **always** enables Preview (UI locks the Preview checkbox; backend forces `createBrowserPreview`).

## Flag matrix

| createBrowserPreview | createVirtualWorkspace | Sidecar | Host `6080` / `vnc` in API | Globe Preview | Desktop VNC button |
| -------------------- | ---------------------- | ------- | -------------------------- | ------------- | ------------------ |
| true                 | false                  | yes     | no                         | yes           | no                 |
| true (forced)        | true                   | yes     | yes                        | yes           | yes                |
| false                | false                  | no      | no                         | no            | no                 |
| false (client)       | true                   | yes     | yes                        | yes (forced)  | yes                |

## Architecture

```text
Agent Console  --Socket.IO-->  Agent Controller  --forward-->  Agent Manager
                                                                  |
                                                                  | join agent Docker network
                                                                  v
                                                         VNC sidecar :9222 (CDP)
                                                         Chromium Page.startScreencast
                                                         Input.dispatchMouseEvent / KeyEvent
```

### Socket.IO events (agents namespace)

- `startBrowserPreview` / `browserPreviewStarted`
- `browserPreviewFrame` (base64 JPEG + metadata)
- `browserPreviewInput` (`kind`: `mouse` | `key`)
- `browserPreviewCommand` (`navigate` | `reload` | `back` | `forward`)
- `browserPreviewLocation` (current URL + history flags)
- `stopBrowserPreview` / `browserPreviewStopped`

See `libs/domains/agenstra/backend/feature-agent-manager/spec/asyncapi.yaml`.

## Security

- Preview requires agent WebSocket login (same as terminals).
- Manager rejects sessions when `browser_preview_enabled` is false.
- CDP URL/port are never returned to clients; `9222` is not published.
- Input events are allowlisted and range-checked server-side.
- Navigate URLs are restricted to `http`/`https`.
- Screencast frames are not retained in the console Socket.IO event buffer (same treatment as `containerStats`).
- Full desktop noVNC remains separately gated via `vnc` credentials and published port.
- Set `MANAGER_CONTAINER_ID` so the manager can join the agent Docker network for CDP (compose defaults to `agent-manager-api`).

## Data model

- Column `agents.browser_preview_enabled` (boolean).
- Response field `browserPreview: { enabled: true }` when allowed.
- Response field `vnc: { port, password }` only when full VNC access was enabled.

## Related

- [VNC Browser Access](./vnc-browser-access.md)
- [Agent Management](./agent-management.md)
