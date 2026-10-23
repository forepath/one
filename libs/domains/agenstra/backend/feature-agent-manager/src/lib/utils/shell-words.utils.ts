/**
 * Splits a command line into argv like a POSIX shell would for simple words: single quotes are literal, double
 * quotes and bare words honour backslash escapes, whitespace separates arguments (shared by the agent runtimes).
 */
export function parseShellCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];
    const nextChar = i + 1 < command.length ? command[i + 1] : null;

    if (inSingleQuote) {
      // Inside single quotes: everything is literal except the closing quote
      if (char === "'") {
        inSingleQuote = false;
      } else {
        current += char;
      }
    } else if (inDoubleQuote) {
      // Inside double quotes: backslash escapes next character
      if (char === '\\' && nextChar !== null) {
        current += nextChar;
        i++; // Skip next character as it's escaped
      } else if (char === '"') {
        inDoubleQuote = false;
      } else {
        current += char;
      }
    } else {
      // Not in quotes
      if (char === '\\' && nextChar !== null) {
        // Escaped character
        current += nextChar;
        i++; // Skip next character as it's escaped
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (/\s/.test(char)) {
        // Whitespace: end current argument
        if (current.length > 0) {
          args.push(current);
          current = '';
        }

        // Skip additional whitespace
        while (i + 1 < command.length && /\s/.test(command[i + 1])) {
          i++;
        }
      } else {
        current += char;
      }
    }

    i++;
  }

  // Add final argument if any
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
