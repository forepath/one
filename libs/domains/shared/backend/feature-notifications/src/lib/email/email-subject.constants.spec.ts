import { IDENTITY_EMAIL_SUBJECTS } from './email-subject.constants';
import { resolveEmailSubject } from '@forepath/shared/backend/util-email';

describe('IDENTITY_EMAIL_SUBJECTS', () => {
  it('resolves confirmation and reset subjects', () => {
    expect(resolveEmailSubject(IDENTITY_EMAIL_SUBJECTS, 'email-confirmation', {})).toBe('Confirm your email');
    expect(resolveEmailSubject(IDENTITY_EMAIL_SUBJECTS, 'password-reset', {})).toBe('Reset your password');
  });
});
