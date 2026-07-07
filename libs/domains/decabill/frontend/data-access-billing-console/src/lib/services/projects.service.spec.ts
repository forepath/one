import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ProjectsService, { provide: ENVIRONMENT, useValue: { billing: { restApiUrl: apiUrl } } }],
    });
    service = TestBed.inject(ProjectsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('gets project detail including targetHours', (done) => {
    const project = {
      id: 'p-1',
      userId: 'u-1',
      name: 'Alpha',
      status: 'active',
      hourlyRateNet: 100,
      targetHours: 40,
      currency: 'EUR',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    service.getById('p-1').subscribe((res) => {
      expect(res).toEqual(project);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/projects/p-1`);

    expect(req.request.method).toBe('GET');
    req.flush(project);
  });
});
