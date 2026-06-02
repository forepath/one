# ACP launch spike (worker image)

Verified against [Dockerfile.worker](../../../../../../../../../../apps/backend-agent-manager/Dockerfile.worker):

| Agent type | ACP entrypoint     | Notes                                                                 |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| `cursor`   | `cursor-agent acp` | Installed via `curl cursor.com/install` → `~/.local/bin/cursor-agent` |
| `opencode` | `opencode acp`     | Installed via `opencode.ai/install` → `~/.opencode/bin/opencode`      |

Worker `PATH` includes both bin directories.

## Sample initialize request (client → agent)

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true } } } }
```

## Sample session/new (after initialize)

```json
{ "jsonrpc": "2.0", "id": 2, "method": "session/new", "params": { "cwd": "/app", "mcpServers": [] } }
```

## Sample session/prompt

```json
{ "jsonrpc": "2.0", "id": 3, "method": "session/prompt", "params": { "sessionId": "<session-id>", "prompt": [{ "type": "text", "text": "Hello" }] } }
```

## session/update notification (agent → client)

```json
{ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "<session-id>", "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Hi" } } } }
```

Legacy NDJSON from `cursor-agent --output-format stream-json` remains supported when `AGENT_PROVIDER_TRANSPORT=legacy`.
