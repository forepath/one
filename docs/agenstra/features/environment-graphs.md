# Environment graphs

Environment graphs index what an environment (agent) contains and which context its prompts had. They answer questions
such as "which modules exist and how do they depend on each other", "where is the documentation for this file",
"which instructions and skills does this environment load implicitly", and "which tickets, pages and files did this
prompt use or change".

The graphs are built by Agenstra itself: lightweight scanners for imports, symbols, manifests and Markdown structure.
No third-party graph generator is involved.

There are three scopes:

| Scope       | Held by          | Content                                                                                                                                                                                                 |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment | agent-manager    | `code` layer (modules, files, symbols, imports, packages, docs, concepts, instruction files), `paths` layer (directory tree with sizes, mount), `references` layer (prompts → context)                  |
| Workspace   | agent-manager    | Composed on request from the workspace's environments (never stored); node ids are prefixed with the environment id, environments that used each other's mounts are linked                              |
| Global      | agent-controller | One persisted metadata snapshot per workspace (environments, top modules, languages, knowledge pages and relations, tickets, plans); the global graph is the union of the snapshots a caller may access |

Graph data never reaches the environment's container. The manager streams files out of the worker read-only and parses
them in memory, and stores the results in its own database (`agent_graphs`, `agent_graph_prompts`). The controller
stores workspace snapshots in `workspace_graph_snapshots`.

## Building environment graphs

- **Startup:** after the agent-manager starts (and so after every upgrade), it rebuilds the graph of every environment
  that has a worker. This happens `AGENT_GRAPH_STARTUP_DELAY_MS` after start (default 30 s), and environments whose
  worker is not ready yet are retried once after 2 minutes. Set `AGENT_GRAPH_STARTUP_REBUILD=false` to skip it.

  The controller API rebuilds every workspace snapshot `AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS` after start (default
  3 minutes, so the managers finish first). Set `AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD=false` to skip it. Worker and
  scheduler processes skip this.

- **Lazy:** an environment without a graph (for example, one created after startup) builds it on its first query.
- **Change signals:** file system changes (the workspace index rebuild signal) and finished turns mark a built graph
  stale. It is rebuilt after 45 s without further changes, and at most every 2 minutes per environment. Environments
  nobody has looked at are not indexed in the background.
- **Manual:** the **Refresh** button in the console, `POST /api/clients/:id/agents/:agentId/graph/refresh`, or the
  agent's `agenstra_graph_refresh` tool.
- At most two builds run at once per manager.

A build runs two read-only commands in the worker, as the workspace user (`agenstra`):

1. A `find` listing of the working directory (`/app`). Dependency, build and cache directories such as
   `node_modules`, `dist`, `.git` and `.venv` are listed but not walked.
2. `tar` streams of the files worth parsing: manifests, instruction files, source code and docs. They are batched, and
   archive members are read in memory and never extracted. Symbolic links are not followed.

Files whose size and modification time did not change reuse their earlier scan result, so rebuilds only stream
changed files. Only structure is kept: import specifiers, symbol names, headings and links. File contents are not
stored.

**Not parsed:** credentials and secrets (`.env*`, keys, certificates, `*secret*`, `*credential*`, `.npmrc`,
`.netrc`, `auth.json`, …). They only appear by name in the paths layer.

| Limit               | Value               |
| ------------------- | ------------------- |
| Listed files        | 50,000              |
| Parsed files        | 8,000               |
| Bytes per file      | 512 KiB             |
| Bytes per build     | 64 MiB              |
| Prompt records kept | 500 per environment |

When a limit is hit, the graph is marked `truncated`.

### Code layer

| Node              | From                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module`          | Manifest directories: `package.json`, `project.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pom.xml`, Gradle, `.csproj`, `composer.json`, `Gemfile`, `pubspec.yaml`, `mix.exs` |
| `file` / `symbol` | Source files and their top-level declarations (TS/JS, Python, Go, Java/Kotlin/Scala, Rust, C#, PHP, Ruby, C/C++, Swift, Dart, Elixir, Lua, shell)                                   |
| `package`         | External dependencies (manifests and unresolved imports)                                                                                                                            |
| `doc` / `concept` | Markdown files and their level 1–2 headings                                                                                                                                         |
| `instruction`     | `AGENTS.md`, `CLAUDE.md`, rules (`.cursor/rules`, `*.mdc`, …), skills and commands (`.opencode`, `.claude`, `.agenstra`)                                                            |

**Edges:**

- `contains`
- `imports` (relative paths, tsconfig path aliases, local package names, Go modules, Java/C# namespaces, Rust `crate::`)
- `depends_on` (manifests)
- `defines`
- `links_to` and `documents` (Markdown links and path mentions)
- `written_in`

Heuristic edges are tagged with `confidence: inferred`. Nodes are clustered into communities by label propagation, and
the overview lists the largest communities and the most connected nodes (hubs).

### References layer

Each prompt (turn) records:

| Kind        | What                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attached`  | Explicit context injection: tickets, knowledge pages, plans, attachments, selected environments, the workspace mount                                                                                                        |
| `available` | Implicit context: instruction files found in the working directory, plus the names of the instructions, skills, MCP servers, commands, agents and plugins of the effective OpenCode configuration (captured on config sync) |
| `used`      | Tool calls: files read, directories searched, skills / sub-agents / MCP servers used, context elements read with `agenstra_context_get`                                                                                     |
| `modified`  | Files changed by edit / write / patch tools, tickets and pages changed with `agenstra_content_*`                                                                                                                            |

