import type { CreateContentReportDto } from '../dto/create-content-report.dto';

import { formatContentReportMessage } from './content-report-message-formatter.utils';

describe('formatContentReportMessage', () => {
  it('formats a DSA notice', () => {
    const dto = {
      reportType: 'dsa',
      turnstileToken: 'token',
      name: 'Alex',
      email: 'alex@example.com',
      explanation: 'Hate speech',
      contentUrls: 'https://example.com/post/1',
      goodFaithConfirmed: true,
      csamAnonymous: false,
    } as CreateContentReportDto;
    const message = formatContentReportMessage(dto);

    expect(message).toContain('DSA Article 16');
    expect(message).toContain('Alex');
    expect(message).toContain('Hate speech');
  });

  it('formats an anonymous DSA notice', () => {
    const dto = {
      reportType: 'dsa',
      turnstileToken: 'token',
      explanation: 'CSAM URL',
      contentUrls: 'https://example.com/x',
      goodFaithConfirmed: true,
      csamAnonymous: true,
    } as CreateContentReportDto;
    const message = formatContentReportMessage(dto);

    expect(message).toContain('Waived (CSAM-eligible anonymous notice)');
  });

  it('formats a TCO removal order', () => {
    const dto = {
      reportType: 'tco',
      turnstileToken: 'token',
      name: 'Officer',
      email: 'authority@example.gov',
      authorityName: 'Example Authority',
      memberState: 'DE',
      officialName: 'Officer',
      officialRole: 'Analyst',
      orderReference: 'TCO-1',
      orderIssuedAt: '2026-09-09T12:00:00Z',
      contentUrls: 'https://example.com/terror',
      statementOfReasons: 'Art. 2 reasons',
      redressInformation: 'Judicial redress available',
      preferredLanguage: 'en',
      emergencyCase: true,
      authorityAttestation: true,
    } as CreateContentReportDto;
    const message = formatContentReportMessage(dto);

    expect(message).toContain('TCO-VO Article 15');
    expect(message).toContain('Example Authority');
    expect(message).toContain('attached');
  });
});
