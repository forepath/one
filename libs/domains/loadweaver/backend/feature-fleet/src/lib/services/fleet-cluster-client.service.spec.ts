import { clusterConnectionFailure, isTemporaryClusterFailure } from './fleet-cluster-client.service';

const err = (code: string | undefined, message = 'x') => Object.assign(new Error(message), code ? { code } : {});

describe('clusterConnectionFailure (3.43 live test: a relay during the cluster restart answered 500)', () => {
  it.each([
    [err('ECONNRESET', 'socket hang up'), 'hang-up'],
    [err(undefined, 'socket hang up'), 'hang-up'],
    [err('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:443'), 'refused'],
    [err('ECONNRESET', 'read ECONNRESET'), 'reset'],
    [err('EPIPE'), 'reset'],
    [err('ECONNABORTED', 'timeout of 30000ms exceeded'), 'timeout'],
    [err('ETIMEDOUT'), 'timeout'],
    [err(undefined, 'timeout of 1000ms exceeded'), 'timeout'],
    [err('EHOSTUNREACH'), 'network'],
    [err('ENOTFOUND'), 'network'],
    [err('CERT_HAS_EXPIRED'), 'tls'],
    [err('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'tls'],
    [err('ERR_TLS_CERT_ALTNAME_INVALID'), 'tls'],
    [err('ERR_CANCELED', 'canceled'), 'aborted'],
    [err(undefined, 'address 10.0.0.1 is not allowed'), 'other'],
    ['plain string', 'other'],
    [null, 'other'],
  ])('%#: %s', (error, expected) => {
    expect(clusterConnectionFailure(error)).toBe(expected);
  });

  it('treats refused / reset / hang-up / timeout as temporary', () => {
    expect(['refused', 'reset', 'hang-up', 'timeout'].every((f) => isTemporaryClusterFailure(f as never))).toBe(true);
    expect(['network', 'tls', 'aborted', 'other', null].some((f) => isTemporaryClusterFailure(f as never))).toBe(false);
  });
});
