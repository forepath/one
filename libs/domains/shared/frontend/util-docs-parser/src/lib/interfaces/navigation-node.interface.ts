/**
 * Navigation node representing a documentation section or page
 */
export interface NavigationNode {
  /** Display title */
  title: string;
  /** Route path (e.g., '/docs/agenstra/getting-started') */
  path: string;
  /** Source file path relative to docs root (e.g., 'agenstra/getting-started.md') */
  file: string;
  /** Child navigation nodes */
  children?: NavigationNode[];
  /** Optional ordering for manual sorting */
  order?: number;
}

/**
 * Complete navigation tree structure
 */
export interface NavigationTree {
  /** Root sections */
  sections: NavigationNode[];
}
