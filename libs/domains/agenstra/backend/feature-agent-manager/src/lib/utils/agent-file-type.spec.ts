import {
  classifyAgentFile,
  contentDispositionAttachment,
  parseContentRangeHeader,
  parseRangeHeader,
} from './agent-file-type';

describe('classifyAgentFile', () => {
  it('classifies empty files as text', () => {
    expect(classifyAgentFile('empty.txt', Buffer.alloc(0))).toEqual({
      fileType: 'text',
      contentType: 'text/plain; charset=utf-8',
    });
  });

  it('classifies PDF by extension and magic', () => {
    expect(classifyAgentFile('doc.pdf', Buffer.from('%PDF-1.4')).fileType).toBe('pdf');
    expect(classifyAgentFile('noext', Buffer.from('%PDF-1.7')).fileType).toBe('pdf');
  });

  it('classifies images by extension and magic', () => {
    expect(classifyAgentFile('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])).fileType).toBe('image');
    expect(classifyAgentFile('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])).fileType).toBe('image');
    expect(classifyAgentFile('a.gif', Buffer.from('GIF89a')).fileType).toBe('image');
  });

  it('classifies video by extension and magic', () => {
    expect(classifyAgentFile('clip.mp4', Buffer.alloc(0)).fileType).toBe('video');
    expect(classifyAgentFile('clip.webm', Buffer.alloc(0)).fileType).toBe('video');
    expect(classifyAgentFile('clip.ogv', Buffer.alloc(0)).fileType).toBe('video');

    const ftyp = Buffer.alloc(12);

    ftyp.writeUInt32BE(12, 0);
    ftyp.write('ftyp', 4, 'ascii');
    expect(classifyAgentFile('unknown', ftyp).fileType).toBe('video');
  });

  it('classifies audio by extension and magic', () => {
    expect(classifyAgentFile('track.mp3', Buffer.alloc(0)).fileType).toBe('audio');
    expect(classifyAgentFile('track.ogg', Buffer.alloc(0)).fileType).toBe('audio');
    expect(classifyAgentFile('track.m4a', Buffer.alloc(0)).fileType).toBe('audio');
    expect(classifyAgentFile('track.wav', Buffer.alloc(0)).contentType).toBe('audio/wav');

    const wav = Buffer.alloc(12);

    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    expect(classifyAgentFile('unknown', wav).fileType).toBe('audio');

    expect(classifyAgentFile('id3.mp3', Buffer.from('ID3')).fileType).toBe('audio');
    expect(classifyAgentFile('flac.bin', Buffer.from('fLaC')).fileType).toBe('audio');
  });

  it('classifies printable UTF-8 as text', () => {
    expect(classifyAgentFile('readme.md', Buffer.from('# Hello\n', 'utf-8')).fileType).toBe('text');
  });

  it('classifies high-control-byte content as binary', () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0e]);

    expect(classifyAgentFile('opaque.bin', binary).fileType).toBe('binary');
  });
});

describe('parseContentRangeHeader', () => {
  it('parses valid Content-Range', () => {
    expect(parseContentRangeHeader('bytes 0-1023/2048')).toEqual({ start: 0, end: 1023, total: 2048 });
  });

  it('rejects overlapping end beyond total', () => {
    expect(parseContentRangeHeader('bytes 0-10/5')).toBeNull();
  });

  it('rejects malformed headers', () => {
    expect(parseContentRangeHeader('bytes */100')).toBeNull();
    expect(parseContentRangeHeader(undefined)).toBeNull();
  });
});

describe('parseRangeHeader', () => {
  it('parses inclusive byte ranges', () => {
    expect(parseRangeHeader('bytes=0-99', 200)).toEqual({ start: 0, end: 99 });
  });

  it('parses open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRangeHeader('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
  });

  it('marks unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=200-300', 100)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=', 100)).toBe('unsatisfiable');
  });

  it('returns null when Range is absent', () => {
    expect(parseRangeHeader(undefined, 100)).toBeNull();
  });
});

describe('contentDispositionAttachment', () => {
  it('builds attachment disposition with basename', () => {
    const value = contentDispositionAttachment('dir/my file.pdf');

    expect(value).toContain('attachment;');
    expect(value).toContain('filename="my file.pdf"');
    expect(value).toContain("filename*=UTF-8''my%20file.pdf");
  });
});
