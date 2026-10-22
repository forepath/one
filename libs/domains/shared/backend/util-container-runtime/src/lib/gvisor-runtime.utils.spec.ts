import { parseGvisorHostReport, parseGvisorRuntimeArgs } from './gvisor-runtime.utils';

describe('gVisor runtime utils', () => {
  describe('parseGvisorRuntimeArgs', () => {
    it('parses platform and network in both flag notations', () => {
      expect(parseGvisorRuntimeArgs(['--platform=kvm', '--network=host'])).toEqual({
        platform: 'kvm',
        network: 'host',
      });
      expect(parseGvisorRuntimeArgs(['--platform', 'systrap', '--network', 'sandbox'])).toEqual({
        platform: 'systrap',
        network: 'sandbox',
      });
      expect(parseGvisorRuntimeArgs(['-platform=kvm'])).toEqual({ platform: 'kvm', network: null });
    });

    it('tolerates missing or malformed arguments', () => {
      expect(parseGvisorRuntimeArgs(undefined)).toEqual({ platform: null, network: null });
      expect(parseGvisorRuntimeArgs(['--platform'])).toEqual({ platform: null, network: null });
      expect(parseGvisorRuntimeArgs(['--platform', '--network=host'])).toEqual({ platform: null, network: 'host' });
      expect(parseGvisorRuntimeArgs([42, null, '--platform=kvm'])).toEqual({ platform: 'kvm', network: null });
    });
  });

  describe('parseGvisorHostReport', () => {
    it('returns the last JSON report line', () => {
      const output = [
        '[agenstra-gvisor] Downloading gVisor',
        '{"runtime":"runsc-systrap","sharedNetnsRuntime":"runsc-systrap-hostnet","release":"20261005.0","standard":"ready","sandboxed":"ready"}',
        '',
      ].join('\n');

      expect(parseGvisorHostReport(output)).toEqual({
        runtime: 'runsc-systrap',
        sharedNetnsRuntime: 'runsc-systrap-hostnet',
        release: '20261005.0',
        standard: 'ready',
        sandboxed: 'ready',
      });
    });

    it('returns null without a report', () => {
      expect(parseGvisorHostReport('no json here\n{broken')).toBeNull();
      expect(parseGvisorHostReport('{"unrelated":true}')).toBeNull();
    });
  });
});
