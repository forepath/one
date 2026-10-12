# Message Filters

Agenstra evaluates **regex-based message filters** on chat traffic between users and agents. Filters are part of the layered [agent configuration](./agent-configuration.md) under the root key **`message_filters`**, so they follow the same **global → workspace → environment** heredity as other security policy. The previous standalone filter rule APIs and admin page were removed.

## Overview

- **Where they are authored** Console **Agent configuration** (`/agent-config`) for the global layer, and the workspace / environment agent configuration modals in the chat view. Open **Security → Message filters**.
- **Where they are enforced** On the agent manager, synchronously for every chat message. The controller resolves the effective rule list and ships it to the manager with every config sync.
- **No dedicated endpoints** Rules are stored in the layer's config document (`GET/PUT /admin/opencode/config`, `/clients/:id/opencode/config`, `/clients/:id/agents/:agentId/opencode/config`). The old `/filter-rules` (controller) and `/agents-filters` (manager) routes no longer exist.

## Rule shape

Each rule is an object in the `message_filters` array:

| Field         | Required      | Description                                         |
| ------------- | ------------- | --------------------------------------------------- |
| `name`        | yes           | Unique within the layer (max 120 characters)        |
| `pattern`     | yes           | JavaScript regular expression (max 2000 characters) |
| `flags`       | no            | Subset of `g i m s u y d` (default `g`)             |
| `direction`   | no            | `incoming`, `outgoing` or `bidirectional`           |
| `action`      | yes           | `drop`, `replace` or `flag`                         |
| `replacement` | for `replace` | Replacement text (max 2000 characters)              |
| `enabled`     | no            | Set `false` to keep a rule without evaluating it    |

A layer may hold at most 200 rules.

## Layering and precedence

Rules are evaluated **global → workspace → environment**. Lower layers may **append** rules but never remove or edit inherited ones. The **most restrictive outcome wins**:

1. Any matching **`drop`** rule drops the message (the first match by layer precedence is reported).
2. Otherwise every matching **`replace`** rule rewrites the message, in precedence order.
3. Otherwise any matching **`flag`** rule flags the message; content is unchanged.

The whole tab can be locked with the explicit lock `/tabs/message_filters` on the global or workspace layer, exactly like other tabs (see [Agent configuration](./agent-configuration.md#heredity)).

## Validation and ReDoS protection

Workspace managers can author rules that run on every chat message, so patterns are validated on save (UI, API and raw JSON) and again when compiled:

- Invalid regular expressions, unknown keys, unsupported flags and duplicate names are rejected.
- Patterns containing **nested quantifiers** such as `(a+)+`, `(\w*)*` or `(x{1,9})+`, or **repeated groups with overlapping alternatives** such as `(a|aa)+` or `(\w|x)*`, are rejected because they risk catastrophic backtracking. Repeated alternations are accepted when every alternative starts with a distinct literal character (e.g. `(foo|bar)+`).
- `replacement` is mandatory for `replace` rules.

## Notifications and statistics

- A drop or flag publishes the **`message_filter.triggered`** notification (renamed from `filter_rule.triggered`; see [Webhooks](./webhooks.md)).
- Dropped and flagged messages contribute to [Usage Statistics](./usage-statistics.md) (`filter-drops`, `filter-flags`) and are charted on the **Audit** page (`/audit`).
- Saving a layer publishes `agent_config.updated`, including the changed security roots.

## Migration from filter rules

The tables `regex_filter_rules` (manager) and the controller's global rule tables, the `filter-rules-sync` background jobs (`FILTER_RULES_SYNC_*`, their Redis repeatables are removed on startup), the `/filters` console page and the `filter_rules:write` PAT scope were removed.

The database migrations move existing rules automatically:

- **Controller** Global rules become `message_filters` entries on the global layer; workspace-scoped rules are added to each linked workspace layer (named `Migrated rule N (<id>)`, at most 200 per layer). Rules with invalid regexes, unsupported flags or catastrophic-backtracking risk are skipped and listed in the migration log so they can be recreated manually.
- **Manager** Until the controller's first sync after the upgrade, existing agents keep enforcing the manager's legacy rules (copied into the agent's stored message filters).
- **Semantics** The first matching rule by priority no longer decides alone: the **most restrictive outcome wins** (drop > replace > flag) and multiple replace rules chain. Review migrated flag rules that precede drop rules.
- Webhook subscriptions to `filter_rule.triggered` are moved to `message_filter.triggered`; the `filter_rule.created`, `filter_rule.updated` and `filter_rule.deleted` events are no longer emitted (configuration changes publish `agent_config.updated`).
- Upgrade the controller and the agent managers together: an older controller still calls the removed manager filter endpoint.

## Related documentation

- **[Agent Configuration](./agent-configuration.md)** Layers, tabs and locks
- **[Egress Filtering](./egress-filtering.md)** The sibling security policy for outbound web traffic
- **[Chat Interface](./chat-interface.md)** Where filtered traffic originates
- **[Usage Statistics](./usage-statistics.md)** Filter drops and flags metrics
- **[Webhooks](./webhooks.md)** `message_filter.triggered`
- **[Backend Agent Controller](../applications/backend-agent-controller.md)**
- **[Backend Agent Manager](../applications/backend-agent-manager.md)**

## API references

- [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml) `/admin/opencode/config`, `/clients/{id}/opencode/config`, `/clients/{id}/agents/{agentId}/opencode/config`, `/clients/{id}/statistics/filter-drops`, `/clients/{id}/statistics/filter-flags`

---

_For validation limits and exact schemas, use the OpenAPI specifications and the shared `util-opencode-config` library (`message-filters.ts`)._
