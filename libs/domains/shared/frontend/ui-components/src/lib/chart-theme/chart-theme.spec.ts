import { fpcChartCategoryAxis, fpcChartCategoryStep } from './chart-theme';

describe('fpcChartCategoryStep', () => {
  it('thins a month of days to a few labels on a phone plot', () => {
    // 31 days on a ~230 px plot: 2 labels (110 px each) → every 16th day.
    expect(fpcChartCategoryStep(31, 230)).toBe(16);
  });

  it('caps the labels at maxTicks on wide plots', () => {
    expect(fpcChartCategoryStep(31, 1200, 8)).toBe(4);
  });

  it('draws every label when they fit', () => {
    expect(fpcChartCategoryStep(5, 900)).toBe(1);
    expect(fpcChartCategoryStep(1, 100)).toBe(1);
  });

  it('falls back to maxTicks while the plot width is unknown', () => {
    expect(fpcChartCategoryStep(30, 0, 6)).toBe(5);
  });
});

describe('fpcChartCategoryAxis', () => {
  const days = Array.from({ length: 31 }, (_, i) => `Oct ${i + 1}`);
  const axis = fpcChartCategoryAxis(days, { format: (value) => value.toUpperCase() });
  const w = (gridWidth: number) => ({ layout: { gridWidth } });

  it('keeps every step-th label at render time and blanks the rest', () => {
    expect(axis.labels.formatter('Oct 1', undefined, { i: 0, w: w(230) })).toBe('OCT 1');
    expect(axis.labels.formatter('Oct 2', undefined, { i: 1, w: w(230) })).toBe('');
    expect(axis.labels.formatter('Oct 12', undefined, { i: 11, w: w(230) })).toBe('');
    expect(axis.labels.formatter('Oct 17', undefined, { i: 16, w: w(230) })).toBe('OCT 17');
  });

  it('re-thins for a wider plot (resize): at most 6 labels by default', () => {
    // 1200 px fits 10 slots, capped at 6 labels → every 6th day.
    expect(axis.labels.formatter('Oct 7', undefined, { i: 6, w: w(1200) })).toBe('OCT 7');
    expect(axis.labels.formatter('Oct 5', undefined, { i: 4, w: w(1200) })).toBe('');
  });

  it('sets tickAmount as a fallback cap', () => {
    expect(axis.tickAmount).toBe(6);
  });

  it('keeps the full label for tooltips (no label index)', () => {
    expect(axis.labels.formatter('Oct 2', undefined, {})).toBe('OCT 2');
  });

  it('is an unrotated category axis with the categories', () => {
    expect(axis.type).toBe('category');
    expect(axis.categories).toHaveLength(31);
    expect(axis.labels.rotate).toBe(0);
  });
});
