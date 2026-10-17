import { mustParseCidr } from '@forepath/loadweaver/shared/util-network';

import { networkConfig } from '../test-fixtures';
import {
  buildResponse,
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  parseQuery,
  RCODE_NOERROR,
  RCODE_NXDOMAIN,
  RCODE_REFUSED,
} from './dns-message';
import { DnsResolverService, parseResolvConf } from './dns-resolver.service';
import { decide } from './policy-dns';

function query(name: string, type = DNS_TYPE_A, id = 0x1234): Buffer {
  const labels = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));

  return Buffer.concat([
    Buffer.from([id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]),
    ...labels,
    Buffer.from([0, 0, type, 0, 1]),
  ]);
}

describe('DNS message codec', () => {
  it('parses a standard query', () => {
    expect(parseQuery(query('API.shop.lw'))).toMatchObject({
      id: 0x1234,
      question: { name: 'api.shop.lw', type: DNS_TYPE_A, class: 1 },
    });
  });

  it('rejects responses, multi-question, compressed and truncated messages', () => {
    const response = query('a.lw');

    response[2] |= 0x80;
    expect(parseQuery(response)).toBeNull();

    const twoQuestions = query('a.lw');

    twoQuestions[5] = 2;
    expect(parseQuery(twoQuestions)).toBeNull();
    expect(parseQuery(Buffer.concat([query('a.lw').subarray(0, 12), Buffer.from([0xc0, 0x0c])]))).toBeNull();
    expect(parseQuery(query('a.lw').subarray(0, 15))).toBeNull();
    expect(parseQuery(Buffer.alloc(5))).toBeNull();
  });

  it('builds answers for A and AAAA', () => {
    const a = buildResponse(parseQuery(query('api.shop.lw'))!, RCODE_NOERROR, ['10.92.0.10']);

    expect(a.readUInt16BE(0)).toBe(0x1234);
    expect(a.readUInt16BE(2) & 0x8000).toBe(0x8000);
    expect(a.readUInt16BE(6)).toBe(1);
    expect([...a.subarray(a.length - 4)]).toEqual([10, 92, 0, 10]);

    const aaaa = buildResponse(parseQuery(query('api.shop.lw', DNS_TYPE_AAAA))!, RCODE_NOERROR, ['fd00:92::10']);

    expect(aaaa.subarray(aaaa.length - 16).toString('hex')).toBe('fd000092000000000000000000000010');
  });
});

describe('policy-aware DNS decisions', () => {
  const dns = networkConfig().dns;

  it('answers only visible names, NXDOMAIN for the rest of the cluster domain', () => {
    expect(decide(dns, '10.88.0.10', parseQuery(query('api.shop.lw'))!)).toEqual({
      kind: 'answer',
      rcode: RCODE_NOERROR,
      addresses: ['10.92.0.10'],
    });
    expect(decide(dns, '10.88.0.10', parseQuery(query('api.shop.lw', DNS_TYPE_AAAA))!)).toEqual({
      kind: 'answer',
      rcode: RCODE_NOERROR,
      addresses: ['fd00:92::10'],
    });
    expect(decide(dns, '10.88.0.99', parseQuery(query('api.shop.lw'))!)).toEqual({
      kind: 'answer',
      rcode: RCODE_NXDOMAIN,
      addresses: [],
    });
    expect(decide(dns, '10.88.0.10', parseQuery(query('db.shop.lw'))!)).toMatchObject({ rcode: RCODE_NXDOMAIN });
  });

  it('forwards everything outside the cluster domain', () => {
    expect(decide(dns, '10.88.0.10', parseQuery(query('example.com'))!)).toEqual({ kind: 'forward' });
    expect(decide(dns, '10.88.0.10', parseQuery(query('notlw'))!)).toEqual({ kind: 'forward' });
  });
});

describe('DnsResolverService', () => {
  function service(): DnsResolverService {
    const resolver = new DnsResolverService();

    resolver.update(networkConfig().dns);
    (resolver as unknown as { clients: unknown[] }).clients = [mustParseCidr('10.88.0.0/24')];

    return resolver;
  }

  it('serves local workloads and ignores everyone else (never an open resolver)', async () => {
    const resolver = service();
    const socket = { send: jest.fn() };

    await resolver.handle(socket, query('api.shop.lw'), { address: '203.0.113.5', port: 5000 });
    expect(socket.send).not.toHaveBeenCalled();

    await resolver.handle(socket, query('api.shop.lw'), { address: '10.88.0.10', port: 5000 });
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect((socket.send.mock.calls[0][0] as Buffer).readUInt16BE(6)).toBe(1);
  });

  it('refuses forwarding without upstreams', async () => {
    const resolver = service();
    const socket = { send: jest.fn() };

    await resolver.handle(socket, query('example.com'), { address: '10.88.0.10', port: 5000 });
    expect((socket.send.mock.calls[0][0] as Buffer).readUInt16BE(2) & 0x0f).toBe(RCODE_REFUSED);
  });

  it('rate limits per client', async () => {
    const resolver = service();
    const socket = { send: jest.fn() };

    for (let i = 0; i < 205; i++)
      await resolver.handle(socket, query('api.shop.lw'), { address: '10.88.0.10', port: 5000 });

    expect(socket.send.mock.calls.length).toBeLessThanOrEqual(200);
  });

  it('reads upstreams from resolv.conf', () => {
    expect(
      parseResolvConf('# x\nnameserver 1.1.1.1\nnameserver 10.88.0.1\nnameserver bogus\nsearch lw\n', ['10.88.0.1']),
    ).toEqual(['1.1.1.1']);
  });
});
