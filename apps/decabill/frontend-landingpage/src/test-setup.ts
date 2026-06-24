import '@angular/localize/init';
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

(
  global as unknown as { $localize?: (messageParts: TemplateStringsArray, ...expressions: unknown[]) => string }
).$localize = (messageParts: TemplateStringsArray, ...expressions: unknown[]) =>
  messageParts.reduce((acc, part, i) => acc + part + (expressions[i] ?? ''), '');

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
