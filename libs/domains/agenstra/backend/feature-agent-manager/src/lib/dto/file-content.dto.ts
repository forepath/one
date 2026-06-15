/**
 * DTO for file content response.
 * Content is base64-encoded to support both text and binary files.
 * encoding indicates the original content type: 'utf-8' for text, 'base64' for binary.
 */
export class FileContentDto {
  /**
   * File content as base64-encoded string.
   * For text files, this is the UTF-8 bytes encoded as base64.
   * For binary files, this is the raw bytes encoded as base64.
   */
  content!: string;

  /**
   * Encoding indicator: 'utf-8' for text files, 'base64' for binary files.
   * This helps the client determine how to decode the content.
   */
  encoding!: 'utf-8' | 'base64';
}
