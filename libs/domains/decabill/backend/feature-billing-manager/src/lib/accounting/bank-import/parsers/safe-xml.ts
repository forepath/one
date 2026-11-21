import { BankStatementParseError } from '../bank-import.types';

/**
 * Minimal, hardened, non-validating XML parser for bank statement documents (camt.05x).
 *
 * - No DTD support at all: any `<!DOCTYPE` or `<!ENTITY` is rejected (XXE, billion laughs).
 * - Only the five predefined entities and numeric character references are decoded.
 * - Comments and processing instructions are skipped; CDATA content is kept as text.
 * - Iterative (no recursion) with limits on input size, depth and element count.
 */

export interface XmlElement {
  /** Local name (namespace prefix stripped). */
  name: string;
  /** Namespace URI resolved from `xmlns` declarations (`''` when none applies). */
  namespace: string;
  /** Attributes keyed by local name (`xmlns` declarations keep their qualified name). Null-prototype object. */
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (entities decoded, not trimmed). */
  text: string;
}

export interface XmlParseLimits {
  maxDepth: number;
  maxElements: number;
  /** Maximum input length in characters. */
  maxInputLength: number;
}

export const DEFAULT_XML_PARSE_LIMITS: XmlParseLimits = {
  maxDepth: 64,
  maxElements: 2_000_000,
  maxInputLength: 60 * 1024 * 1024,
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const PREDEFINED_ENTITIES: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
});

/** Prefix → namespace URI in scope (`''` = default namespace). Shared between frames, copied on write. */
type NamespaceScope = ReadonlyMap<string, string>;

const EMPTY_SCOPE: NamespaceScope = new Map<string, string>();

interface Frame {
  element: XmlElement;
  qname: string;
  scope: NamespaceScope;
  textParts: string[];
}

/** Parses an XML document and returns its root element. Throws `BankStatementParseError` on any violation. */
export function parseXml(input: string, limits: Partial<XmlParseLimits> = {}): XmlElement {
  const cfg: XmlParseLimits = { ...DEFAULT_XML_PARSE_LIMITS, ...limits };

  if (input.length > cfg.maxInputLength) {
    throw new BankStatementParseError('XML document exceeds the maximum size');
  }

  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(input)) {
    throw new BankStatementParseError('XML document type declarations and entity definitions are not allowed');
  }

  const len = input.length;
  const stack: Frame[] = [];
  let root: XmlElement | undefined;
  let elementCount = 0;
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (pos < len) {
    const lt = input.indexOf('<', pos);
    const textEnd = lt === -1 ? len : lt;

    if (textEnd > pos) {
      const raw = input.slice(pos, textEnd);
      const top = stack[stack.length - 1];

      if (top) {
        top.textParts.push(decodeXmlEntities(raw, input, pos));
      } else if (raw.trim() !== '') {
        throw xmlError('Text outside of the root element', input, pos);
      }
    }

    if (lt === -1) {
      break;
    }

    if (input.startsWith('<?', lt)) {
      pos = skipPast(input, '?>', lt + 2, 'processing instruction');
      continue;
    }

    if (input.startsWith('<!--', lt)) {
      pos = skipPast(input, '-->', lt + 4, 'comment');
      continue;
    }

    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9);

      if (end === -1) {
        throw xmlError('Unterminated CDATA section', input, lt);
      }

      const top = stack[stack.length - 1];

      if (!top) {
        throw xmlError('CDATA outside of the root element', input, lt);
      }

      top.textParts.push(input.slice(lt + 9, end));
      pos = end + 3;
      continue;
    }

    if (input.startsWith('<!', lt)) {
      throw xmlError('Unsupported markup declaration', input, lt);
    }

    if (input.startsWith('</', lt)) {
      const gt = input.indexOf('>', lt + 2);

      if (gt === -1) {
        throw xmlError('Unterminated end tag', input, lt);
      }

      const qname = input.slice(lt + 2, gt).trim();
      const frame = stack.pop();

      if (!frame || frame.qname !== qname) {
        throw xmlError(`Unexpected end tag </${truncateName(qname)}>`, input, lt);
      }

      frame.element.text = frame.textParts.join('');
      pos = gt + 1;
      continue;
    }

    const tag = readStartTag(input, lt);

    elementCount += 1;

    if (elementCount > cfg.maxElements) {
      throw xmlError('XML document has too many elements', input, lt);
    }

    if (stack.length + 1 > cfg.maxDepth) {
      throw xmlError('XML document is nested too deeply', input, lt);
    }

    const parent = stack[stack.length - 1];
    const scope = namespaceScope(parent?.scope ?? EMPTY_SCOPE, tag.prefixes);
    const element = buildElement(tag, scope, input, lt);

    if (parent) {
      parent.element.children.push(element);
    } else if (root) {
      throw xmlError('XML document has more than one root element', input, lt);
    } else {
      root = element;
    }

    if (!tag.selfClosing) {
      stack.push({ element, qname: tag.qname, scope, textParts: [] });
    }

    pos = tag.end;
  }

  if (stack.length > 0) {
    throw new BankStatementParseError(`Unclosed element <${truncateName(stack[stack.length - 1].qname)}>`);
  }

  if (!root) {
    throw new BankStatementParseError('XML document has no root element');
  }

  return root;
}

