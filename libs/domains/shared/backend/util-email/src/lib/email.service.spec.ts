import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';

import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

describe('EmailService', () => {
  let service: EmailService;
  let mockSendMail: jest.Mock;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail = jest.fn().mockResolvedValue(undefined);
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail } as never);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('when SMTP is disabled (no host or port)', () => {
    beforeEach(async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return false from isEnabled', () => {
      expect(service.isEnabled()).toBe(false);
    });

    it('should return false from send without calling transporter', async () => {
      const result = await service.send({
        to: 'user@example.com',
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(false);
      expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    it('should return false from sendConfirmationEmail without calling transporter', async () => {
      const result = await service.sendConfirmationEmail('user@example.com', 'ABC123');

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should return false from sendWithdrawalConfirmationEmail without calling transporter', async () => {
      const result = await service.sendWithdrawalConfirmationEmail(
        'user@example.com',
        'XYZ789',
        new Date('2026-01-01T15:00:00Z'),
      );

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('when SMTP is enabled', () => {
    beforeEach(async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      process.env.EMAIL_FROM = 'noreply@example.com';
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return true from isEnabled', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('should create transporter without auth when SMTP_USER and SMTP_PASSWORD are not set', () => {
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          ignoreTLS: true,
        }),
      );
      expect(mockCreateTransport).not.toHaveBeenCalledWith(expect.objectContaining({ auth: expect.anything() }));
    });

    it('should send email successfully', async () => {
      const result = await service.send({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Plain text body',
      });

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Plain text body',
        html: 'Plain text body',
      });
    });

    it('should use provided html when given', async () => {
      await service.send({
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Plain',
        html: '<p>HTML body</p>',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<p>HTML body</p>',
        }),
      );
    });

    it('should include attachments when provided', async () => {
      const attachment = { filename: 'invoice.pdf', content: Buffer.from('pdf') };

      await service.send({
        to: 'recipient@example.com',
        subject: 'Invoice',
        text: 'Please find your invoice attached.',
        attachments: [attachment],
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [attachment],
        }),
      );
    });

    it('should convert newlines to br when html not provided', async () => {
      await service.send({
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Line 1\nLine 2',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: 'Line 1<br>Line 2',
        }),
      );
    });

    it('should return false when sendMail throws', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

      const result = await service.send({
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(false);
    });
  });

  describe('sendConfirmationEmail', () => {
    beforeEach(async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      process.env.EMAIL_FROM = 'noreply@example.com';
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should send confirmation email with code in subject body', async () => {
      const result = await service.sendConfirmationEmail('user@example.com', 'A1B2C3');

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Confirm your email',
          text: expect.stringContaining('A1B2C3'),
          html: expect.stringContaining('<strong>A1B2C3</strong>'),
        }),
      );
    });
  });

  describe('sendWithdrawalConfirmationEmail', () => {
    const fixedNow = Date.parse('2026-01-01T12:00:00Z');

    beforeEach(async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      process.env.EMAIL_FROM = 'noreply@example.com';
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should send withdrawal confirmation with plural expiry hours', async () => {
      const expiresAt = new Date('2026-01-01T15:30:00Z');
      const result = await service.sendWithdrawalConfirmationEmail('user@example.com', 'WITH12', expiresAt);

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Confirm your statutory withdrawal',
          text: expect.stringContaining('WITH12'),
          html: expect.stringContaining('<strong>WITH12</strong>'),
        }),
      );
      expect(mockSendMail.mock.calls[0][0].text).toContain('4 hours');
      expect(mockSendMail.mock.calls[0][0].html).toContain('4 hours');
    });

    it('should use singular hour when expiry rounds to one hour', async () => {
      const expiresAt = new Date('2026-01-01T12:30:00Z');

      await service.sendWithdrawalConfirmationEmail('user@example.com', 'WITH12', expiresAt);

      expect(mockSendMail.mock.calls[0][0].text).toContain('1 hour');
      expect(mockSendMail.mock.calls[0][0].text).not.toContain('1 hours');
      expect(mockSendMail.mock.calls[0][0].html).toContain('1 hour');
    });

    it('should never show zero hours when expiry is in the past', async () => {
      const expiresAt = new Date('2026-01-01T11:00:00Z');

      await service.sendWithdrawalConfirmationEmail('user@example.com', 'WITH12', expiresAt);

      expect(mockSendMail.mock.calls[0][0].text).toContain('1 hour');
      expect(mockSendMail.mock.calls[0][0].text).not.toContain('0 hour');
    });

    it('should return false when sendMail throws', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

      const result = await service.sendWithdrawalConfirmationEmail(
        'user@example.com',
        'WITH12',
        new Date('2026-01-01T15:00:00Z'),
      );

      expect(result).toBe(false);
    });
  });

  describe('when SMTP is enabled with authentication', () => {
    beforeEach(async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_USER = 'smtp-user';
      process.env.SMTP_PASSWORD = 'smtp-secret';
      process.env.EMAIL_FROM = 'noreply@example.com';
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should create transporter with auth', () => {
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          ignoreTLS: false,
          auth: { user: 'smtp-user', pass: 'smtp-secret' },
        }),
      );
    });

    it('should send email successfully', async () => {
      const result = await service.send({
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Body',
      });

      expect(result).toBe(true);
    });
  });

  describe('EMAIL_FROM default', () => {
    beforeEach(async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '1025';
      delete process.env.EMAIL_FROM;
      const module: TestingModule = await Test.createTestingModule({
        providers: [EmailService],
      }).compile();

      service = module.get<EmailService>(EmailService);
    });

    it('should use noreply@localhost when EMAIL_FROM not set', async () => {
      await service.send({
        to: 'user@example.com',
        subject: 'Test',
        text: 'Body',
      });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'noreply@localhost' }));
    });
  });
});
