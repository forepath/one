import { Test, TestingModule } from '@nestjs/testing';

import { ChatFilterFactory } from './chat-filter.factory';
import { ChatFilter, FilterDirection } from './chat-filter.interface';

describe('ChatFilterFactory', () => {
  let factory: ChatFilterFactory;
  let mockFilter1: jest.Mocked<ChatFilter>;
  let mockFilter2: jest.Mocked<ChatFilter>;
  let mockFilter3: jest.Mocked<ChatFilter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatFilterFactory],
    }).compile();

    factory = module.get<ChatFilterFactory>(ChatFilterFactory);

    // Create mock filters
    mockFilter1 = {
      getType: jest.fn().mockReturnValue('filter1'),
      getDisplayName: jest.fn().mockReturnValue('Filter 1'),
      getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
      filter: jest.fn(),
    };

    mockFilter2 = {
      getType: jest.fn().mockReturnValue('filter2'),
      getDisplayName: jest.fn().mockReturnValue('Filter 2'),
      getDirection: jest.fn().mockReturnValue(FilterDirection.OUTGOING),
      filter: jest.fn(),
    };

    mockFilter3 = {
      getType: jest.fn().mockReturnValue('filter3'),
      getDisplayName: jest.fn().mockReturnValue('Filter 3'),
      getDirection: jest.fn().mockReturnValue(FilterDirection.BIDIRECTIONAL),
      filter: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerFilter', () => {
    it('should register a filter', () => {
      factory.registerFilter(mockFilter1);

      expect(factory.hasFilter('filter1')).toBe(true);
      expect(factory.getFilter('filter1')).toBe(mockFilter1);
    });

    it('should register multiple filters', () => {
      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter2);
      factory.registerFilter(mockFilter3);

      expect(factory.hasFilter('filter1')).toBe(true);
      expect(factory.hasFilter('filter2')).toBe(true);
      expect(factory.hasFilter('filter3')).toBe(true);
    });

    it('should overwrite existing filter and log warning', () => {
      const loggerWarnSpy = jest.spyOn(factory['logger'], 'warn').mockImplementation();
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter1); // Register same filter again

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Filter with type 'filter1' is already registered. Overwriting existing filter.",
      );
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered chat filter: filter1 (incoming)');
      expect(factory.hasFilter('filter1')).toBe(true);

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should log registration with direction', () => {
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter2);
      factory.registerFilter(mockFilter3);

      expect(loggerLogSpy).toHaveBeenCalledWith('Registered chat filter: filter1 (incoming)');
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered chat filter: filter2 (outgoing)');
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered chat filter: filter3 (bidirectional)');

      loggerLogSpy.mockRestore();
    });
  });

  describe('getFiltersByDirection', () => {
    it('should return only incoming filters for INCOMING direction', () => {
      factory.registerFilter(mockFilter1); // INCOMING
      factory.registerFilter(mockFilter2); // OUTGOING
      factory.registerFilter(mockFilter3); // BIDIRECTIONAL

      const filters = factory.getFiltersByDirection(FilterDirection.INCOMING);

      expect(filters).toHaveLength(2);
      expect(filters).toContain(mockFilter1);
      expect(filters).toContain(mockFilter3);
      expect(filters).not.toContain(mockFilter2);
    });

    it('should return only outgoing filters for OUTGOING direction', () => {
      factory.registerFilter(mockFilter1); // INCOMING
      factory.registerFilter(mockFilter2); // OUTGOING
      factory.registerFilter(mockFilter3); // BIDIRECTIONAL

      const filters = factory.getFiltersByDirection(FilterDirection.OUTGOING);

      expect(filters).toHaveLength(2);
      expect(filters).toContain(mockFilter2);
      expect(filters).toContain(mockFilter3);
      expect(filters).not.toContain(mockFilter1);
    });

    it('should return empty array when no filters match direction', () => {
      factory.registerFilter(mockFilter1); // INCOMING only

      const filters = factory.getFiltersByDirection(FilterDirection.OUTGOING);

      expect(filters).toHaveLength(0);
    });

    it('should return bidirectional filters for both directions', () => {
      factory.registerFilter(mockFilter3); // BIDIRECTIONAL

      const incomingFilters = factory.getFiltersByDirection(FilterDirection.INCOMING);
      const outgoingFilters = factory.getFiltersByDirection(FilterDirection.OUTGOING);

      expect(incomingFilters).toContain(mockFilter3);
      expect(outgoingFilters).toContain(mockFilter3);
    });
  });

  describe('getFilter', () => {
    it('should return registered filter', () => {
      factory.registerFilter(mockFilter1);

      const filter = factory.getFilter('filter1');

      expect(filter).toBe(mockFilter1);
    });

    it('should throw error if filter not found', () => {
      expect(() => factory.getFilter('nonexistent')).toThrow(
        "Chat filter with type 'nonexistent' not found. Available types: none",
      );
    });

    it('should throw error with available types when filter not found', () => {
      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter2);

      expect(() => factory.getFilter('nonexistent')).toThrow(
        "Chat filter with type 'nonexistent' not found. Available types: filter1, filter2",
      );
    });
  });

  describe('hasFilter', () => {
    it('should return false for unregistered filter', () => {
      expect(factory.hasFilter('filter1')).toBe(false);
    });

    it('should return true for registered filter', () => {
      factory.registerFilter(mockFilter1);

      expect(factory.hasFilter('filter1')).toBe(true);
    });
  });

  describe('getAllFilters', () => {
    it('should return empty array when no filters registered', () => {
      expect(factory.getAllFilters()).toEqual([]);
    });

    it('should return array of all registered filters', () => {
      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter2);
      factory.registerFilter(mockFilter3);

      const filters = factory.getAllFilters();

      expect(filters).toHaveLength(3);
      expect(filters).toContain(mockFilter1);
      expect(filters).toContain(mockFilter2);
      expect(filters).toContain(mockFilter3);
    });
  });

  describe('getRegisteredTypes', () => {
    it('should return empty array when no filters registered', () => {
      expect(factory.getRegisteredTypes()).toEqual([]);
    });

    it('should return array of registered filter types', () => {
      factory.registerFilter(mockFilter1);
      factory.registerFilter(mockFilter2);
      factory.registerFilter(mockFilter3);

      const types = factory.getRegisteredTypes();

      expect(types).toHaveLength(3);
      expect(types).toContain('filter1');
      expect(types).toContain('filter2');
      expect(types).toContain('filter3');
    });
  });
});
