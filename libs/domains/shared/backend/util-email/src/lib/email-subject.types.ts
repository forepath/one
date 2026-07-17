export type EmailSubjectBuilder = string | ((context: Record<string, unknown>) => string);

export type EmailSubjectRegistry = Record<string, EmailSubjectBuilder>;

export function resolveEmailSubject(
  registry: EmailSubjectRegistry,
  templateKey: string,
  context: Record<string, unknown> = {},
): string {
  const builder = registry[templateKey];

  if (builder == null) {
    throw new Error(`No email subject registered for template key "${templateKey}"`);
  }

  return typeof builder === 'function' ? builder(context) : builder;
}
