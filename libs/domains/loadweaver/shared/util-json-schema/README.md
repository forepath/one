# loadweaver-shared-util-json-schema

A small, dependency-free JSON Schema (draft 2020-12) checker for the subset Loadweaver publishes: the resource
schemas edited in the console (3.16, 3.29) and the frozen agent-protocol snapshots the contract tests check
control-plane messages against (3.26). Shared so frontend, backend and shared libraries can use the same checker.

## Running unit tests

Run `nx test loadweaver-shared-util-json-schema` to execute the unit tests via [Jest](https://jestjs.io).
