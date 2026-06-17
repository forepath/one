import { buildSsrAllowedHosts } from './ssr-allowed-hosts';

describe('buildSsrAllowedHosts', () => {
  it('always includes local development hosts', () => {
    expect(buildSsrAllowedHosts([])).toEqual(['localhost', '127.0.0.1']);
  });

  it('adds the apex domain and a wildcard for its subdomains', () => {
    expect(buildSsrAllowedHosts(['agenstra.com'])).toEqual([
      'localhost',
      '127.0.0.1',
      'agenstra.com',
      '*.agenstra.com',
    ]);
  });

  it('supports multiple apex domains', () => {
    expect(buildSsrAllowedHosts(['forepath.io', 'agenstra.com'])).toEqual([
      'localhost',
      '127.0.0.1',
      'forepath.io',
      '*.forepath.io',
      'agenstra.com',
      '*.agenstra.com',
    ]);
  });

  it('deduplicates repeated apex domains', () => {
    expect(buildSsrAllowedHosts(['agenstra.com', 'agenstra.com'])).toEqual([
      'localhost',
      '127.0.0.1',
      'agenstra.com',
      '*.agenstra.com',
    ]);
  });
});
