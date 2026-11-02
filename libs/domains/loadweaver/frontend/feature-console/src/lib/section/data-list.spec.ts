import { DL_API_KEY, DL_DELETED_USER, DL_FLEET_USER, DL_SYSTEM, dlUserLabel } from './data-list';

const ID = '6f1c1b0e-0000-4000-8000-000000000001';

describe('dlUserLabel (user names instead of ids, D11)', () => {
  it('shows the email the API resolved', () => {
    expect(dlUserLabel(ID, 'alice@example.com')).toBe('alice@example.com');
    expect(dlUserLabel(`user:${ID}`, 'alice@example.com')).toBe('alice@example.com');
    expect(dlUserLabel('fleet:f1:carol', 'carol@example.com')).toBe('carol@example.com');
  });

  it('never shows a raw user id: a user id without an email is a deleted user', () => {
    expect(dlUserLabel(ID, null)).toBe(DL_DELETED_USER);
    expect(dlUserLabel(`user:${ID}`)).toBe(DL_DELETED_USER);
    expect(dlUserLabel('fleet:f1:carol', null)).toBe(DL_FLEET_USER);
  });

  it('labels actor keywords and keeps other non-user actors', () => {
    expect(dlUserLabel('api-key')).toBe(DL_API_KEY);
    expect(dlUserLabel('system')).toBe(DL_SYSTEM);
    expect(dlUserLabel('git')).toBe('git');
    expect(dlUserLabel('policy')).toBe('policy');
  });

  it('is empty without an actor', () => {
    expect(dlUserLabel(null)).toBe('');
    expect(dlUserLabel(undefined, null)).toBe('');
  });
});
