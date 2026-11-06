const YAML_KEYWORDS = new Set(['null', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n']);

/**
 * Returns a YAML scalar on a single line.
 * Empty values and values with YAML-significant characters are single-quoted. Values containing line breaks or other
 * control characters become an escaped double-quoted scalar (JSON strings are valid YAML), so a value can never add
 * keys or end the shell heredoc the YAML is written through — while multi-line values (e.g. keys) stay intact.
 */
export function quoteYamlScalar(value: string): string {
  if (value === '') {
    return "''";
  }

  if (hasControlCharacter(value)) {
    return JSON.stringify(value);
  }

  // Plain (unquoted) only when YAML reads it back as the same string: identifiers starting with a letter that are not
  // YAML keywords (null / booleans), and canonical integers. Everything else (e.g. `1.10`, `0123`, `1e5`, `0x1F`,
  // `null`, `yes`) is quoted so docker-compose does not reinterpret it.
  if (/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value) && !YAML_KEYWORDS.has(value.toLowerCase())) {
    return value;
  }

  if (/^(0|-?[1-9]\d*)$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * {@link quoteYamlScalar} for values inside docker-compose files: `$` is doubled because compose interpolates
 * `$VAR` / `${VAR}` in every value (quoted or not), which would corrupt secrets or expand host variables.
 */
export function quoteComposeValue(value: string): string {
  return quoteYamlScalar(value.replace(/\$/g, '$$$$'));
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const colonSpaceIndex = trimmed.indexOf(': ');

  if (colonSpaceIndex !== -1) {
    return {
      key: trimmed.slice(0, colonSpaceIndex),
      value: trimmed.slice(colonSpaceIndex + 2),
    };
  }

  if (trimmed.endsWith(':')) {
    return {
      key: trimmed.slice(0, -1),
      value: '',
    };
  }

  const equalsIndex = trimmed.indexOf('=');

  if (equalsIndex !== -1) {
    return {
      key: trimmed.slice(0, equalsIndex),
      value: trimmed.slice(equalsIndex + 1),
    };
  }

  return { key: trimmed, value: '' };
}

export function formatEnvLine(line: string): string | null {
  const parsed = parseEnvLine(line);

  if (!parsed) {
    return null;
  }

  return `${parsed.key}: ${quoteComposeValue(parsed.value)}`;
}

export function formatEnvLines(lines: string[]): string {
  return lines
    .map((line) => {
      const formatted = formatEnvLine(line);

      if (!formatted) {
        return null;
      }

      return `      ${formatted}`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * POSIX shell single-quoted literal (`'…'` with embedded quotes as `'\''`). Line breaks are removed so the value stays
 * one shell word / one line. Use for user-supplied values written into generated scripts (e.g. SSH public keys).
 */
export function shellSingleQuote(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, ' ').trim();

  return `'${singleLine.replace(/'/g, `'\\''`)}'`;
}
