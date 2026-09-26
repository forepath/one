const FILE_EXTENSION_ICON_MAP: Record<string, string> = {
  ts: 'bi-filetype-ts',
  js: 'bi-filetype-js',
  json: 'bi-filetype-json',
  html: 'bi-filetype-html',
  css: 'bi-filetype-css',
  scss: 'bi-filetype-scss',
  md: 'bi-filetype-md',
  yaml: 'bi-filetype-yml',
  yml: 'bi-filetype-yml',
  xml: 'bi-filetype-xml',
  py: 'bi-filetype-py',
  java: 'bi-filetype-java',
  c: 'bi-filetype-c',
  cpp: 'bi-filetype-cpp',
  php: 'bi-filetype-php',
  go: 'bi-filetype-go',
  rs: 'bi-filetype-rs',
  mp3: 'bi-file-earmark-music',
  wav: 'bi-file-earmark-music',
  flac: 'bi-file-earmark-music',
  m4a: 'bi-file-earmark-music',
  aac: 'bi-file-earmark-music',
  oga: 'bi-file-earmark-music',
  ogg: 'bi-file-earmark-music',
  opus: 'bi-file-earmark-music',
  vue: 'bi-filetype-vue',
};

const DEFAULT_FILE_ICON_CLASS = 'bi-file-earmark';

/**
 * Bootstrap Icons class for a file name (e.g. `bi-filetype-ts`).
 */
export function fileIconClassForName(fileName: string): string {
  const baseName = fileName.split('/').pop() || fileName;
  const ext = baseName.includes('.') ? baseName.split('.').pop()?.toLowerCase() : undefined;

  return FILE_EXTENSION_ICON_MAP[ext || ''] || DEFAULT_FILE_ICON_CLASS;
}

/**
 * Icon name without the `bi-` prefix (for `fpc-dropdown-item` / `fpc-icon`).
 */
export function fileIconNameForName(fileName: string): string {
  return fileIconClassForName(fileName).replace(/^bi-/, '');
}