interface StartTag {
  qname: string;
  rawAttributes: Array<[string, string]>;
  prefixes?: Map<string, string>;
  selfClosing: boolean;
  end: number;
}

function readStartTag(input: string, lt: number): StartTag {
  const len = input.length;
  let i = lt + 1;
  const nameStart = i;

  while (i < len && !isNameTerminator(input.charCodeAt(i))) {
    i += 1;
  }

  const qname = input.slice(nameStart, i);

  validateQName(qname, input, lt);

  const rawAttributes: Array<[string, string]> = [];
  let prefixes: Map<string, string> | undefined;
  let selfClosing = false;

  for (;;) {
    const before = i;

    i = skipWhitespace(input, i);

    if (i >= len) {
      throw xmlError('Unterminated start tag', input, lt);
    }

    const ch = input[i];

    if (ch === '>') {
      i += 1;
      break;
    }

    if (ch === '/') {
      if (input[i + 1] !== '>') {
        throw xmlError('Malformed empty-element tag', input, i);
      }

      selfClosing = true;
      i += 2;
      break;
    }

    if (i === before) {
      throw xmlError('Attributes must be separated by whitespace', input, i);
    }

    const attrStart = i;

    while (i < len && !isNameTerminator(input.charCodeAt(i))) {
      i += 1;
    }

    const attrName = input.slice(attrStart, i);

    validateQName(attrName, input, attrStart);
    i = skipWhitespace(input, i);

    if (input[i] !== '=') {
      throw xmlError(`Attribute "${truncateName(attrName)}" has no value`, input, attrStart);
    }

    i = skipWhitespace(input, i + 1);

    const quote = input[i];

    if (quote !== '"' && quote !== "'") {
      throw xmlError('Attribute value must be quoted', input, i);
    }

    const close = input.indexOf(quote, i + 1);

    if (close === -1) {
      throw xmlError('Unterminated attribute value', input, i);
    }

    const rawValue = input.slice(i + 1, close);

    if (rawValue.includes('<')) {
      throw xmlError('Attribute values must not contain "<"', input, i);
    }

    const value = decodeXmlEntities(rawValue, input, i + 1).replace(/[\t\n\r]/g, ' ');

    if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) {
      const prefix = attrName === 'xmlns' ? '' : attrName.slice(6);

      if (FORBIDDEN_KEYS.has(prefix)) {
        throw xmlError('Forbidden namespace prefix', input, attrStart);
      }

      prefixes = prefixes ?? new Map<string, string>();
      prefixes.set(prefix, value);
    }

    rawAttributes.push([attrName, value]);
    i = close + 1;
  }

  return { qname, rawAttributes, prefixes, selfClosing, end: i };
}

function buildElement(tag: StartTag, scope: NamespaceScope, input: string, offset: number): XmlElement {
  const attributes = Object.create(null) as Record<string, string>;

  for (const [qname, value] of tag.rawAttributes) {
    const isNamespaceDecl = qname === 'xmlns' || qname.startsWith('xmlns:');
    const key = isNamespaceDecl ? qname : localName(qname);

    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(qname)) {
      throw xmlError('Forbidden attribute name', input, offset);
    }

    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      throw xmlError(`Duplicate attribute "${truncateName(key)}"`, input, offset);
    }

    attributes[key] = value;
  }

  const colon = tag.qname.indexOf(':');
  const prefix = colon === -1 ? '' : tag.qname.slice(0, colon);

  return {
    name: localName(tag.qname),
    namespace: resolveNamespace(prefix, scope),
    attributes,
    children: [],
    text: '',
  };
}

function namespaceScope(parent: NamespaceScope, declared: Map<string, string> | undefined): NamespaceScope {
  if (!declared) {
    return parent;
  }

  const scope = new Map<string, string>(parent);

  declared.forEach((uri, prefix) => scope.set(prefix, uri));

  return scope;
}

function resolveNamespace(prefix: string, scope: NamespaceScope): string {
  if (prefix === 'xml') {
    return XML_NAMESPACE;
  }

  return scope.get(prefix) ?? '';
}

function localName(qname: string): string {
  const colon = qname.indexOf(':');

  return colon === -1 ? qname : qname.slice(colon + 1);
}

