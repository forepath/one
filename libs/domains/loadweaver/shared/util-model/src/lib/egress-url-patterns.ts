/**
 * URL deny patterns of egress filtering (3.7, `Policy.denyUrlPatterns`): Squid-style regular expressions as Agenstra's
 * egress guard takes them (JavaScript / POSIX ERE syntax, matched case-insensitively anywhere in the plain-HTTP URL
 * `http://host/path?query`), translated to RE2 for the node proxy's RBAC (Envoy full-matches its regexes).
 *
 * The translation keeps the JavaScript meaning of every construct it accepts and refuses everything it can't express
 * exactly (backreferences, lookarounds, empty classes, repetition beyond RE2's limits, programs too big for the
 * proxy): such a pattern is a plan error, never a silently different rule. POSIX bracket classes (`[[:digit:]]`)
 * keep their POSIX meaning, like in Squid, which enforces these patterns in Agenstra's Docker runtime.
 */

export const EGRESS_URL_PATTERN_MAX_LENGTH = 512;
export const EGRESS_URL_PATTERNS_MAX = 500;
/** RE2's own repetition limit. */
const MAX_REPEAT = 1000;
/** Estimated RE2 program size per pattern; the proxy's limit is raised well above it (mesh bootstrap). */
export const EGRESS_URL_PATTERN_MAX_PROGRAM = 2000;
/** The node proxy's RE2 program size limit (runtime `re2.max_program_size.error_level`). */
export const EGRESS_RE2_PROGRAM_LIMIT = 20_000;

/** JavaScript's `\s` (non-unicode mode), spelled out: RE2's `\s` is ASCII only. */
const JS_SPACE =
  '\\t\\n\\v\\f\\r \\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}';
/** JavaScript's `.` without the `s` flag. */
const JS_DOT = '[^\\n\\r\\x{2028}\\x{2029}]';
const POSIX_CLASSES = new Set([
  'alnum',
  'alpha',
  'ascii',
  'blank',
  'cntrl',
  'digit',
  'graph',
  'lower',
  'print',
  'punct',
  'space',
  'upper',
  'word',
  'xdigit',
]);
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

export type EgressUrlPatternTranslation = { ok: true; re2: string; programSize: number } | { ok: false; error: string };

class Untranslatable extends Error {}

const hex = (code: number) => `\\x{${code.toString(16)}}`;

/** A literal character, escaped for RE2 where needed. */
function literal(char: string): string {
  if (ASCII_PUNCTUATION.test(char)) return `\\${char}`;

  const code = char.codePointAt(0) as number;

  return code < 0x20 || code === 0x7f ? hex(code) : char;
}

/** Estimated program size of a literal (case folding doubles letters). */
const literalSize = (char: string) => (/[a-z]/i.test(char) ? 2 : 1);

interface Parsed {
  out: string;
  size: number;
}

/**
 * Translates one pattern; `re2` full-matches every string the JavaScript `new RegExp(pattern, 'i').test()` accepts.
 */
export function translateEgressUrlPattern(pattern: string): EgressUrlPatternTranslation {
  if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, error: 'pattern is empty' };

  if (pattern.length > EGRESS_URL_PATTERN_MAX_LENGTH)
    return { ok: false, error: `pattern exceeds ${EGRESS_URL_PATTERN_MAX_LENGTH} characters` };

  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(pattern))
    return { ok: false, error: 'pattern must not contain whitespace or control characters' };

  try {
    new RegExp(pattern, 'i');
  } catch {
    return { ok: false, error: 'pattern is not a valid regular expression' };
  }

  try {
    const body = new Translator(pattern).run();

    if (body.size > EGRESS_URL_PATTERN_MAX_PROGRAM)
      return { ok: false, error: 'pattern is too complex for the node proxy (repetition or length)' };

    return { ok: true, re2: `(?i)(?s:.*)(?:${body.out})(?s:.*)`, programSize: body.size + 8 };
  } catch (error) {
    if (error instanceof Untranslatable) return { ok: false, error: error.message };

    throw error;
  }
}

