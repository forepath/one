export const PRESENTATIONS_BATCH_SIZE = 10;
export const PRESENTATION_TITLE_MAX_LENGTH = 500;
export const PRESENTATION_MARKDOWN_FILENAME = 'presentation.md';
export const ASSET_ROOT_PREFIX = 'assets/';
export const PRESENTATION_ASSET_PATH_MAX_LENGTH = 1024;
export const GUEST_EDITOR_PRESENTATION_ID = '__guest__';

export function isGuestEditorPresentationId(id: string | null | undefined): boolean {
  return id === GUEST_EDITOR_PRESENTATION_ID;
}

export enum ExportFormat {
  PDF = 'pdf',
  PPTX = 'pptx',
}

export const DEFAULT_STARTER_MARKDOWN = `---
marp: true
theme: default
paginate: true
---

# New presentation

Start writing your slides here.

---

## Second slide

Use \`---\` to split slides.
`;
