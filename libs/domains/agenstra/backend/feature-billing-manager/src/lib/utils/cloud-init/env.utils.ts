/**
 * Returns a YAML scalar safe for docker-compose `environment:` key-value entries.
 * Empty values and values with YAML-significant characters are single-quoted.
 */
export function quoteYamlScalar(value: string): string {
  if (value === '') {
    return "''";
  }

  if (/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    return value;
  }

  if (/^-?\d+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "''")}'`;
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

  return `${parsed.key}: ${quoteYamlScalar(parsed.value)}`;
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
