import type { FpcBrandPalette } from '../brand-tokens/brand-tokens';
import { FPC_GRAPH_STATUS_TONES, FPC_GRAPH_STROKE, fpcGraphStatusDot, fpcGraphStylesheet } from './graph-canvas.styles';

const palette: FpcBrandPalette = {
  isDark: false,
  primary: '#ffc107',
  secondary: '#6c757d',
  success: '#198754',
  warning: '#fd7e14',
  danger: '#dc3545',
  info: '#0dcaf0',
  bodyColor: '#212529',
  bodyBg: '#ffffff',
  secondaryColor: '#6c757d',
  borderColor: '#dee2e6',
  tertiaryBg: '#f8f9fa',
  fontFamily: 'Inter, sans-serif',
  monospaceFontFamily: 'monospace',
};

type Block = { selector: string; style: Record<string, unknown> };

const sheet = (compact = false) => fpcGraphStylesheet(palette, { compact }) as unknown as Block[];
const style = (blocks: Block[], selector: string) => {
  const block = blocks.find((b) => b.selector === selector);

  if (!block) throw new Error(`no block ${selector}`);

  return block.style;
};

describe('fpcGraphStylesheet', () => {
  it('draws structure in neutral greys with hairlines and the app font', () => {
    const blocks = sheet();

    expect(style(blocks, 'node')['font-family']).toBe(palette.fontFamily);
    expect(style(blocks, 'node')['border-color']).toBe(palette.borderColor);
    expect(style(blocks, ':parent')['border-width']).toBe(FPC_GRAPH_STROKE.hairline);
    expect(style(blocks, ':parent')['background-color']).toBe(palette.tertiaryBg);
    // No structural element uses the brand primary or a tone colour.
    for (const kind of ['site', 'node', 'replica', 'stack', 'vm', 'volume', 'hostname', 'address', 'external']) {
      const block = blocks.find((b) => b.selector === `node.fpc-kind-${kind}`);
      const colours = Object.values(block?.style ?? {});

      expect(colours).not.toContain(palette.primary);
      expect(colours).not.toContain(palette.info);
      expect(colours).not.toContain(palette.success);
    }
  });

  it('keeps the brand primary for hover / selection only', () => {
    const blocks = sheet();
    const primaryUsers = blocks.filter((b) => Object.values(b.style).includes(palette.primary)).map((b) => b.selector);

    expect(primaryUsers).toEqual(['node.fpc-hover', 'node:selected', 'edge:selected', 'core']);
  });

  it('marks hover / selection with a primary border only, never a shadow, halo or overlay', () => {
    const blocks = sheet();
    const hover = style(blocks, 'node.fpc-hover');
    const selected = style(blocks, 'node:selected');
    const halo = (s: Record<string, unknown>) =>
      Object.keys(s).filter((key) => /^(underlay|overlay|shadow)-/.test(key) && key !== 'underlay-opacity');

    expect(hover['border-color']).toBe(palette.primary);
    // Hover is a visible 2 px primary border (a hairline vanished at the fitted zoom); selection is thicker still.
    expect(hover['border-width']).toBe(FPC_GRAPH_STROKE.hover);
    expect(hover['border-width']).toBeGreaterThan(FPC_GRAPH_STROKE.hairline);
    expect(selected['border-width']).toBeGreaterThan(hover['border-width'] as number);
    expect(selected['border-color']).toBe(palette.primary);
    expect(selected['border-width']).toBe(FPC_GRAPH_STROKE.selected);
    expect(selected['border-width']).toBeGreaterThan(FPC_GRAPH_STROKE.hairline);
    expect(style(blocks, 'edge:selected')['line-color']).toBe(palette.primary);

    for (const selector of ['node.fpc-hover', 'node:selected', 'edge:selected']) {
      expect(halo(style(blocks, selector))).toEqual([]);
      expect(style(blocks, selector)['underlay-opacity']).toBeUndefined();
    }
    // At rest and while pressed: no underlay / overlay at all.
    expect(style(blocks, 'node')['underlay-opacity']).toBe(0);
    expect(style(blocks, 'node')['overlay-opacity']).toBe(0);
    expect(style(blocks, 'node:active, edge:active')['overlay-opacity']).toBe(0);
    expect(style(blocks, 'core')['active-bg-opacity']).toBe(0);
    expect(JSON.stringify(blocks)).not.toContain('shadow');
  });

  it('draws neutral strokes from the Bootstrap tokens, never white / black literals', () => {
    const blocks = sheet();
    const json = JSON.stringify(blocks).toLowerCase();

    for (const selector of ['node', ':parent', 'node.fpc-kind-replica', 'node.fpc-kind-external']) {
      expect(style(blocks, selector)['border-color']).toBe(palette.borderColor);
    }
    expect(style(blocks, 'edge')['line-color']).toBe(palette.secondaryColor);
    expect(style(blocks, 'edge')['target-arrow-color']).toBe(palette.secondaryColor);
    // `#ffffff` is this palette's body background (status-dot ring, edge label plate), never a stroke.
    for (const literal of ['#000', '#000000', "'white'", "'black'", 'rgba(0', 'rgba(255']) {
      expect(json).not.toContain(literal);
    }
    const strokes = blocks.flatMap((b) =>
      ['border-color', 'line-color', 'target-arrow-color'].map((key) => b.style[key]).filter(Boolean),
    );

    expect(strokes).not.toContain('#ffffff');
    expect(strokes).not.toContain('#000000');
  });

  it('marks status with a small dot per tone, not a fill', () => {
    const blocks = sheet();

    for (const tone of FPC_GRAPH_STATUS_TONES) {
      const s = style(blocks, `node.fpc-status-${tone}`);

      expect(String(s['background-image'])).toContain('data:image/svg+xml');
      expect(s['background-color']).toBeUndefined();
      expect(s['background-width']).toBe(9);
    }
    expect(decodeURIComponent(fpcGraphStatusDot('#dc3545', '#fff'))).toContain("fill='#dc3545'");
  });

  it('mutes edges with one arrowhead and keeps denied flows red', () => {
    const blocks = sheet();

    expect(style(blocks, 'edge')['line-color']).toBe(palette.secondaryColor);
    expect(style(blocks, 'edge')['target-arrow-shape']).toBe('triangle');
    // Straight single edges (the star layout keeps crossings down); parallels fan out as gentle arcs, never loops.
    expect(style(blocks, 'edge')['curve-style']).toBe('bezier');
    expect(style(blocks, 'edge')['control-point-step-size']).toBe(24);
    expect(JSON.stringify(blocks)).not.toMatch(/"curve-style":"(unbundled-bezier|taxi|round-taxi)"/);
    expect(style(blocks, 'edge.fpc-kind-denied')['line-color']).toBe(palette.danger);
  });

  it('tightens container padding in compact density', () => {
    expect(style(sheet(false), ':parent')['padding']).toBe(14);
    expect(style(sheet(true), ':parent')['padding']).toBe(10);
  });
});
