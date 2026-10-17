import '@angular/localize/init';
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

// Angular i18n: required when tests load code that uses $localize (e.g. cookie consent config)
(
  global as unknown as { $localize?: (messageParts: TemplateStringsArray, ...expressions: unknown[]) => string }
).$localize = (messageParts: TemplateStringsArray, ...expressions: unknown[]) =>
  messageParts.reduce((acc, part, i) => acc + part + (expressions[i] ?? ''), '');

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
