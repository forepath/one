export function formatEnvLines(lines: string[]): string {
  return lines
    .map((line) => {
      line = line.trim();

      if (line.length === 0) return null;

      return `      ${line}`;
    })
    .filter((line) => line !== null)
    .join('\n');
}
