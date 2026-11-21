/**
 * Builds a header-safe `attachment` Content-Disposition for user-supplied file names
 * (uploaded bank statements, receipts). Control characters, quotes and backslashes are
 * removed from the ASCII fallback; the full name is carried RFC 5987-encoded in `filename*`.
 */
export function attachmentDisposition(fileName: string): string {
  const name = (fileName ?? '').normalize('NFC').trim() || 'download';
  // eslint-disable-next-line no-control-regex
  const ascii =
    name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 200) || 'download';
  const encoded = encodeURIComponent(name.slice(0, 200)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