/** Plan-time check of a list: one message per pattern that doesn't translate. */
export function egressUrlPatternIssues(patterns: readonly string[]): string[] {
  return patterns.flatMap((p, i) => {
    const result = translateEgressUrlPattern(p);

    return 'error' in result ? [`denyUrlPatterns[${i}]: ${result.error}`] : [];
  });
}

class Translator {
  private i = 0;

  constructor(private readonly src: string) {}

  run(): Parsed {
    const result = this.alternation(0);

    if (this.i < this.src.length) throw new Untranslatable(`unexpected "${this.src[this.i]}"`);

    return result;
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.i + offset];
  }

  private alternation(depth: number): Parsed {
    const branches: Parsed[] = [this.sequence(depth)];

    while (this.peek() === '|') {
      this.i++;
      branches.push(this.sequence(depth));
    }

    return {
      out: branches.map((b) => b.out).join('|'),
      size: branches.reduce((sum, b) => sum + b.size, 0) + branches.length - 1,
    };
  }

  private sequence(depth: number): Parsed {
    let out = '';
    let size = 0;

    while (this.i < this.src.length && this.peek() !== '|' && !(depth > 0 && this.peek() === ')')) {
      const atom = this.atom(depth);
      const quantified = this.quantifier(atom);

      out += quantified.out;
      size += quantified.size;
    }

    return { out, size };
  }

  /** One atom (assertions like `^` and `$` too: JavaScript refuses to quantify them). */
  private atom(depth: number): Parsed {
    const c = this.src[this.i];

    switch (c) {
      case '(': {
        this.i++;

        let open = '(';

        if (this.peek() === '?') {
          if (this.peek(1) !== ':') throw new Untranslatable('lookarounds and named groups are not supported');

          this.i += 2;
          open = '(?:';
        }

        const inner = this.alternation(depth + 1);

        if (this.peek() !== ')') throw new Untranslatable('unbalanced parentheses');

        this.i++;

        return { out: `${open}${inner.out})`, size: inner.size + 2 };
      }
      case '[':
        return this.characterClass();
      case '.':
        this.i++;

        return { out: JS_DOT, size: 1 };
      case '^':
      case '$':
        this.i++;

        return { out: c, size: 1 };
      case '\\':
        return this.escape();
      case '*':
      case '+':
      case '?':
        throw new Untranslatable('nothing to repeat');
      case '{': {
        if (/^\{\d+(,\d*)?\}/.test(this.src.slice(this.i))) throw new Untranslatable('nothing to repeat');

        this.i++;

        return { out: '\\{', size: 1 };
      }
      default:
        this.i += c.length;

        return { out: literal(c), size: literalSize(c) };
    }
  }

  private quantifier(atom: Parsed): Parsed {
    const c = this.peek();
    let out = atom.out;
    let size = atom.size;

    if (c === '*' || c === '+' || c === '?') {
      this.i++;
      out += c;
      size += 2;
    } else if (c === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));

      if (!match) return atom;

      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] === '' ? null : Number(match[3]);

      if (min > MAX_REPEAT || (max !== null && max > MAX_REPEAT))
        throw new Untranslatable(`repetition above ${MAX_REPEAT}`);

      this.i += match[0].length;
      out += match[0];
      size = atom.size * Math.max(1, max ?? min + 1) + 2;
    } else {
      return atom;
    }

    // Lazy quantifiers: the same set of matches (only which one is reported differs).
    if (this.peek() === '?') {
      this.i++;
      out += '?';
    }

    if (this.peek() === '*' || this.peek() === '+' || this.peek() === '?')
      throw new Untranslatable('nothing to repeat');

    return { out, size };
  }

  /** `\x` outside a class. */
  private escape(): Parsed {
    const c = this.peek(1);

    if (c === undefined) throw new Untranslatable('trailing backslash');

    this.i += 2;

    switch (c) {
      case 'd':
      case 'D':
      case 'w':
      case 'W':
        return { out: `\\${c}`, size: 1 };
      case 'b':
      case 'B':
        return { out: `\\${c}`, size: 1 };
      case 's':
        return { out: `[${JS_SPACE}]`, size: 2 };
      case 'S':
        return { out: `[^${JS_SPACE}]`, size: 2 };
      default:
        return this.characterEscape(c, false);
    }
  }

  /** Escapes that stand for one character (shared by atoms and classes). */
  private characterEscape(c: string, inClass: boolean): Parsed {
    switch (c) {
      case 'n':
      case 'r':
      case 't':
      case 'f':
      case 'v':
        return { out: `\\${c}`, size: 1 };
      case '0':
        if (/[0-9]/.test(this.peek() ?? '')) throw new Untranslatable('octal escapes are not supported');

        return { out: hex(0), size: 1 };
      case 'x': {
        const match = /^[0-9a-f]{2}/i.exec(this.src.slice(this.i));

        if (!match) return { out: 'x', size: 2 };

        this.i += 2;

        return { out: hex(parseInt(match[0], 16)), size: 1 };
      }
      case 'u': {
        const match = /^[0-9a-f]{4}/i.exec(this.src.slice(this.i));

        if (!match) return { out: 'u', size: 2 };

        this.i += 4;

        return { out: hex(parseInt(match[0], 16)), size: 1 };
      }
      case 'c': {
        const letter = this.peek();

        if (letter && /[a-z]/i.test(letter)) {
          this.i++;

          return { out: hex(letter.toUpperCase().charCodeAt(0) % 32), size: 1 };
        }

        // `\c` without a letter is a literal backslash followed by `c` in JavaScript.
        return inClass ? { out: '\\\\c', size: 2 } : { out: '\\\\c', size: 3 };
      }
      default:
        if (/[1-9]/.test(c)) throw new Untranslatable('backreferences are not supported');

        // Identity escapes: the character itself.
        return { out: literal(c), size: literalSize(c) };
    }
  }

  /** `[...]`: same members, POSIX classes in POSIX meaning; `[^]` is any character, `[]` nothing (refused). */
  private characterClass(): Parsed {
    this.i++;

    let negated = false;

    if (this.peek() === '^') {
      negated = true;
      this.i++;
    }

    if (this.peek() === ']') {
      this.i++;

      if (negated) return { out: '(?s:.)', size: 1 };

      throw new Untranslatable('empty character class');
    }

    let out = '';
    let size = 1;

    while (this.i < this.src.length && this.peek() !== ']') {
      const c = this.src[this.i];

      if (c === '[' && this.peek(1) === ':') {
        const match = /^\[:([a-z]+):\]/.exec(this.src.slice(this.i));

        if (match && POSIX_CLASSES.has(match[1])) {
          this.i += match[0].length;
          out += match[0];
          size += 2;
          continue;
        }
      }

      if (c === '\\') {
        const e = this.peek(1);

        if (e === undefined) throw new Untranslatable('trailing backslash');

        this.i += 2;

        if (e === 'd' || e === 'D' || e === 'w' || e === 'W') out += `\\${e}`;
        else if (e === 's') out += JS_SPACE;
        else if (e === 'S') throw new Untranslatable('\\S inside a character class is not supported');
        else if (e === 'b') out += hex(8);
        else if (e === 'B') throw new Untranslatable('\\B inside a character class is not supported');
        else out += this.characterEscape(e, true).out;

        size += 1;
        continue;
      }

      if (c === '-') {
        out += '\\-';
        this.i++;
        continue;
      }

      this.i += c.length;
      out += c === '[' || c === '^' ? `\\${c}` : literal(c);
      size += 1;

      // A range: `a-z`.
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        this.i++;
        out += '-';

        const end = this.src[this.i];

        if (end === '\\') {
          const e = this.peek(1) as string;

          if (/[dDwWsSbB]/.test(e)) throw new Untranslatable('class escapes cannot end a range');

          this.i += 2;
          out += this.characterEscape(e, true).out;
        } else if (end === '[' && this.peek(1) === ':') {
          throw new Untranslatable('POSIX classes cannot end a range');
        } else {
          this.i += end.length;
          out += end === '[' || end === '^' ? `\\${end}` : literal(end);
        }
      }
    }

    if (this.peek() !== ']') throw new Untranslatable('unterminated character class');

    this.i++;

    return { out: `[${negated ? '^' : ''}${out}]`, size };
  }
}
