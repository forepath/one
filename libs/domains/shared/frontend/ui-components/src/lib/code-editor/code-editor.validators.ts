import { isNode, LineCounter, parseDocument, type YAMLError } from 'yaml';

export type FpcCodeDiagnosticSeverity = 'error' | 'warning' | 'info';

/** A problem in the editor text. Lines and columns are 1-based; `end*` default to the end of the line. */
export interface FpcCodeDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: FpcCodeDiagnosticSeverity;
}

/** Validates the editor text. Called on load and (debounced) after every change. */
export type FpcCodeEditorValidator = (value: string, language: string) => readonly FpcCodeDiagnostic[];

/**
 * A structural issue reported against the parsed document, located by its path
 * (e.g. `['services', 0, 'image']`). Typically produced from a JSON Schema check in the consumer.
 */
export interface FpcDocumentIssue {
  path: readonly (string | number)[];
  message: string;
  severity?: FpcCodeDiagnosticSeverity;
}

/** Checks the parsed document (plain JS value) and returns issues by path. */
export type FpcDocumentValidator = (document: unknown) => readonly FpcDocumentIssue[];

type ParsedDocument = ReturnType<typeof parseDocument>;

function rangeDiagnostic(
  lineCounter: LineCounter,
  start: number,
  end: number,
  message: string,
  severity: FpcCodeDiagnosticSeverity,
): FpcCodeDiagnostic {
  const from = lineCounter.linePos(start);
  const to = lineCounter.linePos(Math.max(end, start + 1));

  return { line: from.line, column: from.col, endLine: to.line, endColumn: to.col, message, severity };
}

function yamlErrorDiagnostic(
  lineCounter: LineCounter,
  error: YAMLError,
  severity: FpcCodeDiagnosticSeverity,
): FpcCodeDiagnostic {
  return rangeDiagnostic(lineCounter, error.pos[0], error.pos[1], error.message, severity);
}

/** Source range of the node at `path`, falling back to the closest existing ancestor. */
function rangeForPath(doc: ParsedDocument, path: readonly (string | number)[]): [number, number] | null {
  for (let length = path.length; length >= 0; length--) {
    const node = length === 0 ? doc.contents : doc.getIn(path.slice(0, length), true);

    if (isNode(node) && node.range) {
      return [node.range[0], node.range[1]];
    }
  }

  return null;
}

function documentDiagnostics(
  doc: ParsedDocument,
  lineCounter: LineCounter,
  validateDocument: FpcDocumentValidator | undefined,
): FpcCodeDiagnostic[] {
  if (!validateDocument) {
    return [];
  }

  let value: unknown;

  try {
    value = doc.toJS();
  } catch (error) {
    return [
      {
        line: 1,
        column: 1,
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      },
    ];
  }

  return validateDocument(value).map((issue) => {
    const range = rangeForPath(doc, issue.path) ?? [0, 0];
    const location = issue.path.length ? `${issue.path.join('.')}: ` : '';

    return rangeDiagnostic(lineCounter, range[0], range[1], `${location}${issue.message}`, issue.severity ?? 'error');
  });
}

/**
 * Validator for YAML: reports syntax errors / warnings of the `yaml` parser and, when the text
 * parses, the issues of `validateDocument` positioned at the offending node.
 */
export function fpcYamlValidator(validateDocument?: FpcDocumentValidator): FpcCodeEditorValidator {
  return (text) => {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, prettyErrors: false });
    const syntax = [
      ...doc.errors.map((error) => yamlErrorDiagnostic(lineCounter, error, 'error')),
      ...doc.warnings.map((warning) => yamlErrorDiagnostic(lineCounter, warning, 'warning')),
    ];

    if (doc.errors.length) {
      return syntax;
    }

    return [...syntax, ...documentDiagnostics(doc, lineCounter, validateDocument)];
  };
}

function jsonSyntaxDiagnostic(text: string, error: unknown): FpcCodeDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = /line (\d+) column (\d+)/i.exec(message);

  if (lineColumn) {
    return { line: Number(lineColumn[1]), column: Number(lineColumn[2]), message, severity: 'error' };
  }

  const position = /position (\d+)/i.exec(message);
  const offset = position ? Math.min(Number(position[1]), text.length) : text.length;
  const before = text.slice(0, offset).split('\n');

  return { line: before.length, column: before[before.length - 1].length + 1, message, severity: 'error' };
}

/**
 * Validator for JSON: strict `JSON.parse` syntax check, then `validateDocument` issues positioned
 * via the (JSON-compatible) YAML parser.
 */
export function fpcJsonValidator(validateDocument?: FpcDocumentValidator): FpcCodeEditorValidator {
  return (text) => {
    if (!text.trim()) {
      return [];
    }

    try {
      JSON.parse(text);
    } catch (error) {
      return [jsonSyntaxDiagnostic(text, error)];
    }

    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, prettyErrors: false });

    return documentDiagnostics(doc, lineCounter, validateDocument);
  };
}
