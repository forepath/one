import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type {
  CreateFilterRuleDto,
  FilterRuleResponseDto,
  UpdateFilterRuleDto,
} from '../state/filter-rules/filter-rules.types';

import { FilterRulesService } from './filter-rules.service';

describe('FilterRulesService', () => {
  let service: FilterRulesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const mockRule: FilterRuleResponseDto = {
    id: '11111111-1111-1111-1111-111111111111',
    pattern: 'x',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'drop',
    priority: 0,
    enabled: true,
    isGlobal: true,
    workspaceIds: [],
    sync: { pending: 0, synced: 1, failed: 0 },
    workspaceSync: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });
    service = TestBed.inject(FilterRulesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists filter rules', (done) => {
    service.list().subscribe((rules) => {
      expect(rules).toEqual([mockRule]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/filter-rules`);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush([mockRule]);
  });

  it('lists filter rules with pagination query params', (done) => {
    service.list({ limit: 10, offset: 20 }).subscribe((rules) => {
      expect(rules).toEqual([mockRule]);
      done();
    });
    const req = httpMock.expectOne(
      (r) => r.url === `${apiUrl}/filter-rules` && r.params.get('limit') === '10' && r.params.get('offset') === '20',
    );

    expect(req.request.method).toBe('GET');
    req.flush([mockRule]);
  });

  it('creates a filter rule', (done) => {
    const dto: CreateFilterRuleDto = {
      pattern: 'a',
      direction: 'incoming',
      filterType: 'none',
      isGlobal: true,
    };

    service.create(dto).subscribe((r) => {
      expect(r).toEqual(mockRule);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/filter-rules`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush(mockRule);
  });

  it('updates a filter rule', (done) => {
    const dto: UpdateFilterRuleDto = { pattern: 'b' };

    service.update(mockRule.id, dto).subscribe((r) => {
      expect(r.pattern).toBe('b');
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/filter-rules/${mockRule.id}`);

    expect(req.request.method).toBe('PUT');
    req.flush({ ...mockRule, pattern: 'b' });
  });

  it('deletes a filter rule', (done) => {
    service.delete(mockRule.id).subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/filter-rules/${mockRule.id}`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
