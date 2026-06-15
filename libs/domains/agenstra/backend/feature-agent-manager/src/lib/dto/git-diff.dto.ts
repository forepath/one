/**
 * DTO for git diff response.
 */
export class GitDiffDto {
  /**
   * File path relative to repository root.
   */
  path!: string;

  /**
   * Original file content (base64-encoded).
   * For binary files, this will be empty or contain size info.
   */
  originalContent!: string;

  /**
   * Modified file content (base64-encoded).
   * For binary files, this will be empty or contain size info.
   */
  modifiedContent!: string;

  /**
   * Encoding: 'utf-8' for text files, 'base64' for binary files.
   */
  encoding!: 'utf-8' | 'base64';

  /**
   * Whether this is a binary file.
   */
  isBinary!: boolean;

  /**
   * Original file size in bytes (for binary files).
   */
  originalSize?: number;

  /**
   * Modified file size in bytes (for binary files).
   */
  modifiedSize?: number;
}
