import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BOOTSTRAP_EMAIL_FLAGS,
  BOOTSTRAP_OPTIONS,
  NEW_CLUSTER_ONLY_FLAGS,
  parseLabels,
  readAdminClaimToken,
  readBootstrapEmailSettings,
  RESTORE_ONLY_FLAGS,
  shareThreshold,
  splitPastedShares,
} from './cli';

describe('agent CLI', () => {
  it('parses labels', () => {
    expect(parseLabels(['site=fra1', 'loadweaver.com/role=ingress', 'empty='])).toEqual({
      site: 'fra1',
      'loadweaver.com/role': 'ingress',
      empty: '',
    });
  });

  it('rejects malformed labels', () => {
    expect(() => parseLabels(['novalue'])).toThrow('invalid label');
    expect(() => parseLabels(['bad key=x'])).toThrow('invalid label');
    expect(() => parseLabels(['k=v;rm'])).toThrow('invalid label');
  });

  describe('bootstrap --restore (3.20)', () => {
    it('takes recovery-kit shares as printed text kits, JSON documents or bare share lines', () => {
      const doc = JSON.stringify(
        { format: 'loadweaver-backup-recovery-share', index: 1, threshold: 2, share: 'x' },
        null,
        2,
      );
      const text = `Loadweaver backup recovery kit — share 1 of 3 (any 2 recover the backups)\nKeep this offline.\n\n${doc}\n`;

      expect(splitPastedShares(text)).toEqual([doc]);
      expect(splitPastedShares(`lws1.2.1.0123456789abcdef.AAAA\n  lws1.2.3.0123456789abcdef.BBBB  \nnoise`)).toEqual([
        'lws1.2.1.0123456789abcdef.AAAA',
        'lws1.2.3.0123456789abcdef.BBBB',
      ]);
      expect(splitPastedShares('nothing here')).toEqual([]);
      expect(shareThreshold(doc)).toBe(2);
      expect(shareThreshold('lws1.3.1.0123456789abcdef.AAAA')).toBe(3);
      expect(shareThreshold('???')).toBeNull();
    });

    it('keeps restore-only flags away from a plain bootstrap', () => {
      expect(RESTORE_ONLY_FLAGS).toEqual(expect.arrayContaining(['dr-info', 'share-file', 'kms', 'target-time']));
      expect(RESTORE_ONLY_FLAGS).not.toContain('name');
      expect(BOOTSTRAP_OPTIONS['share-file']).toEqual({ type: 'string', multiple: true });
    });
  });

  describe('bootstrap --admin-claim-token-file', () => {
    it('is a plain bootstrap flag, not restore-only', () => {
      expect(BOOTSTRAP_OPTIONS['admin-claim-token-file']).toEqual({ type: 'string' });
      expect(RESTORE_ONLY_FLAGS).not.toContain('admin-claim-token-file');
    });

    it('reads the token from the file, else from LOADWEAVER_ADMIN_CLAIM_TOKEN', async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'lw-claim-')), 'token');

      writeFileSync(file, 'lwc_from_file\n');
      await expect(readAdminClaimToken(file, { LOADWEAVER_ADMIN_CLAIM_TOKEN: 'lwc_env' })).resolves.toBe(
        'lwc_from_file',
      );
      await expect(readAdminClaimToken(undefined, { LOADWEAVER_ADMIN_CLAIM_TOKEN: 'lwc_env' })).resolves.toBe(
        'lwc_env',
      );
      await expect(readAdminClaimToken(undefined, {})).resolves.toBeUndefined();
      await expect(readAdminClaimToken(undefined, { LOADWEAVER_ADMIN_CLAIM_TOKEN: '  ' })).rejects.toThrow('empty');
    });
  });
  describe('bootstrap email flags', () => {
    it('are new-cluster flags: neither restore-only nor taken by --restore', () => {
      for (const flag of [...Object.keys(BOOTSTRAP_EMAIL_FLAGS), 'smtp-password-file']) {
        expect(BOOTSTRAP_OPTIONS[flag as keyof typeof BOOTSTRAP_OPTIONS]).toEqual({ type: 'string' });
        expect(RESTORE_ONLY_FLAGS).not.toContain(flag);
        expect(NEW_CLUSTER_ONLY_FLAGS).toContain(flag);
      }

      expect(BOOTSTRAP_OPTIONS).not.toHaveProperty('smtp-password');
    });

    it('maps the flags to the control-plane variables and reads the password from a file, else the env', async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'lw-smtp-')), 'password');

      writeFileSync(file, 's3cret pass\n');
      await expect(
        readBootstrapEmailSettings(
          {
            'smtp-host': 'smtp.example.com',
            'smtp-port': '465',
            'smtp-user': 'lw',
            'smtp-password-file': file,
            'email-from': 'Loadweaver <noreply@example.com>',
            'email-company-name': 'Example GmbH',
            'email-company-address': 'Street 1',
          },
          { LOADWEAVER_SMTP_PASSWORD: 'from-env' },
        ),
      ).resolves.toEqual({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'lw',
        SMTP_PASSWORD: 's3cret pass',
        EMAIL_FROM: 'Loadweaver <noreply@example.com>',
        EMAIL_COMPANY_NAME: 'Example GmbH',
        EMAIL_COMPANY_ADDRESS_LINE1: 'Street 1',
      });
      await expect(
        readBootstrapEmailSettings({ 'smtp-host': 'smtp.example.com' }, { LOADWEAVER_SMTP_PASSWORD: 'from-env' }),
      ).resolves.toEqual({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'from-env' });
      await expect(readBootstrapEmailSettings({}, {})).resolves.toBeUndefined();

      writeFileSync(file, '\n');
      await expect(readBootstrapEmailSettings({ 'smtp-password-file': file }, {})).rejects.toThrow('empty');
    });
  });
});
