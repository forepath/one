/**
 * Metadata extracted from a markdown documentation file
 */
export interface DocMetadata {
  /** File path relative to docs root */
  path: string;
  /** Title extracted from first H1 heading */
  title: string;
  /** Summary extracted from first paragraph */
  summary: string;
  /** All headings in the document with their levels */
  headings: DocHeading[];
  /** Raw markdown content */
  content: string;
  /** Parsed HTML content */
  html?: string;
}

/**
 * Heading information extracted from markdown
 */
export interface DocHeading {
  /** Heading level (1-6) */
  level: number;
  /** Heading text */
  text: string;
  /** Generated anchor ID for the heading */
  id: string;
  /** Line number in source file (optional) */
  lineNumber?: number;
}
