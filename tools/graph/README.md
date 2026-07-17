# @forepath/graph

Nx plugin that builds a **knowledge graph** of this monorepo from:

- the Nx project graph (projects + `depends_on`)
- OpenAPI / AsyncAPI specs under project roots
- Markdown docs under `docs/<domain>/`
- NestJS controller ↔ OpenAPI `implements` heuristics

## Generate

```bash
# Preferred (used by pre-commit): build plugin then write graph/
nx run graph:generate-kg

# Or via Nx generator
nx generate @forepath/graph:generate-kg
```

Outputs (committed; refreshed on every pre-commit):

- `graph/graph.json` — nodes and edges
- `graph/graph.html` — simple local viewer (open next to `graph.json`)

Options for the CLI / generator:

- `--outDir=graph` (default)
- `--skipHtml`

## View in the browser

`graph.html` loads `graph.json` via `fetch`, so open it over HTTP (not as a `file://` URL):

```bash
nx run graph:serve
```

Then open [http://127.0.0.1:4211/](http://127.0.0.1:4211/). Optional flags:

```bash
nx run graph:serve -- --port=4300
nx run graph:serve -- --dir=graph
```

## Pre-commit

[`.husky/pre-commit`](../../.husky/pre-commit) runs `nx run graph:generate-kg` and `git add`s the artifacts so they are included in the same commit automatically.

## Agents

See **Knowledge Graph Skill** and `docs/agenstra/ai-agents/knowledge-graph.md`.

## License

This package is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

**Note**: This component is sublicensed under AGPL-3.0, while the rest of the project remains under the MIT License. This means that any modifications or derivative works of this package must also be licensed under AGPL-3.0 and made available to users, including when accessed over a network.
