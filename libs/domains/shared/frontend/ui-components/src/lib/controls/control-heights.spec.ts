/**
 * @jest-environment node
 */
import { join } from 'node:path';

import { compile } from 'sass';

// The shared control-height scale lives in a global partial (`styles/_controls.scss`), so the
// contract is checked on the compiled CSS: tokens, density steps and which selectors consume them.
describe('control height scale (styles/_controls.scss)', () => {
  const css = compile(join(__dirname, '../../../styles/_controls.scss')).css;
  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);

    expect(start).toBeGreaterThanOrEqual(0);

    return css.slice(start, css.indexOf('}', start));
  };

  it('defines comfortable tokens at the natural btn / form-control metrics of the shared chrome', () => {
    const root = block(':root');

    // sm: 0.765625rem * 1.5 + 2 * 0.375rem + 2px; md: 0.875rem * 1.5 + 2 * 0.5625rem + 2px.
    expect(root).toContain('--fpc-control-height-sm: 2.0234375rem');
    expect(root).toContain('--fpc-control-height-md: 2.5625rem');
    expect(root).toContain('--fpc-control-height-lg: 3.265625rem');
    expect(root).toContain('--fpc-control-height-header: 2.35rem');
  });

  it('steps every tier down in compact density', () => {
    const compact = block('body.fpc-density-compact');

    expect(compact).toContain('--fpc-control-height-sm: 1.875rem');
    expect(compact).toContain('--fpc-control-height-md: 2.25rem');
    expect(compact).toContain('--fpc-control-height-header: 2.125rem');
  });

  it('maps sm controls in page / object headers to the header tier, but not inside their menus', () => {
    expect(block('.fpc-page-header,\n.fpc-object-header__head')).toContain(
      '--fpc-control-height-sm: var(--fpc-control-height-header)',
    );
    expect(css).toMatch(/\.fpc-page-header \.dropdown-menu,[^{]*\{\s*--fpc-control-height-sm: 2\.0234375rem/);
  });

  it('derives button, field and pagination padding from the resolved tier', () => {
    expect(block('.btn')).toContain('--fpc-control-h: var(--fpc-control-height-md)');
    expect(block('.btn')).toContain('--bs-btn-padding-y: max(');
    expect(block('.btn-sm')).toContain('--fpc-control-h: var(--fpc-control-height-sm)');
    expect(css).toMatch(
      /\.form-select:not\(\[multiple\], \[size\]\)\.form-select-sm[^{]*\{\s*--fpc-control-h: var\(--fpc-control-height-sm\)/,
    );
    expect(css).toMatch(
      /\.form-control:not\([^)]*\)\.form-control-sm[^{]*\{\s*--fpc-control-h: var\(--fpc-control-height-sm\)/,
    );
    expect(block('.pagination')).toContain('--bs-pagination-padding-y: max(');
    expect(block('.pagination-sm')).toContain('--fpc-control-h: var(--fpc-control-height-sm)');
    expect(block('.pagination .page-link')).toContain('min-height: var(--fpc-control-h)');
  });
});
