import { fileIconClassForName, fileIconNameForName } from './file-icon.util';

describe('fileIconClassForName', () => {
  it('maps known extensions to filetype icons', () => {
    expect(fileIconClassForName('src/app/main.ts')).toBe('bi-filetype-ts');
    expect(fileIconClassForName('README.md')).toBe('bi-filetype-md');
    expect(fileIconClassForName('track.mp3')).toBe('bi-file-earmark-music');
  });

  it('falls back for unknown extensions', () => {
    expect(fileIconClassForName('notes.xyz')).toBe('bi-file-earmark');
    expect(fileIconClassForName('Makefile')).toBe('bi-file-earmark');
  });
});

describe('fileIconNameForName', () => {
  it('strips the bi- prefix for fpc icon inputs', () => {
    expect(fileIconNameForName('app.component.ts')).toBe('filetype-ts');
  });
});