function validateQName(qname: string, input: string, offset: number): void {
  if (qname.length === 0) {
    throw xmlError('Missing element or attribute name', input, offset);
  }

  const first = qname.charCodeAt(0);

  // Names must not start with a digit, '-', '.' or ':'.
  if ((first >= 0x30 && first <= 0x39) || first === 0x2d || first === 0x2e || first === 0x3a) {
    throw xmlError(`Invalid name "${truncateName(qname)}"`, input, offset);
  }

  const colon = qname.indexOf(':');

  if (colon !== -1 && (colon === qname.length - 1 || qname.indexOf(':', colon + 1) !== -1)) {
    throw xmlError(`Invalid qualified name "${truncateName(qname)}"`, input, offset);
  }

  for (let i = 0; i < qname.length; i += 1) {
    const code = qname.charCodeAt(i);

    if (code === 0x26 || code === 0x3b || code === 0x21 || code === 0x3f || code < 0x20) {
      throw xmlError(`Invalid name "${truncateName(qname)}"`, input, offset);
    }
  }
}

function isNameTerminator(code: number): boolean {
  return (
    code === 0x20 || // space
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x2f || // /
    code === 0x3e || // >
    code === 0x3d || // =
    code === 0x3c || // <
    code === 0x22 || // "
    code === 0x27 // '
  );
}

function skipWhitespace(input: string, start: number): number {
  let i = start;

  while (i < input.length) {
    const code = input.charCodeAt(i);

    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      break;
    }

    i += 1;
  }

  return i;
}

function skipPast(input: string, terminator: string, from: number, what: string): number {
  const end = input.indexOf(terminator, from);

  if (end === -1) {
    throw xmlError(`Unterminated ${what}`, input, from);
  }

  return end + terminator.length;
}

/**
 * Decodes the five predefined entities and numeric character references. Any other entity reference throws.
 * `input`/`offset` are only used for error locators.
 */
export function decodeXmlEntities(raw: string, input = raw, offset = 0): string {
  let amp = raw.indexOf('&');

  if (amp === -1) {
    return raw;
  }

  let result = '';
  let last = 0;

  while (amp !== -1) {
    const semi = raw.indexOf(';', amp + 1);

    if (semi === -1 || semi - amp > 12) {
      throw xmlError('Malformed entity reference', input, offset + amp);
    }

    const name = raw.slice(amp + 1, semi);
    let decoded: string;

    if (name.startsWith('#')) {
      decoded = decodeCharReference(name, input, offset + amp);
    } else {
      const predefined = PREDEFINED_ENTITIES[name];

      if (predefined === undefined) {
        throw xmlError(`Undefined entity "&${truncateName(name)};"`, input, offset + amp);
      }

      decoded = predefined;
    }

    result += raw.slice(last, amp) + decoded;
    last = semi + 1;
    amp = raw.indexOf('&', last);
  }

  return result + raw.slice(last);
}

function decodeCharReference(name: string, input: string, offset: number): string {
  let codePoint: number;

  if (/^#[0-9]{1,7}$/.test(name)) {
    codePoint = Number(name.slice(1));
  } else if (/^#x[0-9a-fA-F]{1,6}$/.test(name)) {
    codePoint = parseInt(name.slice(2), 16);
  } else {
    throw xmlError('Malformed character reference', input, offset);
  }

  const allowed =
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff);

  if (!allowed) {
    throw xmlError('Character reference to an invalid character', input, offset);
  }

  return String.fromCodePoint(codePoint);
}

function truncateName(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}

function xmlError(message: string, input: string, offset: number): BankStatementParseError {
  let line = 1;
  let index = input.indexOf('\n');

  while (index !== -1 && index < offset) {
    line += 1;
    index = input.indexOf('\n', index + 1);
  }

  return new BankStatementParseError(message, `line ${line}`);
}

/** Follows a path of local names (first match at each level). An empty path returns `el` itself. */
export function child(el: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
  let current = el;

  for (const name of path) {
    if (!current) {
      return undefined;
    }

    current = current.children.find((candidate) => candidate.name === name);
  }

  return current;
}

/** All direct children of `el` with the given local name. */
export function children(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((candidate) => candidate.name === name) : [];
}

/** Trimmed text of the element at `path`, or `undefined` when missing or empty. */
export function textAt(el: XmlElement | undefined, ...path: string[]): string | undefined {
  const text = child(el, ...path)?.text.trim();

  return text ? text : undefined;
}

/** Attribute value by local name. */
export function attributeOf(el: XmlElement | undefined, name: string): string | undefined {
  if (!el || !Object.prototype.hasOwnProperty.call(el.attributes, name)) {
    return undefined;
  }

  return el.attributes[name];
}
