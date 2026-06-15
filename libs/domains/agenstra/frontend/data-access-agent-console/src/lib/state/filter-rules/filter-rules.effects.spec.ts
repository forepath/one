import { of, throwError } from 'rxjs';

import { FilterRulesService } from '../../services/filter-rules.service';

import {
  loadFilterRules,
  loadFilterRulesBatch,
  loadFilterRulesFailure,
  loadFilterRulesSuccess,
} from './filter-rules.actions';
import { loadFilterRules$, loadFilterRulesBatch$ } from './filter-rules.effects';
import type { FilterRuleResponseDto } from './filter-rules.types';

describe('FilterRulesEffects', () => {
  const mockRule = (id: string): FilterRuleResponseDto => ({
    id,
    pattern: 'p',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'none',
    priority: 0,
    enabled: true,
    isGlobal: true,
    workspaceIds: [],
    sync: { pending: 0, synced: 0, failed: 0 },
    workspaceSync: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  });

  describe('loadFilterRules$', () => {
    it('dispatches success with empty list when API returns no rows', (done) => {
      const svc = { list: jest.fn().mockReturnValue(of([])) } as unknown as FilterRulesService;

      loadFilterRules$(of(loadFilterRules()), svc).subscribe((result) => {
        expect(result).toEqual(loadFilterRulesSuccess({ rules: [] }));
        expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('dispatches success when first page is partial', (done) => {
      const rules = [mockRule('a')];
      const svc = { list: jest.fn().mockReturnValue(of(rules)) } as unknown as FilterRulesService;

      loadFilterRules$(of(loadFilterRules()), svc).subscribe((result) => {
        expect(result).toEqual(loadFilterRulesSuccess({ rules }));
        expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('dispatches loadFilterRulesBatch when first page is full', (done) => {
      const rules = Array.from({ length: 10 }, (_, i) => mockRule(`id-${i}`));
      const svc = { list: jest.fn().mockReturnValue(of(rules)) } as unknown as FilterRulesService;

      loadFilterRules$(of(loadFilterRules()), svc).subscribe((result) => {
        expect(result).toEqual(loadFilterRulesBatch({ offset: 10, accumulatedRules: rules }));
        expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('dispatches failure on error', (done) => {
      const svc = {
        list: jest.fn().mockReturnValue(throwError(() => new Error('network'))),
      } as unknown as FilterRulesService;

      loadFilterRules$(of(loadFilterRules()), svc).subscribe((result) => {
        expect(result).toEqual(loadFilterRulesFailure({ error: 'network' }));
        done();
      });
    });
  });

  describe('loadFilterRulesBatch$', () => {
    it('dispatches success when next page is empty', (done) => {
      const accumulated = [mockRule('a')];
      const svc = { list: jest.fn().mockReturnValue(of([])) } as unknown as FilterRulesService;

      loadFilterRulesBatch$(of(loadFilterRulesBatch({ offset: 10, accumulatedRules: accumulated })), svc).subscribe(
        (result) => {
          expect(result).toEqual(loadFilterRulesSuccess({ rules: accumulated }));
          expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 10 });
          done();
        },
      );
    });

    it('dispatches success when next page is partial', (done) => {
      const accumulated = Array.from({ length: 10 }, (_, i) => mockRule(`a-${i}`));
      const page = [mockRule('b')];
      const svc = { list: jest.fn().mockReturnValue(of(page)) } as unknown as FilterRulesService;

      loadFilterRulesBatch$(of(loadFilterRulesBatch({ offset: 10, accumulatedRules: accumulated })), svc).subscribe(
        (result) => {
          expect(result).toEqual(loadFilterRulesSuccess({ rules: [...accumulated, ...page] }));
          expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 10 });
          done();
        },
      );
    });

    it('dispatches another batch when page is full', (done) => {
      const accumulated = Array.from({ length: 10 }, (_, i) => mockRule(`a-${i}`));
      const page = Array.from({ length: 10 }, (_, i) => mockRule(`b-${i}`));
      const svc = { list: jest.fn().mockReturnValue(of(page)) } as unknown as FilterRulesService;

      loadFilterRulesBatch$(of(loadFilterRulesBatch({ offset: 10, accumulatedRules: accumulated })), svc).subscribe(
        (result) => {
          expect(result).toEqual(loadFilterRulesBatch({ offset: 20, accumulatedRules: [...accumulated, ...page] }));
          expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 10 });
          done();
        },
      );
    });
  });
});
