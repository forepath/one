import {
  fpcCompositeColor,
  fpcCssColorAlpha,
  fpcIsDarkTheme,
  fpcObserveBrandChanges,
  fpcReadBrandPalette,
  fpcReadCssColor,
  fpcToHexColor,
  fpcWithAlpha,
} from './brand-tokens';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('brand tokens', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.style.removeProperty('--bs-primary');
    document.documentElement.style.removeProperty('--bs-body-bg');
    document.documentElement.style.removeProperty('--bs-border-color');
    document.documentElement.style.removeProperty('--bs-secondary-color');
  });

  it('normalises CSS colours to #rrggbb', () => {
    expect(fpcToHexColor('#ABC')).toBe('#aabbcc');
    expect(fpcToHexColor('#d4a72c')).toBe('#d4a72c');
    expect(fpcToHexColor('#d4a72c80')).toBe('#d4a72c');
    expect(fpcToHexColor('rgb(13, 110, 253)')).toBe('#0d6efd');
    expect(fpcToHexColor('rgba(255 0 0 / 0.5)')).toBe('#ff0000');
    expect(fpcToHexColor('color(srgb 1 0.5 0)')).toBe('#ff8000');
    expect(fpcToHexColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(fpcToHexColor('')).toBeNull();
  });

  it('reads CSS variables with fallbacks', () => {
    expect(fpcReadCssColor('--bs-primary', '#123456')).toBe('#123456');

    document.documentElement.style.setProperty('--bs-primary', '#d4a72c');
    expect(fpcReadCssColor('--bs-primary', '#123456')).toBe('#d4a72c');
    expect(fpcReadBrandPalette().primary).toBe('#d4a72c');
  });

  it('detects dark mode and switches fallbacks', () => {
    expect(fpcIsDarkTheme()).toBe(false);
    expect(fpcReadBrandPalette().bodyBg).toBe('#ffffff');

    document.documentElement.setAttribute('data-bs-theme', 'dark');
    expect(fpcIsDarkTheme()).toBe(true);
    expect(fpcReadBrandPalette().isDark).toBe(true);
    expect(fpcReadBrandPalette().bodyBg).toBe('#212529');
  });

  it('reads the alpha of CSS colours', () => {
    expect(fpcCssColorAlpha('rgba(255, 255, 255, 0.08)')).toBeCloseTo(0.08);
    expect(fpcCssColorAlpha('rgb(15 15 17 / 10%)')).toBeCloseTo(0.1);
    expect(fpcCssColorAlpha('color(srgb 1 1 1 / 0.5)')).toBeCloseTo(0.5);
    expect(fpcCssColorAlpha('#00000080')).toBeCloseTo(0.5, 2);
    expect(fpcCssColorAlpha('rgb(1, 2, 3)')).toBe(1);
    expect(fpcCssColorAlpha('#123456')).toBe(1);
  });

  it('flattens translucent colours onto a background', () => {
    expect(fpcCompositeColor('rgba(255, 255, 255, 0.08)', '#0f0f11')).toBe('#222224');
    expect(fpcCompositeColor('rgba(15, 15, 17, 0.1)', '#ffffff')).toBe('#e7e7e7');
    expect(fpcCompositeColor('#d4a72c', '#ffffff')).toBe('#d4a72c');
    expect(fpcCompositeColor('nope', '#ffffff')).toBeNull();
  });

  it('flattens translucent border / secondary tokens onto the body background (no pure white / black)', () => {
    const root = document.documentElement.style;

    root.setProperty('--bs-body-bg', '#0f0f11');
    root.setProperty('--bs-border-color', 'rgba(255, 255, 255, 0.08)');
    root.setProperty('--bs-secondary-color', 'rgba(255, 255, 255, 0.5)');

    const palette = fpcReadBrandPalette();

    expect(palette.borderColor).toBe('#222224');
    expect(palette.secondaryColor).toBe('#878788');
    // Without a background the alpha is dropped (other callers keep their behaviour).
    expect(fpcReadCssColor('--bs-border-color', '#000000')).toBe('#ffffff');
  });

  it('appends alpha bytes', () => {
    expect(fpcWithAlpha('#0d6efd', 0.5)).toBe('#0d6efd80');
    expect(fpcWithAlpha('#0d6efd', 1)).toBe('#0d6efdff');
  });

  it('notifies about theme / brand attribute changes until disposed', async () => {
    const callback = jest.fn();
    const dispose = fpcObserveBrandChanges(callback);

    document.documentElement.setAttribute('data-bs-theme', 'dark');
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute('data-fpc-brand', 'loadweaver');
    await flush();
    expect(callback).toHaveBeenCalledTimes(2);

    document.documentElement.setAttribute('class', 'unrelated');
    dispose();
    document.documentElement.setAttribute('data-bs-theme', 'light');
    await flush();
    expect(callback).toHaveBeenCalledTimes(2);
    document.documentElement.removeAttribute('data-fpc-brand');
    document.documentElement.removeAttribute('class');
  });
});
