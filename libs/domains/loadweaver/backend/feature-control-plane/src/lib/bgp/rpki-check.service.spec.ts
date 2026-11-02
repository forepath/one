import { RpkiCheckService } from './rpki-check.service';

describe('RpkiCheckService', () => {
  it('turns ROA states into plan warnings and never fails a plan', async () => {
    const service = new RpkiCheckService();
    const statuses: Record<string, string> = {
      '203.0.113.0/24': 'valid',
      '198.51.100.0/24': 'invalid_asn',
      '192.0.2.0/24': 'unknown',
    };

    service.fetchImpl = async (url: string) => {
      const prefix = decodeURIComponent(new URL(url).searchParams.get('prefix') ?? '');

      if (prefix === '10.0.0.0/8') throw new Error('offline');

      expect(url.startsWith('https://stat.ripe.net/data/rpki-validation/data.json?resource=AS64500&')).toBe(true);

      return new Response(JSON.stringify({ data: { status: statuses[prefix] } }));
    };

    expect(await service.warnings(64500, ['203.0.113.0/24', '198.51.100.0/24', '192.0.2.0/24', '10.0.0.0/8'])).toEqual([
      '198.51.100.0/24: RPKI invalid asn for AS64500; most networks will reject the announcement',
      '192.0.2.0/24: no ROA for AS64500; networks with RPKI filtering may drop it once a covering ROA exists elsewhere',
      '10.0.0.0/8: ROA status could not be verified',
    ]);
    expect(await service.warnings(undefined, ['203.0.113.0/24'])).toEqual([]);
  });
});
