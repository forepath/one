# File attachments

Agenstra supports attachments on tickets, knowledge pages, and chat prompts.

## Supported objects

- Tickets: attachments appear below the ticket description and are returned in ticket list/detail DTOs.
- Knowledge pages: attachments appear below the page description and are returned in page/tree DTOs.
- Chat prompts and plan refinement: files can be uploaded from the context picker or dropped on the chat input. The message stores attachment metadata and renders a small downloadable card below the user message.

## Storage and agent context

Attachment bytes are stored with the shared file-storage abstraction under the `agenstraAttachments` scope. The database stores only metadata and a generated storage key; user supplied file names are sanitized and never used as path roots.

When a chat prompt references tickets or pages, their attachments are resolved during context enrichment. Explicit chat attachments are resolved the same way. Resolved files are copied to each selected agent container under `/opt/agenstra/context/...`; the manager writes those files as root and hardens them to be readable but not writable by the runtime user.

## Security

All upload, list, and download operations resolve the owning workspace before file access. Downloads require the attachment metadata row and workspace access, so raw storage keys are not exposed as authorization credentials.
