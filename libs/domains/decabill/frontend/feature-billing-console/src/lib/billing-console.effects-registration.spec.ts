import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = join(__dirname, '../../../data-access-billing-console/src/lib/state');
/** Slices whose effects are registered by their contributor module instead of the console routes. */
const REGISTERED_ELSEWHERE = new Set(['container-manager']);

function effectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return REGISTERED_ELSEWHERE.has(entry) ? [] : effectFiles(path);

    return entry.endsWith('.effects.ts') ? [path] : [];
  });
}

describe('billing console effect registration', () => {
  it('registers every functional effect of the data-access slices (an unregistered effect silently drops its action)', () => {
    const routes = readFileSync(join(__dirname, 'billing-console.routes.ts'), 'utf8');
    const registered = routes.slice(routes.indexOf('provideEffects('));
    const missing = effectFiles(STATE_DIR).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/export const (\w+\$) = createEffect/g)]
        .map((match) => match[1])
        .filter((name) => !new RegExp(`\\b${name.replace('$', '\\$')}[,\\s}]`).test(registered)),
    );

    expect(missing).toEqual([]);
  });
});
