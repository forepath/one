import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { groupMembersFromTopology, PoliciesService } from '../../services/policies.service';
import type { PolicyResource, WorkloadGroupResource } from '../../types/policies.types';
import {
  loadGroupMembersFailure,
  loadGroupMembersSuccess,
  loadPolicies,
  loadPoliciesFailure,
  loadPoliciesSuccess,
} from './policies.actions';
import { loadGroupMembers$, loadPolicies$ } from './policies.effects';
import { consolePoliciesReducer, initialConsolePoliciesState } from './policies.reducer';
import { selectPolicyProjects } from './policies.selectors';

const group: WorkloadGroupResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'WorkloadGroup',
  metadata: { name: 'web', project: 'shop' },
  spec: { selector: { matchLabels: { app: 'web' } }, exposed: true },
};
const policy: PolicyResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Policy',
  metadata: { name: 'allow-dns' },
  spec: { from: [{ builtin: 'internet' }], to: [{ group: 'dns' }], rules: [{ protocol: 'udp', ports: [53] }] },
};

describe('console policies state', () => {
  it('stores groups, policies and members and lists their projects', () => {
    const loaded = consolePoliciesReducer(
      consolePoliciesReducer(initialConsolePoliciesState, loadPolicies({})),
      loadPoliciesSuccess({ groups: [group], policies: [policy] }),
    );
    const withMembers = consolePoliciesReducer(loaded, loadGroupMembersSuccess({ members: { 'shop/web': [] } }));

    expect(loaded).toMatchObject({ loading: false, groups: [group], policies: [policy], members: null });
    expect(withMembers.members).toEqual({ 'shop/web': [] });
    expect(consolePoliciesReducer(withMembers, loadGroupMembersFailure({ error: 'x' })).members).toEqual({
      'shop/web': [],
    });
    expect(selectPolicyProjects({ consolePolicies: loaded })).toEqual(['shop']);
  });

  it('loads groups and policies together', async () => {
    const service = {
      workloadGroups: jest.fn().mockReturnValue(of([group])),
      policies: jest.fn().mockReturnValue(of([policy])),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadPolicies({})))] });

    expect(await firstValueFrom(loadPolicies$(TestBed.inject(Actions), service as unknown as PoliciesService))).toEqual(
      loadPoliciesSuccess({ groups: [group], policies: [policy] }),
    );
  });

  it('reports a failure', async () => {
    const service = {
      workloadGroups: jest.fn().mockReturnValue(throwError(() => new Error('offline'))),
      policies: jest.fn().mockReturnValue(of([])),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadPolicies({})))] });

    expect(await firstValueFrom(loadPolicies$(TestBed.inject(Actions), service as unknown as PoliciesService))).toEqual(
      loadPoliciesFailure({ error: 'offline' }),
    );
  });

  it('loads members from the map', async () => {
    const service = { members: jest.fn().mockReturnValue(of({ 'shop/web': [] })) };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadPolicies({ silent: true })))] });

    expect(
      await firstValueFrom(loadGroupMembers$(TestBed.inject(Actions), service as unknown as PoliciesService)),
    ).toEqual(loadGroupMembersSuccess({ members: { 'shop/web': [] } }));
  });

  it('reads members from the map’s member edges', () => {
    expect(
      groupMembersFromTopology({
        elements: [
          {
            id: 'replica:shop/store/web/0',
            kind: 'replica',
            label: 'web/0',
            project: 'shop',
            data: { deployment: 'store', service: 'web', state: 'running', health: 'healthy' },
          },
          { id: 'group:shop/web', kind: 'group', label: 'web', project: 'shop' },
        ],
        edges: [
          { id: 'm1', kind: 'member', source: 'group:shop/web', target: 'replica:shop/store/web/0' },
          { id: 'm2', kind: 'member', source: 'group:shop/web', target: 'replica:shop/store/web/1' },
          { id: 'p1', kind: 'policy', source: 'group:shop/web', target: 'group:shop/db' },
        ],
      }),
    ).toEqual({
      'shop/web': [
        {
          replica: 'shop/store/web/0',
          label: 'web/0',
          deployment: 'store',
          service: 'web',
          state: 'running',
          health: 'healthy',
        },
        {
          replica: 'shop/store/web/1',
          label: 'shop/store/web/1',
          deployment: null,
          service: null,
          state: null,
          health: null,
        },
      ],
    });
  });
});
