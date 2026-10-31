import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import { LoadweaverClusterService, hasLoadweaverItem } from './loadweaver-cluster.service';

describe('LoadweaverClusterService', () => {
  let service: LoadweaverClusterService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { billing: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(LoadweaverClusterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the cluster for customers and admins', () => {
    service.getCluster('sub-1', 'item-1').subscribe();
    httpMock.expectOne(`${apiUrl}/subscriptions/sub-1/items/item-1/loadweaver/cluster`).flush({});

    service.getCluster('sub-1', 'item-1', true).subscribe();
    httpMock.expectOne(`${apiUrl}/admin/billing/subscriptions/sub-1/items/item-1/loadweaver/cluster`).flush({});
  });

  it('detects subscriptions running a Loadweaver cluster', () => {
    expect(hasLoadweaverItem([{ service: 'decabill-billing' }, { service: 'loadweaver' }])).toBe(true);
    expect(hasLoadweaverItem([{ service: 'custom' }])).toBe(false);
    expect(hasLoadweaverItem(undefined)).toBe(false);
  });
});
