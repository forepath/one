import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { DnsService } from '../../services/dns.service';
import type { DnsOverview, DnsRecordResource, DnsZoneResource } from '../../types/dns.types';
import {
  confirmDnsFailback,
  confirmDnsFailbackFailure,
  confirmDnsFailbackSuccess,
  loadDns,
  loadDnsSuccess,
} from './dns.actions';
import { confirmDnsFailback$, loadDns$, reloadDnsAfterFailback$ } from './dns.effects';
import { consoleDnsReducer, initialConsoleDnsState } from './dns.reducer';
import { selectDnsZoneRows } from './dns.selectors';

const record: DnsRecordResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'DnsRecord',
  metadata: { name: 'www', project: 'shop' },
  spec: { zone: 'example', name: 'www', type: 'A', values: ['203.0.113.10'] },
};
const zone: DnsZoneResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'DnsZone',
  metadata: { name: 'example' },
  spec: { zone: 'example.com', provider: 'bind', secondaries: ['cf'], dnssec: true },
};

function service(overrides: Partial<Record<keyof DnsService, jest.Mock>> = {}) {
  return {
    records: jest.fn().mockReturnValue(of([record])),
    zones: jest.fn().mockReturnValue(of([])),
    dnssec: jest.fn().mockReturnValue(of([])),
    failovers: jest.fn().mockReturnValue(of([])),
    zoneResources: jest.fn().mockReturnValue(of([zone])),
    providers: jest.fn().mockReturnValue(of([])),
    failback: jest.fn().mockReturnValue(of({ confirmed: true })),
    ...overrides,
  };
}

describe('console DNS state', () => {
  it('builds zone rows from declarations and sync states, primary first', () => {
    const overview: DnsOverview = {
      records: [record],
      zones: [
        {
          zone: 'example',
          provider: 'cf',
          syncedAt: null,
          error: 'auth failed',
          conflicts: ['mail'],
          changes: 0,
          drift: null,
        },
        {
          zone: 'example',
          provider: 'bind',
          syncedAt: '2026-10-01T10:00:00.000Z',
          error: null,
          conflicts: [],
          changes: 2,
          drift: null,
        },
        { zone: 'legacy', provider: 'cf', syncedAt: null, error: null, conflicts: [], changes: 0, drift: null },
      ],
      dnssec: null,
      failovers: null,
      zoneResources: [zone],
      providers: null,
    };
    const state = consoleDnsReducer(initialConsoleDnsState, loadDnsSuccess({ overview, errors: [] }));
    const rows = selectDnsZoneRows({ consoleDns: state });

    expect(rows.map((r) => [r.zone, r.primary, r.statuses.map((s) => s.provider), r.conflicts, r.failing])).toEqual([
      ['example', 'bind', ['bind', 'cf'], 1, true],
      ['legacy', null, ['cf'], 0, false],
    ]);
    expect(rows[0].dnssec).toBe(true);
  });

  it('reads only the records for project members', async () => {
    const dns = service();

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadDns({ infrastructure: false })))] });

    expect(await firstValueFrom(loadDns$(TestBed.inject(Actions), dns as unknown as DnsService))).toEqual(
      loadDnsSuccess({
        overview: {
          records: [record],
          zones: null,
          dnssec: null,
          failovers: null,
          zoneResources: null,
          providers: null,
        },
        errors: [],
      }),
    );
    expect(dns.zones).not.toHaveBeenCalled();
  });

  it('keeps the parts that loaded when one fails', async () => {
    const dns = service({ dnssec: jest.fn().mockReturnValue(throwError(() => new Error('dnssec down'))) });

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadDns({ infrastructure: true })))] });

    const result = await firstValueFrom(loadDns$(TestBed.inject(Actions), dns as unknown as DnsService));

    expect(result).toEqual(
      loadDnsSuccess({
        overview: { records: [record], zones: [], dnssec: null, failovers: [], zoneResources: [zone], providers: [] },
        errors: ['dnssec down'],
      }),
    );
  });

  it('confirms a fail-back and reads the state again', async () => {
    const dns = service({
      failback: jest.fn().mockReturnValue(throwError(() => new Error('no fail-back is pending'))),
    });

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(confirmDnsFailback({ name: 'www' })))] });

    expect(await firstValueFrom(confirmDnsFailback$(TestBed.inject(Actions), dns as unknown as DnsService))).toEqual(
      confirmDnsFailbackFailure({ name: 'www', error: 'no fail-back is pending' }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(confirmDnsFailbackSuccess({ name: 'www' })))],
    });

    expect(await firstValueFrom(reloadDnsAfterFailback$(TestBed.inject(Actions)))).toEqual(
      loadDns({ infrastructure: true, silent: true }),
    );
  });

  it('tracks the confirmation', () => {
    const confirming = consoleDnsReducer(initialConsoleDnsState, confirmDnsFailback({ name: 'www' }));

    expect(confirming.confirming).toBe('www');
    expect(consoleDnsReducer(confirming, confirmDnsFailbackFailure({ name: 'www', error: 'x' }))).toMatchObject({
      confirming: null,
      actionError: 'x',
    });
  });
});