Only references are recorded: ids, names and paths. Tool arguments such as shell commands, search patterns and URLs
are dropped, and so are context contents. Paths below `/opt/workspace/<mount id>` link environments to each other.

## Layers and paging

| Layer        | Environment | Workspace / global | Content                                                                                                             |
| ------------ | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `all`        | yes         | yes (default)      | Every layer merged. Node ids are shared, so a file links its imports, its directory and the prompts that touched it |
| `code`       | yes         | yes                | Code and knowledge structure                                                                                        |
| `paths`      | yes         | yes                | Directory tree                                                                                                      |
| `references` | yes         | yes                | Prompts and their context                                                                                           |
| `knowledge`  | –           | yes                | The controller's metadata snapshots: knowledge pages, tickets, plans, environment summaries                         |

Graph documents are paginated with `offset` / `limit`, like the other paginated lists. Nodes come in a stable rank
order: workspaces, environments and modules first, then by degree. Every page carries the edges between its nodes and
the nodes of earlier pages, so all pages together are exactly the graph. Each response names the next page in
`nextOffset`, which is `null` on the last page. Workspace and global views are built once per first page and kept for
a minute, so the following pages share one composition.

## Console

The **Graphs** page (`/graphs/:clientId`, sidebar **Graphs**) has three scopes:

- **Environment:** environment picker and build status with Rebuild.
- **Workspace:** the composed graph of the workspace's environments. The knowledge snapshot can be refreshed when it
  is part of the layer.
- **Global:** every workspace you can access.

Every scope offers the layer picker (default **All**) and a node limit (default **All**). The **All** node limit
loads every page in turn; the canvas shows the graph once every page has arrived (it is laid out once, not per page).
The canvas viewer filters by type, highlights search matches, shows the neighbourhood around the selection, and
expands neighbours from the server.

The viewer stays responsive at any graph size (tested with 1,000,000 nodes and 2,000,000 edges):

- Layout and the spatial index run in a Web Worker; documents are taken into the viewer in small time slices.
- A frame only draws what is in view. When more nodes are in view than can be drawn individually (about 12,000), the
  viewer shows an **overview**: nearby nodes are grouped into cells. Each cell shows how many nodes it holds (size),
  which types they are (slices) and how strongly it is connected to other cells (aggregated edges, darker = more
  edges). Hover a cell for its exact counts per type, click it to zoom in. The grouping depends only on the zoom.
- Selection, search matches and the hovered node are always drawn at their real position, also in the overview.
- On slow devices, edges and labels are thinned while panning and zooming; the complete frame is drawn as soon as the
  view rests.

The side panel shows:

- a live server search over all nodes of the environment
- the selected node's attributes and incoming / outgoing relations, as full-width tables with their own search
- the absolute path
- with prompt references in the layer, the prompts and their attached, available, used and modified references

## Agent tools (`agenstra_graph_*`)

Served by the platform `agenstra` MCP server (`/api/agent-context/graphs`, per-agent context token, no context ticket
required):

| Tool                 | Purpose                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `graph_environments` | Environments whose graphs the agent can read, with status and mount paths             |
| `graph_overview`     | Modules, hubs, communities, instruction files, latest prompts                         |
| `graph_search`       | Find nodes by name or path; `environment: "*"` searches all reachable ones            |
| `graph_node`         | One node with incoming and outgoing relations                                         |
| `graph_neighbors`    | 1–3 hop neighbourhood, optionally by edge type                                        |
| `graph_path`         | Shortest connection between two nodes                                                 |
| `graph_file`         | Symbols, imports, importers, docs and prompts of one file (absolute or relative path) |
| `graph_references`   | Prompt reference history / one prompt's references                                    |
| `graph_refresh`      | Rebuild the own graph                                                                 |

The tools are read-only and allowed in plan sessions.

## Security

**Users**

- Environment and workspace routes require workspace access (`ensureClientAccess`). Environment routes are also
  covered by the membership check: environments outside the workspace answer 404.
- The workspace graph is composed from the members the controller resolves itself, never from request input.
- The global graph is the union of the snapshots of workspaces the caller can access. API keys and non-PAT admins see
  all workspaces.

**PATs** need `graph:read` (`graph:write` for refreshes), plus the scopes of the data they would otherwise expose:

- `agent_files:read` for code and path layers
- `agent_chats:read` for prompt references
- In snapshots and the global graph, ticket, knowledge, plan and module nodes are left out without `tickets:read`,
  `knowledge:read`, `agent_chats:read` or `agent_files:read`.

**Agents**

- Agents read the code and paths layers of their own environment and of every environment mounted read-only below
  `/opt/workspace` on the same host. That is exactly what the read-only `/opt/agents` bind already exposes. An
  environment without that mount only sees its own graph.
- Other environments of the same host that are not workspace peers stay anonymous: they are identified by mount id
  only, and their names are neither shown nor resolvable.
- Prompt reference graphs are limited to the own environment and controller-verified workspace peers. For peers, prompt
  excerpts are removed and ticket, page and plan titles are replaced by their refs, which the agent can resolve through
  `agenstra_context_*` under its own grants.
- Graph builds run as the unprivileged workspace user, write nothing into the container, and never follow symbolic
  links.
