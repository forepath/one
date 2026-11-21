import {
  numberInputValue,
  optionalNumberInput,
  optionalNumberInputValue,
  requiredNumberInput,
} from './optional-number-input.util';

describe('optionalNumberInputValue', () => {
  it('returns empty string for null, undefined, and empty string', () => {
    expect(optionalNumberInputValue(null)).toBe('');
    expect(optionalNumberInputValue(undefined)).toBe('');
    expect(optionalNumberInputValue('')).toBe('');
  });

  it('stringifies numbers from type=number ngModel without throwing', () => {
    expect(optionalNumberInputValue(1.25)).toBe('1.25');
    expect(optionalNumberInputValue(0)).toBe('0');
  });

  it('trims string input', () => {
    expect(optionalNumberInputValue('  3.5  ')).toBe('3.5');
  });
});

describe('numberInputValue / optionalNumberInput / requiredNumberInput', () => {
  it('turns the strings reported by fpc-form-control number inputs into numbers', () => {
    expect(numberInputValue('2')).toBe(2);
    expect(numberInputValue(' 12.5 ')).toBe(12.5);
    expect(numberInputValue('0,75')).toBe(0.75);
    expect(numberInputValue(3)).toBe(3);
  });

  it('maps empty, null and non-numeric input to null / undefined / fallback', () => {
    for (const raw of ['', '  ', null, undefined, 'abc', Number.NaN]) {
      expect(numberInputValue(raw as never)).toBeNull();
      expect(optionalNumberInput(raw as never)).toBeUndefined();
      expect(requiredNumberInput(raw as never)).toBe(0);
      expect(requiredNumberInput(raw as never, 1)).toBe(1);
    }
  });

  it('keeps 0 (not treated as empty)', () => {
    expect(numberInputValue('0')).toBe(0);
    expect(optionalNumberInput('0')).toBe(0);
    expect(requiredNumberInput('0', 5)).toBe(0);
  });
});
