# Tickets board

## Swimlanes vs terminal statuses

The board shows four columns: **Draft**, **To do**, **In progress**, and **Prototype**. Root tickets in status **done** or **closed** are not shown in any column (and direct subtasks nested under those roots are hidden with them). Users set **Done** or **Closed** from the ticket detail status control.

## Global search

- Opens from the search button in the board toolbar or **Ctrl+F** while the tickets board is active (when a workspace is selected).
- Scope is **the current workspace only**; the UI filters the ticket list already loaded for that client (no cross-workspace query).
- Matches **title**, **description**, or **ticket id** substring (case-insensitive).
- **Done** and **closed** tickets remain discoverable here after they leave the swimlanes.

Ctrl+F is not captured when focus is in a normal editable control outside the search modal (inputs, textareas, selects, contenteditable). When the search modal is open, Ctrl+F focuses the search field.

## API

Ticket status values include `closed`; see agent-controller OpenAPI `TicketStatus` enum.
