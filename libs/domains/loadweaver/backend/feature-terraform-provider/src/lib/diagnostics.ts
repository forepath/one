/** A `tfplugin6.Diagnostic` (plain object for the protobuf encoder). */
export interface Diagnostic {
  /** 1 = error, 2 = warning. */
  severity: 1 | 2;
  summary: string;
  detail?: string;
  attribute?: { steps: { attribute_name?: string; element_key_string?: string }[] };
}

export function error(summary: string, detail?: string): Diagnostic {
  return { severity: 1, summary, ...(detail ? { detail } : {}) };
}

export function warning(summary: string, detail?: string): Diagnostic {
  return { severity: 2, summary, ...(detail ? { detail } : {}) };
}

export function attributeError(attribute: string, summary: string, detail?: string): Diagnostic {
  return { ...error(summary, detail), attribute: { steps: [{ attribute_name: attribute }] } };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 1);
}
