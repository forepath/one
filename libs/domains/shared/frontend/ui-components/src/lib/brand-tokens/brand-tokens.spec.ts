import {
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
