import {
  isBrowserPreviewBlankUrl,
  mapCanvasPointerToDeviceCoordinates,
  mapDomKeyboardEventToCdpKeyEvents,
  mapDomMouseButton,
  normalizeBrowserPreviewNavigateUrl,
} from './browser-preview.utils';

describe('browser-preview.utils', () => {
  describe('mapCanvasPointerToDeviceCoordinates', () => {
    it('should map pointer to device coordinates', () => {
      const result = mapCanvasPointerToDeviceCoordinates({
        clientX: 50,
        clientY: 25,
        canvasRect: { left: 0, top: 0, width: 100, height: 50 },
        deviceWidth: 800,
        deviceHeight: 400,
      });

      expect(result).toEqual({ x: 400, y: 200 });
    });

    it('should clamp coordinates to device bounds', () => {
      const result = mapCanvasPointerToDeviceCoordinates({
        clientX: 200,
        clientY: -10,
        canvasRect: { left: 0, top: 0, width: 100, height: 50 },
        deviceWidth: 800,
        deviceHeight: 400,
      });

      expect(result.x).toBe(800);
      expect(result.y).toBe(0);
    });
  });

  describe('mapDomMouseButton', () => {
    it('should map DOM buttons', () => {
      expect(mapDomMouseButton(0)).toBe('left');
      expect(mapDomMouseButton(1)).toBe('middle');
      expect(mapDomMouseButton(2)).toBe('right');
      expect(mapDomMouseButton(9)).toBe('none');
    });
  });

  describe('mapDomKeyboardEventToCdpKeyEvents', () => {
    it('should emit rawKeyDown and char for Enter', () => {
      const events = mapDomKeyboardEventToCdpKeyEvents(
        {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        'keyDown',
      );

      expect(events).toEqual([
        expect.objectContaining({ type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13 }),
        expect.objectContaining({ type: 'char', text: '\r', unmodifiedText: '\r' }),
      ]);
    });

    it('should emit only keyUp on keyUp phase', () => {
      const events = mapDomKeyboardEventToCdpKeyEvents(
        {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        'keyUp',
      );

      expect(events).toEqual([expect.objectContaining({ type: 'keyUp', key: 'Enter' })]);
    });

    it('should emit char for printable characters', () => {
      const events = mapDomKeyboardEventToCdpKeyEvents(
        {
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        'keyDown',
      );

      expect(events[1]).toEqual(expect.objectContaining({ type: 'char', text: 'a' }));
    });

    it('should not emit char for Ctrl shortcuts', () => {
      const events = mapDomKeyboardEventToCdpKeyEvents(
        {
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        'keyDown',
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('rawKeyDown');
    });
  });

  describe('normalizeBrowserPreviewNavigateUrl', () => {
    it('should add https when scheme is missing', () => {
      expect(normalizeBrowserPreviewNavigateUrl('example.com/path')).toBe('https://example.com/path');
    });

    it('should accept http and https urls', () => {
      expect(normalizeBrowserPreviewNavigateUrl('http://localhost:3000')).toBe('http://localhost:3000/');
      expect(normalizeBrowserPreviewNavigateUrl('https://example.com')).toBe('https://example.com/');
    });

    it('should reject non-http schemes', () => {
      expect(normalizeBrowserPreviewNavigateUrl('javascript:alert(1)')).toBeNull();
      expect(normalizeBrowserPreviewNavigateUrl('file:///etc/passwd')).toBeNull();
    });

    it('should reject empty input', () => {
      expect(normalizeBrowserPreviewNavigateUrl('   ')).toBeNull();
    });
  });

  describe('isBrowserPreviewBlankUrl', () => {
    it('should detect about:blank variants', () => {
      expect(isBrowserPreviewBlankUrl('about:blank')).toBe(true);
      expect(isBrowserPreviewBlankUrl(' about:blank ')).toBe(true);
      expect(isBrowserPreviewBlankUrl('ABOUT:BLANK')).toBe(true);
      expect(isBrowserPreviewBlankUrl('about:blank#')).toBe(true);
    });

    it('should reject non-blank urls and nullish values', () => {
      expect(isBrowserPreviewBlankUrl(null)).toBe(false);
      expect(isBrowserPreviewBlankUrl(undefined)).toBe(false);
      expect(isBrowserPreviewBlankUrl('https://example.com')).toBe(false);
      expect(isBrowserPreviewBlankUrl('about:srcdoc')).toBe(false);
    });
  });
});
