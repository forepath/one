import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleNodesFacade,
  NodesService,
  type JoinToken,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverWorkspaceJoinTokensComponent } from './workspace-join-tokens.component';

const token = (id: string, overrides: Partial<JoinToken> = {}): JoinToken =>
  ({
    id,
    tokenPrefix: `lwj_${id}`,
    description: null,
    site: 'a',
    labels: {},
    witness: false,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    usedAt: null,
    usedByNode: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }) as JoinToken;

describe('LoadweaverWorkspaceJoinTokensComponent (3.38 D1 / D8)', () => {
  async function setup() {
    const facade = facadeStub(
      {
        tokens$: [token('t1'), token('t2'), token('t3', { revokedAt: '2026-01-01T00:00:00Z' })],
        tokensError$: null,
        creatingToken$: false,
        createdToken$: null,
        revokingToken$: null,
        tokenError$: null,
      },
      ['loadJoinTokens', 'installScriptUrl', 'createJoinToken', 'revokeJoinToken', 'clearCreatedJoinToken'],
    );
    const revokeJoinToken = jest
      .fn()
      .mockImplementationOnce(() => of(undefined))
      .mockImplementationOnce(() => throwError(() => ({ status: 403, error: { message: 'Not yours' } })));

    await TestBed.configureTestingModule({
      imports: [LoadweaverWorkspaceJoinTokensComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleNodesFacade, useValue: facade },
        { provide: NodesService, useValue: { revokeJoinToken } },
        { provide: ConsoleEndpointService, useValue: { fleetMode: false, nativeConsoleUrl: () => null } },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverWorkspaceJoinTokensComponent);

    fixture.componentRef.setInput('showList', true);
    fixture.detectChanges();

    return { fixture, facade, revokeJoinToken, el: fixture.nativeElement as HTMLElement };
  }

  it('lists the tokens with a State column and Revoke in ⋮ for active ones only', async () => {
    const { fixture, el } = await setup();
    const component = fixture.componentInstance;

    expect(el.querySelectorAll('[data-testid="workspace-join-tokens"] tr.fpc-data-table__row')).toHaveLength(3);
    expect(el.querySelector('[data-testid="fpc-data-table-state"]')?.getAttribute('aria-label')).toBe('Active');
    expect(component.rowMenu(token('t1')).map((item) => item.id)).toEqual(['revoke', 'copy-id']);
    expect(component.rowMenu(token('t3', { revokedAt: '2026-01-01T00:00:00Z' })).map((item) => item.id)).toEqual([
      'copy-id',
    ]);
  });

  it('revokes the selected active tokens one by one and reports each result (one denied)', async () => {
    const { fixture, facade, revokeJoinToken } = await setup();
    const component = fixture.componentInstance;

    component.selected.set(['t1', 't3']);
    expect(component.canRevokeSelection()).toBe(false); // t3 is revoked already

    component.selected.set(['t1', 't2']);
    expect(component.canRevokeSelection()).toBe(true);
    await component.revokeSelected();

    expect(revokeJoinToken).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selected()).toEqual([]);
    expect(facade['loadJoinTokens']).toHaveBeenCalled();
  });
});
