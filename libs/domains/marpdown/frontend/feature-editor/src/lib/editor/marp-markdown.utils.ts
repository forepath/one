export interface MarpMarkdownParts {
  frontmatter: string | null;
  body: string;
}

const DEFAULT_MARP_FRONTMATTER = `marp: true
theme: default
paginate: true`;

export function splitMarpMarkdown(markdown: string): MarpMarkdownParts {
  const lines = markdown.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: null, body: markdown };
  }

  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return { frontmatter: null, body: markdown };
  }

  const frontmatter = lines.slice(1, closingIndex).join('\n');
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n+/, '');

  return { frontmatter, body };
}

export function joinMarpMarkdown(parts: MarpMarkdownParts): string {
  const body = parts.body;

  if (!parts.frontmatter?.trim()) {
    return body;
  }

  return `---\n${parts.frontmatter.trim()}\n---\n${body}`;
}

export function defaultMarpFrontmatter(): string {
  return DEFAULT_MARP_FRONTMATTER;
}

export function countMarpSlides(body: string): number {
  if (!body.trim()) {
    return 1;
  }

  let slideCount = 1;
  let inFence = false;

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && trimmed === '---') {
      slideCount += 1;
    }
  }

  return slideCount;
}

export function disablePaginationInMarkdown(markdown: string): string {
  const parts = splitMarpMarkdown(markdown);

  if (parts.frontmatter === null) {
    return markdown;
  }

  const lines = parts.frontmatter.split('\n');
  let foundPaginate = false;

  const frontmatter = lines
    .map((line) => {
      if (/^\s*paginate\s*:/i.test(line)) {
        foundPaginate = true;
        return 'paginate: false';
      }

      return line;
    })
    .concat(foundPaginate ? [] : ['paginate: false'])
    .join('\n');

  return joinMarpMarkdown({
    frontmatter,
    body: parts.body,
  });
}
