# Project ticket attachments

Decabill project tickets support file attachments below the ticket description.

Attachments are stored through the shared file-storage abstraction in the `projectTicketAttachments` scope and registered in the existing `billing_stored_files` registry, including content hashes and signatures when signing is enabled. Files are visible in the admin File Explorer under `project/tickets/attachments/...`.

## Security

Attachment endpoints require project access in addition to PAT scopes:

- `attachments:read` for listing/downloading.
- `attachments:write` for uploading/deleting metadata.

The API always resolves the project and ticket first; download access is never granted by storage key alone.
