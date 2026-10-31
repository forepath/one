import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AlertsService,
  BackupsService,
  ConsoleAuditService,
  ConsoleEndpointService,
  FleetService,
  NodesService,
  PlansService,
  UpdatesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { ConsoleTaskFeedService } from './task-feed.service';

function setup(fleetMode: boolean, activeClusterId: string | null) {
  const plans = { list: jest.fn(() => of([])) };
  const backups = { restores: jest.fn(() => of([])) };
  const updates = { rollouts: jest.fn(() => of([])) };
  const nodes = { list: jest.fn(() => of([])) };
  const fleet = { operations: jest.fn(() => of([])) };

  TestBed.configureTestingModule({
    providers: [
      { provide: PlansService, useValue: plans },
      { provide: BackupsService, useValue: backups },
      { provide: UpdatesService, useValue: updates },
      { provide: NodesService, useValue: nodes },
      { provide: ConsoleAuditService, useValue: { list: jest.fn(() => of(null)) } },
      { provide: AlertsService, useValue: { list: jest.fn(() => of([])) } },
      { provide: FleetService, useValue: fleet },
      { provide: ConsoleEndpointService, useValue: { fleetMode, activeClusterId: signal(activeClusterId) } },
    ],
  });

  return { feed: TestBed.inject(ConsoleTaskFeedService), plans, backups, updates, nodes, fleet };
}

describe('ConsoleTaskFeedService', () => {
  it('fleet level (no cluster open): polls only the fleet operations, never the cluster relay', () => {
    const { feed, plans, backups, updates, nodes, fleet } = setup(true, null);

    feed.refresh(true);

    expect(plans.list).not.toHaveBeenCalled();
    expect(backups.restores).not.toHaveBeenCalled();
    expect(updates.rollouts).not.toHaveBeenCalled();
    expect(nodes.list).not.toHaveBeenCalled();
    expect(fleet.operations).toHaveBeenCalled();
  });

  it('inside a cluster (fleet mode or single cluster): reads the cluster lists', () => {
    for (const [fleetMode, cluster] of [
      [true, 'c-1'],
      [false, null],
    ] as const) {
      TestBed.resetTestingModule();
      const { feed, plans, backups, nodes } = setup(fleetMode, cluster);

      feed.refresh(true);

      expect(plans.list).toHaveBeenCalled();
      expect(backups.restores).toHaveBeenCalled();
      expect(nodes.list).toHaveBeenCalled();
    }
  });
});
