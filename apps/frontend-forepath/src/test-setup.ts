import '@angular/localize/init';
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

(
  global as unknown as { $localize?: (messageParts: TemplateStringsArray, ...expressions: unknown[]) => string }
).$localize = (messageParts: TemplateStringsArray, ...expressions: unknown[]) =>
  messageParts.reduce((acc, part, i) => acc + part + (expressions[i] ?? ''), '');

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
