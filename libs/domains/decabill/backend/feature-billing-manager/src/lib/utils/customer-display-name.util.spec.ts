import { formatCustomerDisplayName, resolveCustomerNamesByUserId } from './customer-display-name.util';

describe('formatCustomerDisplayName', () => {
  it('prefers the company', () => {
    expect(formatCustomerDisplayName({ company: ' Fischer GmbH ', firstName: 'Anna', lastName: 'Fischer' })).toBe(
      'Fischer GmbH',
    );
  });

  it('falls back to first and last name', () => {
    expect(formatCustomerDisplayName({ company: '  ', firstName: 'Anna', lastName: 'Fischer' })).toBe('Anna Fischer');
    expect(formatCustomerDisplayName({ lastName: 'Fischer' })).toBe('Fischer');
  });

  it('returns undefined without a name', () => {
    expect(formatCustomerDisplayName({})).toBeUndefined();
    expect(formatCustomerDisplayName(null)).toBeUndefined();
  });
});

describe('resolveCustomerNamesByUserId', () => {
  it('looks up each user once and maps names by user id', async () => {
    const repository = {
      findByUserIds: jest
        .fn()
        .mockResolvedValue([
          { userId: 'u1', company: 'ACME' },
          { userId: 'u2', firstName: 'Bo', lastName: 'Lee' },
          { userId: 'u3' },
        ]),
    };

    const names = await resolveCustomerNamesByUserId(repository, ['u1', 'u2', 'u1', 'u3', '']);

    expect(repository.findByUserIds).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
    expect(Object.fromEntries(names)).toEqual({ u1: 'ACME', u2: 'Bo Lee' });
  });

  it('returns no names without a repository or ids', async () => {
    expect((await resolveCustomerNamesByUserId(undefined, ['u1'])).size).toBe(0);

    const repository = { findByUserIds: jest.fn() };

    expect((await resolveCustomerNamesByUserId(repository, [])).size).toBe(0);
    expect(repository.findByUserIds).not.toHaveBeenCalled();
  });
});
